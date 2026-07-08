"""
ASAP Pipeline — WorkingMoni Deal Scraper
Runs twice daily (9 AM and 3 PM Pacific) via GitHub Actions.

Logic:
1. Hit workingmoni.com/investors?availableOnly=true — only available deals visible
2. For each deal URL not already in Supabase or seen_deals.json → scrape and insert
3. Email a summary of what was added
"""

import asyncio, json, os, re, smtplib, urllib.request, urllib.parse
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────
LISTING_URL   = "https://workingmoni.com/investors?availableOnly=true"
SEEN_FILE     = "seen_deals.json"
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_SVC  = os.environ["SUPABASE_SVC"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_PASS    = os.environ["GMAIL_APP_PASSWORD"]
RECIPIENTS    = [e.strip() for e in os.environ["RECIPIENT_EMAIL"].split(",")]

SUPABASE_DEALS = f"{SUPABASE_URL}/rest/v1/deals"
HEADERS_READ   = {
    "apikey":        SUPABASE_SVC,
    "Authorization": f"Bearer {SUPABASE_SVC}",
}
HEADERS_WRITE  = {
    **HEADERS_READ,
    "Content-Type": "application/json",
    "Prefer":       "resolution=merge-duplicates,return=minimal",
}


# ── Supabase helpers ──────────────────────────────────────────────────────────
def supabase_get_existing_ids(ids: list) -> set:
    """
    Check Supabase for which deal IDs already exist.
    Primary deduplication — catches cases where seen_deals.json was reset.
    """
    if not ids:
        return set()
    id_list = ",".join(ids)
    url = f"{SUPABASE_DEALS}?id=in.({urllib.parse.quote(id_list)})&select=id&limit=500"
    req = urllib.request.Request(url, headers=HEADERS_READ)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.loads(r.read())
            return {row["id"] for row in rows}
    except Exception as e:
        print(f"  WARNING: Could not check Supabase for existing deals: {e}")
        return set()


def supabase_upsert(record: dict) -> bool:
    data = json.dumps(record).encode()
    req  = urllib.request.Request(
        SUPABASE_DEALS, data=data, headers=HEADERS_WRITE, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status in (200, 201, 204)
    except Exception as e:
        print(f"  Supabase insert failed: {e}")
        return False


# ── Field parsers ─────────────────────────────────────────────────────────────
def parse_money(s):
    if not s:
        return None
    n = re.sub(r"[^0-9.]", "", str(s).replace(",", ""))
    try:
        v = float(n)
        return v if v > 0 else None
    except ValueError:
        return None


def parse_pct(s):
    if not s:
        return None
    m = re.search(r"([\d.]+)%", str(s))
    return float(m.group(1)) / 100 if m else None


def parse_acres(s):
    if not s:
        return None
    m = re.match(r"([\d.]+)", str(s).strip())
    return float(m.group(1)) if m else None


def parse_sqft(s):
    if not s:
        return None
    n = re.sub(r"[^0-9]", "", str(s))
    return float(n) if n else None


def parse_fico_min(s):
    if not s:
        return None
    m = re.match(r"(\d{3})", str(s))
    return int(m.group(1)) if m else None


def deal_id_from_url(url):
    return url.rstrip("/").split("/")[-1].split("?")[0]


def deal_kind(loan_type):
    t = (loan_type or "").lower()
    if "ground" in t or "construct" in t:     return "groundup"
    if "fix" in t or "flip" in t:             return "fixflip"
    if "dscr" in t or "rental" in t:          return "dscr"
    if "cash" in t and "out" in t:            return "cashout"
    if "foreclosure" in t or "bailout" in t:  return "bridge"
    if "refinanc" in t or "refi" in t:        return "refi"
    if "bridge" in t:                         return "bridge"
    if "purchase" in t or "acquisition" in t: return "purchase"
    if "land" in t or "lot" in t:            return "land"
    return "bridge"


# ── Listing page ──────────────────────────────────────────────────────────────
async def get_deal_links(page):
    print(f"  Loading: {LISTING_URL}")
    await page.goto(LISTING_URL, wait_until="domcontentloaded", timeout=45000)
    await page.wait_for_function(
        "() => document.body.innerText.includes('Seeking')", timeout=30000
    )
    await asyncio.sleep(3)
    for _ in range(6):
        await page.mouse.wheel(0, 2000)
        await asyncio.sleep(0.8)
    await asyncio.sleep(2)

    links = await page.eval_on_selector_all(
        "a[href*='/investors/']",
        "els => els.map(e => e.href)"
    )
    seen_urls, out = set(), []
    for l in links:
        clean = l.split("?")[0].rstrip("/")
        if "/investors/" not in clean:
            continue
        # Skip the listing root page itself
        if clean.endswith("/investors"):
            continue
        if clean not in seen_urls:
            seen_urls.add(clean)
            out.append(clean)
    print(f"  Found {len(out)} available deal links")
    return out


# ── Individual deal page ──────────────────────────────────────────────────────
async def scrape_deal(page, url):
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)
        body = await page.inner_text("body")

        # Title (street name)
        title_el = await page.query_selector("h1")
        title = (await title_el.inner_text()).strip() if title_el else ""

        # City / State / Zip from subtitle
        subtitle = ""
        for sel in ["h1 + p", "h1 ~ p", ".text-gray-500"]:
            el = await page.query_selector(sel)
            if el:
                txt = (await el.inner_text()).strip()
                if re.search(r"[A-Z]{2}\s*\d{5}", txt):
                    subtitle = txt
                    break
        city, state, zip_code = "", "", ""
        m = re.search(r"([^,\n]+),\s*([A-Z]{2})\s*(\d{5})", subtitle)
        if m:
            city, state, zip_code = m.group(1).strip(), m.group(2), m.group(3)

        # Loan amount — "Seeking ... $ 326,500" (note space between $ and digits)
        seeking_m = re.search(r"Seeking[^$\n]{0,40}\$\s*([\d,]+)", body)
        loan_amount = parse_money(seeking_m.group(1)) if seeking_m else None

        # Loan type — strip "Appraiser / Based on ARV / Project Cost" suffixes
        lt_m = re.search(r"Loan Type\s*\n?\s*([^\n]+)", body)
        loan_type = lt_m.group(1).strip() if lt_m else ""
        loan_type = re.sub(
            r"\s+(Appraiser|Appraisal|Based on ARV|Project Cost|Total Appraisal Value).*$",
            "", loan_type, flags=re.IGNORECASE
        ).strip()

        # Lien position from "Seeking Nth TD Loan" header
        lien_m = re.search(r"Seeking\s+(1st|2nd|3rd|1st\s*&\s*2nd)\s+TD", body, re.IGNORECASE)
        lien_position = lien_m.group(1) if lien_m else ""
        if not lien_position:
            lp_m = re.search(r"Lien Position\s*\n?\s*([^\n]+)", body)
            lien_position = lp_m.group(1).strip() if lp_m else ""

        # Property value + LTV
        # WorkingMoni shows: "$ 435,000  75%  Negotiable" — value then LTV%
        # Match dollar amount immediately followed by a percentage
        val_ltv_m = re.search(r"\$\s*([\d,]+)\s+(\d{2,3})%", body)
        property_value = parse_money(val_ltv_m.group(1)) if val_ltv_m else None
        ltv = parse_pct(f"{val_ltv_m.group(2)}%") if val_ltv_m else None

        # Returns
        ar_m = re.search(r"Annual Return\s*\n?\s*([\d.]+%)", body)
        annual_return = parse_pct(ar_m.group(1)) if ar_m else None

        noi_m = re.search(r"Annual NOI\s*\n?\s*\$\s*([\d,]+)", body)
        annual_income = parse_money(noi_m.group(1)) if noi_m else None

        rent_m = re.search(r"Monthly (?:Rent|NOI)\s*\n?\s*\$\s*([\d,]+)", body)
        monthly_rent = parse_money(rent_m.group(1)) if rent_m else None

        # Terms
        term_m = re.search(r"Desired Loan Term\s*\n?\s*([^\n]+)", body)
        desired_term = term_m.group(1).strip() if term_m else ""

        # Property details
        bldg_m = re.search(r"Building Size[^\n]*\n?\s*([\d,]+)", body)
        building_size = parse_sqft(bldg_m.group(1)) if bldg_m else None

        lot_m = re.search(r"Lot Size[^\n]*\n?\s*([\d.]+\s*/\s*[\d,]+)", body)
        lot_size_raw = lot_m.group(1).strip() if lot_m else ""
        lot_acres = parse_acres(lot_size_raw) if lot_size_raw else None

        occ_m = re.search(r"Occupancy\s*\n?\s*([^\n]+)", body)
        occupancy = occ_m.group(1).strip() if occ_m else ""

        pt_m = re.search(r"Property Type\s*\n?\s*([^\n]+)", body)
        property_type = pt_m.group(1).strip() if pt_m else ""

        fico_m = re.search(r"FICO Score\s*\n?\s*([^\n]+)", body)
        fico_range = fico_m.group(1).strip() if fico_m else ""
        fico_min = parse_fico_min(fico_range)

        lp_m = re.search(r"Loan Purpose\s*\n?\s*([^\n]+)", body)
        loan_purpose = lp_m.group(1).strip() if lp_m else ""

        # Long text
        sum_m = re.search(
            r"Property Summary\s*\n([\s\S]+?)(?:\nExit Plan|\nBorrower|\nProperty Location|$)", body
        )
        prop_summary = sum_m.group(1).strip()[:2000] if sum_m else ""

        exit_m = re.search(
            r"Exit Plan\s*\n([\s\S]+?)(?:\nBorrower|\nProperty Location|$)", body
        )
        exit_plan = exit_m.group(1).strip()[:1000] if exit_m else ""

        bor_m = re.search(
            r"Borrower Introduction\s*\n([\s\S]+?)(?:\nProperty Location|$)", body
        )
        borrower_details = bor_m.group(1).strip()[:1000] if bor_m else ""

        deal_id = deal_id_from_url(url)
        assembled_address = f"{title}, {city}, {state} {zip_code}".strip(", ")

        record = {
            "id":                deal_id,
            "source_url":        url,
            "provenance":        "listing",
            "deal_kind":         deal_kind(loan_type),
            "date_added":        datetime.now(timezone.utc).isoformat(),
            "assembled_address": assembled_address,
            "city":              city,
            "state":             state,
            "zip":               zip_code,
            "loan_type":         loan_type,
            "loan_purpose":      loan_purpose,
            "property_type":     property_type,
            "occupancy":         occupancy,
            "desired_term":      desired_term,
            "lien_position":     lien_position,
            "loan_amount":       loan_amount,
            "property_value":    property_value,
            "value_source":      "listing",
            "ltv":               ltv,
            "annual_return":     annual_return,
            "annual_income":     annual_income,
            "monthly_rent":      monthly_rent,
            "building_size":     building_size,
            "lot_acres":         lot_acres,
            "fico_range":        fico_range,
            "fico_min":          fico_min,
            "property_summary":  prop_summary,
            "exit_plan":         exit_plan,
            "borrower_details":  borrower_details,
            "status":            "New",
            "lane":              "Need Data",
            "priority_flag":     False,
            "deal_data":         json.dumps({"lot_size_raw": lot_size_raw}),
        }
        return {k: v for k, v in record.items()
                if v is not None and v != "" and v != "{}"}

    except Exception as e:
        print(f"  Error scraping {url}: {e}")
        return None


# ── Email ─────────────────────────────────────────────────────────────────────
def send_new_deals_email(new_deals):
    count   = len(new_deals)
    subject = f"ASAP Pipeline — {count} new deal{'s' if count != 1 else ''} added"
    rows = ""
    for d in new_deals:
        deal_id  = d.get("id", "")
        loan_str = f"${d['loan_amount']:,.0f}" if d.get("loan_amount") else "—"
        addr     = d.get("assembled_address") or "(address pending)"
        # Show last 6 chars of deal ID so duplicate-looking addresses are distinguishable
        id_tag = (f"<br><span style='font-size:10px;color:#aaa'>ID: ...{deal_id[-6:]}</span>"
                  if deal_id else "")
        rows += (
            f"<tr><td style='padding:6px 12px'>"
            f"<a href='{d.get('source_url','')}' style='color:#1c75bc;text-decoration:none'>"
            f"{addr}</a>{id_tag}</td>"
            f"<td style='padding:6px 12px'>{d.get('loan_type','—')}</td>"
            f"<td style='padding:6px 12px;font-family:monospace'>{loan_str}</td>"
            f"<td style='padding:6px 12px'>{d.get('state','—')}</td>"
            f"</tr>"
        )
    html = f"""
    <html><body style='font-family:sans-serif;color:#1a1a1a;padding:20px'>
    <h2 style='color:#0e3f63'>ASAP Pipeline — New Deals Added</h2>
    <p>{count} new deal{'s have' if count != 1 else ' has'} been added to your Supabase database.
    Deals at the same address are different properties — click the link to view each on WorkingMoni.</p>
    <table style='border-collapse:collapse;width:100%;font-size:14px'>
      <thead><tr style='background:#0e3f63;color:#fff'>
        <th style='padding:8px 12px;text-align:left'>Address</th>
        <th style='padding:8px 12px;text-align:left'>Loan Type</th>
        <th style='padding:8px 12px;text-align:left'>Loan Amount</th>
        <th style='padding:8px 12px;text-align:left'>State</th>
      </tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <p style='margin-top:16px;color:#888;font-size:12px'>
      {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · ASAP Funding Pipeline Automation
    </p></body></html>"""
    _send_email(subject, html)


def _send_email(subject, html):
    msg            = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = GMAIL_ADDRESS
    msg["To"]      = ", ".join(RECIPIENTS)
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_ADDRESS, GMAIL_PASS)
        s.sendmail(GMAIL_ADDRESS, RECIPIENTS, msg.as_string())
    print(f"  Email sent: {subject}")


