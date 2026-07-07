"""
ASAP Pipeline — WorkingMoni Deal Scraper
Runs twice daily via GitHub Actions.
New deals are inserted directly into Supabase deals table.
A summary email is sent listing what was added.
"""

import asyncio, json, os, re, smtplib, traceback
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────
LISTING_URL   = "https://workingmoni.com/investors"
SEEN_FILE     = "seen_deals.json"
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_SVC  = os.environ["SUPABASE_SVC"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_PASS    = os.environ["GMAIL_APP_PASSWORD"]
RECIPIENTS    = [e.strip() for e in os.environ["RECIPIENT_EMAIL"].split(",")]

SUPABASE_DEALS = f"{SUPABASE_URL}/rest/v1/deals"
HEADERS_READ  = {"apikey": SUPABASE_SVC, "Authorization": f"Bearer {SUPABASE_SVC}"}
HEADERS_WRITE = {**HEADERS_READ, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"}


# ── Supabase helpers ──────────────────────────────────────────────────────────
def supabase_upsert(record: dict) -> bool:
    import urllib.request
    data = json.dumps(record).encode()
    req  = urllib.request.Request(SUPABASE_DEALS, data=data,
                                  headers=HEADERS_WRITE, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status in (200, 201, 204)
    except Exception as e:
        print(f"  ✗ Supabase insert failed: {e}")
        return False


# ── Field parsers ─────────────────────────────────────────────────────────────
def parse_money(s: str):
    """'$ 326,500' → 326500.0"""
    if not s:
        return None
    n = re.sub(r"[^0-9.]", "", s)
    try:
        return float(n) if n else None
    except ValueError:
        return None

def parse_pct(s: str):
    """'75%' → 0.75"""
    if not s:
        return None
    m = re.search(r"([\d.]+)", s)
    return float(m.group(1)) / 100 if m else None

def parse_acres(s: str):
    """'1.37 / 59,677' → 1.37"""
    if not s:
        return None
    m = re.match(r"([\d.]+)", s.strip())
    return float(m.group(1)) if m else None

def parse_sqft(s: str):
    """'2,874' → 2874.0"""
    if not s:
        return None
    n = re.sub(r"[^0-9]", "", s)
    return float(n) if n else None

def parse_fico_min(s: str):
    """'700–719' → 700, 'Below 620' → None, '800+' → 800"""
    if not s:
        return None
    m = re.match(r"(\d{3})", s)
    return int(m.group(1)) if m else None

def deal_id_from_url(url: str) -> str:
    """https://workingmoni.com/investors/6a0e19551232ea6a8e82d5ee → 6a0e19551232ea6a8e82d5ee"""
    return url.rstrip("/").split("/")[-1]

def deal_kind(loan_type: str) -> str:
    t = (loan_type or "").lower()
    if "ground" in t or "construct" in t:  return "groundup"
    if "fix" in t or "flip" in t:          return "fixflip"
    if "dscr" in t or "rental" in t:       return "dscr"
    if "cash" in t and "out" in t:         return "cashout"
    if "foreclosure" in t or "bailout" in t: return "bridge"
    if "refinanc" in t or "refi" in t:    return "refi"
    if "bridge" in t:                      return "bridge"
    if "purchase" in t or "acquisition" in t: return "purchase"
    if "land" in t or "lot" in t:          return "land"
    return "bridge"


# ── Page helpers ──────────────────────────────────────────────────────────────
async def safe_text(page, selector: str, fallback="") -> str:
    try:
        el = await page.query_selector(selector)
        return (await el.inner_text()).strip() if el else fallback
    except Exception:
        return fallback

async def text_after_label(page, label: str) -> str:
    """Find a value that follows a bolded label on the deal page."""
    try:
        els = await page.query_selector_all("div.flex, div.grid, dl, section")
        for el in els:
            txt = (await el.inner_text()).strip()
            if label.lower() in txt.lower():
                # Remove the label itself and return the remainder
                cleaned = re.sub(re.escape(label), "", txt, flags=re.IGNORECASE).strip()
                first_line = cleaned.split("\n")[0].strip()
                if first_line:
                    return first_line
        return ""
    except Exception:
        return ""


# ── Listing page: get all deal URLs ──────────────────────────────────────────
async def get_deal_links(page) -> list[str]:
    print("  Loading listing page…")
    await page.goto(LISTING_URL, wait_until="domcontentloaded", timeout=45000)
    await page.wait_for_function(
        "() => document.body.innerText.includes('Seeking')", timeout=30000
    )
    await asyncio.sleep(3)
    for _ in range(5):
        await page.mouse.wheel(0, 2000)
        await asyncio.sleep(0.8)
    await asyncio.sleep(2)

    links = await page.eval_on_selector_all(
        "a[href*='/investors/']",
        "els => els.map(e => e.href)"
    )
    seen = set()
    out  = []
    for l in links:
        clean = l.split("?")[0].rstrip("/")
        if "/investors/" in clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    print(f"  Found {len(out)} deal links")
    return out


# ── Individual deal page: extract all fields ──────────────────────────────────
async def scrape_deal(page, url: str) -> dict | None:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)

        body = await page.inner_text("body")

        # ── Address / location ───────────────────────────────────────────────
        # Breadcrumb shows "Home › Investor › Fred Smith Rd"
        breadcrumb = await safe_text(page, "nav[aria-label='breadcrumb'], .breadcrumb, ol.breadcrumb")
        title = await safe_text(page, "h1")
        # City/State/Zip usually in subtitle under the title
        subtitle = await safe_text(page, "h1 + p, h1 ~ p, h2 + p")
        city, state, zip_code = "", "", ""
        m = re.search(r"([^,]+),\s*([A-Z]{2})\s*(\d{5})", subtitle)
        if m:
            city, state, zip_code = m.group(1).strip(), m.group(2), m.group(3)

        # ── Loan details ─────────────────────────────────────────────────────
        # "Seeking 1st TD Loan  $326,500"
        seeking_match = re.search(r"Seeking[^\$]*\$([\d,]+)", body)
        loan_amount   = parse_money(seeking_match.group(1)) if seeking_match else None

        loan_type_m   = re.search(r"Loan Type\s*\n?\s*(\w[\w\s&/-]+)", body)
        loan_type     = loan_type_m.group(1).strip() if loan_type_m else ""

        # Lien position from "Seeking Nth TD Loan"
        lien_m = re.search(r"Seeking\s+(1st|2nd|3rd|1st\s*&\s*2nd)\s+TD", body, re.IGNORECASE)
        lien_position = lien_m.group(1).replace(" ", " ") if lien_m else ""

        # ── Key metrics table ─────────────────────────────────────────────────
        appraiser_m = re.search(r"\$([\d,]+)\s", body)   # first $ value on page = appraised/market
        property_value = parse_money(appraiser_m.group(1)) if appraiser_m else None

        ltv_m  = re.search(r"(\d{2,3})%\s*(?=\n|$|\s*Annual)", body)
        ltv    = parse_pct(ltv_m.group(0)) if ltv_m else None

        return_m      = re.search(r"Annual Return\s*\n?\s*([\w\s]+(?:Negotiable|\d+%[\+]?))", body)
        annual_return_str = return_m.group(1).strip() if return_m else ""
        annual_return = parse_pct(annual_return_str) if "%" in annual_return_str else None

        fico_m  = re.search(r"FICO Score\s*\n?\s*([^\n]+)", body)
        fico_range = fico_m.group(1).strip() if fico_m else ""
        fico_min   = parse_fico_min(fico_range)

        noi_m      = re.search(r"Annual NOI\s*\n?\s*\$([\d,]+)", body)
        annual_income = parse_money(noi_m.group(1)) if noi_m else None

        rent_m     = re.search(r"Monthly (?:Rent|NOI)\s*\n?\s*\$([\d,]+)", body)
        monthly_rent = parse_money(rent_m.group(1)) if rent_m else None

        term_m     = re.search(r"Desired Loan Term\s*\n?\s*([^\n]+)", body)
        desired_term = term_m.group(1).strip() if term_m else ""

        bldg_m     = re.search(r"Building Size[^\n]*\n?\s*([\d,]+)", body)
        building_size = parse_sqft(bldg_m.group(1)) if bldg_m else None

        lot_m      = re.search(r"Lot Size[^\n]*\n?\s*([\d.]+\s*/\s*[\d,]+)", body)
        lot_size_raw = lot_m.group(1).strip() if lot_m else ""
        lot_acres  = parse_acres(lot_size_raw) if lot_size_raw else None

        occ_m      = re.search(r"Occupancy\s*\n?\s*([^\n]+)", body)
        occupancy  = occ_m.group(1).strip() if occ_m else ""

        pt_m       = re.search(r"Property Type\s*\n?\s*([^\n]+)", body)
        property_type = pt_m.group(1).strip() if pt_m else ""

        lp_m       = re.search(r"Loan Purpose\s*\n?\s*([^\n]+)", body)
        loan_purpose = lp_m.group(1).strip() if lp_m else ""

        # ── Long text fields ─────────────────────────────────────────────────
        # Property Summary section
        summary_m  = re.search(r"Property Summary\s*\n([\s\S]+?)(?:\n(?:Exit Plan|Borrower|Property Location|$))", body)
        prop_summary = summary_m.group(1).strip()[:2000] if summary_m else ""

        exit_m     = re.search(r"Exit Plan\s*\n([\s\S]+?)(?:\n(?:Borrower|Property Location|$))", body)
        exit_plan  = exit_m.group(1).strip()[:1000] if exit_m else ""

        borrower_m = re.search(r"Borrower Introduction\s*\n([\s\S]+?)(?:\n(?:Property Location|$))", body)
        borrower_details = borrower_m.group(1).strip()[:1000] if borrower_m else ""

        # ── Build Supabase record ────────────────────────────────────────────
        deal_id = deal_id_from_url(url)
        record = {
            "id":               deal_id,
            "source_url":       url,
            "provenance":       "listing",
            "deal_kind":        deal_kind(loan_type),
            "date_added":       datetime.utcnow().isoformat(),
            # location
            "city":             city,
            "state":            state,
            "zip":              zip_code,
            "assembled_address": f"{title}, {city}, {state} {zip_code}".strip(", "),
            # classification
            "loan_type":        loan_type,
            "loan_purpose":     loan_purpose,
            "property_type":    property_type,
            "occupancy":        occupancy,
            "desired_term":     desired_term,
            "lien_position":    lien_position,
            # financials
            "loan_amount":      loan_amount,
            "property_value":   property_value,
            "value_source":     "listing",
            "ltv":              ltv,
            "annual_return":    annual_return,
            "annual_income":    annual_income,
            "monthly_rent":     monthly_rent,
            # property details
            "building_size":    building_size,
            "lot_acres":        lot_acres,
            # borrower
            "fico_range":       fico_range,
            "fico_min":         fico_min,
            "property_summary": prop_summary,
            "exit_plan":        exit_plan,
            "borrower_details": borrower_details,
            # pipeline defaults
            "status":           "New",
            "lane":             "Need Data",
            "priority_flag":    False,
            # store raw lot size in deal_data
            "deal_data": json.dumps({"lot_size_raw": lot_size_raw}) if lot_size_raw else "{}",
        }
        # Remove None values so Supabase uses column defaults
        return {k: v for k, v in record.items() if v is not None and v != ""}

    except Exception as e:
        print(f"  ✗ Error scraping {url}: {e}")
        return None


# ── Email ─────────────────────────────────────────────────────────────────────
def send_email(new_deals: list[dict]):
    subject = f"ASAP Pipeline — {len(new_deals)} new deal{'s' if len(new_deals) != 1 else ''} added"

    rows = ""
    for d in new_deals:
        loan_str = f"${d['loan_amount']:,.0f}" if d.get('loan_amount') else "—"
        rows += (
            f"<tr>"
            f"<td style='padding:6px 12px'>"
            f"<a href='{d['source_url']}' style='color:#1c75bc;text-decoration:none'>"
            f"{d.get('assembled_address','(address pending)')}</a></td>"
            f"<td style='padding:6px 12px'>{d.get('loan_type','—')}</td>"
            f"<td style='padding:6px 12px'>{loan_str}</td>"
            f"<td style='padding:6px 12px'>{d.get('state','—')}</td>"
            f"</tr>"
        )

    html = f"""
    <html><body style='font-family:sans-serif;color:#1a1a1a'>
    <h2 style='color:#0e3f63'>ASAP Pipeline — New Deals Added</h2>
    <p>{len(new_deals)} new deal{'s have' if len(new_deals)!=1 else ' has'} been added to your Supabase database.</p>
    <table style='border-collapse:collapse;width:100%;font-size:14px'>
      <thead>
        <tr style='background:#0e3f63;color:#fff'>
          <th style='padding:8px 12px;text-align:left'>Address</th>
          <th style='padding:8px 12px;text-align:left'>Loan Type</th>
          <th style='padding:8px 12px;text-align:left'>Loan Amount</th>
          <th style='padding:8px 12px;text-align:left'>State</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    <p style='margin-top:20px;color:#666;font-size:12px'>
      Added at {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} · ASAP Funding Pipeline Automation
    </p>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = GMAIL_ADDRESS
    msg["To"]      = ", ".join(RECIPIENTS)
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_ADDRESS, GMAIL_PASS)
        s.sendmail(GMAIL_ADDRESS, RECIPIENTS, msg.as_string())
    print(f"  ✓ Email sent to {', '.join(RECIPIENTS)}")


# ── Main ──────────────────────────────────────────────────────────────────────
async def run_scrape():
    # Load seen deals
    try:
        with open(SEEN_FILE) as f:
            seen = set(json.load(f))
    except FileNotFoundError:
        seen = set()

    added   = []
    errored = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
        )
        page = await context.new_page()

        # 1. Get all current deal URLs
        try:
            all_links = await get_deal_links(page)
        except Exception as e:
            print(f"✗ Failed to load listing page: {e}")
            await browser.close()
            return

        # 2. Filter to new ones only
        new_links = [l for l in all_links if l not in seen]
        print(f"  {len(new_links)} new deal(s) to process")

        # 3. Scrape and insert each new deal
        for url in new_links:
            print(f"  Scraping: {url}")
            record = await scrape_deal(page, url)
            if record:
                ok = supabase_upsert(record)
                if ok:
                    added.append(record)
                    seen.add(url)
                    print(f"  ✓ Added: {record.get('assembled_address','')}")
                else:
                    errored.append(url)
            else:
                errored.append(url)
            await asyncio.sleep(1.5)  # polite crawl rate

        await browser.close()

    # 4. Save updated seen list
    with open(SEEN_FILE, "w") as f:
        json.dump(sorted(seen), f, indent=2)

    # 5. Send email if anything new
    if added:
        send_email(added)
        print(f"\n✅ Done — {len(added)} deal(s) added, {len(errored)} error(s)")
    else:
        print("\n✅ Done — no new deals found")

    if errored:
        print(f"  Errored URLs: {errored}")


def main():
    asyncio.run(run_scrape())

if __name__ == "__main__":
    main()