# ── Main ──────────────────────────────────────────────────────────────────────
async def run_scrape():
    # Load local seen-deals cache
    try:
        with open(SEEN_FILE) as f:
            seen_local = set(json.load(f))
    except FileNotFoundError:
        seen_local = set()

    added, errored = [], []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            )
        )
        page = await context.new_page()

        try:
            all_links = await get_deal_links(page)
        except Exception as e:
            print(f"Failed to load listing: {e}")
            await browser.close()
            return

        # Filter 1: not in local cache
        candidates = [l for l in all_links if l not in seen_local]
        print(f"  {len(candidates)} not in local cache")

        if candidates:
            # Filter 2: not already in Supabase (catches reset seen_deals.json)
            candidate_ids  = [deal_id_from_url(l) for l in candidates]
            existing_in_db = supabase_get_existing_ids(candidate_ids)
            new_links      = [
                l for l in candidates
                if deal_id_from_url(l) not in existing_in_db
            ]
            # Update local cache with DB-existing ones so we skip them next time
            for l in candidates:
                if deal_id_from_url(l) in existing_in_db:
                    seen_local.add(l)
            print(f"  {len(new_links)} genuinely new deal(s) to scrape")
        else:
            new_links = []

        for url in new_links:
            print(f"  Scraping: {url}")
            record = await scrape_deal(page, url)
            if record:
                if supabase_upsert(record):
                    added.append(record)
                    seen_local.add(url)
                    print(f"  Added: {record.get('assembled_address','')}")
                else:
                    errored.append(url)
            else:
                errored.append(url)
            await asyncio.sleep(1.5)

        # Mark all listed URLs as seen (even already-in-DB ones)
        for url in all_links:
            seen_local.add(url)

        await browser.close()

    with open(SEEN_FILE, "w") as f:
        json.dump(sorted(seen_local), f, indent=2)

    if added:
        send_new_deals_email(added)
        print(f"\nDone — {len(added)} added, {len(errored)} errors")
    else:
        print("\nDone — no new deals found")


def main():
    asyncio.run(run_scrape())


if __name__ == "__main__":
    main()
