"""
ASAP Pipeline — Deal Availability Check
Runs twice daily (8:45 AM and 2:45 PM Pacific) — always before the scraper.

Logic:
1. Query Supabase for deals where viewed_status IS NULL
   (skips deals added in the last 3 hours to avoid false positives on new deals)
2. Visit each deal's WorkingMoni URL with Playwright
3. If "INVESTOR SELECTED" or similar signal found → set viewed_status = 'liked_na'
4. Email a summary of what changed
"""

import asyncio, json, os, re, smtplib, urllib.request
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from playwright.async_api import async_playwright

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_SVC  = os.environ["SUPABASE_SVC"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_PASS    = os.environ["GMAIL_APP_PASSWORD"]
RECIPIENTS    = [e.strip() for e in os.environ["RECIPIENT_EMAIL"].split(",")]

SUPABASE_DEALS = f"{SUPABASE_URL}/rest/v1/deals"
HEADERS_READ   = {"apikey": SUPABASE_SVC, "Authorization": f"Bearer {SUPABASE_SVC}"}
HEADERS_WRITE  = {
    **HEADERS_READ,
    "Content-Type": "application/json",
    "Prefer":       "return=minimal",
}

# Signals on the deal page that mean it is no longer available
UNAVAILABLE_SIGNALS = [
    "INVESTOR SELECTED",
    "ON HOLD - INVESTOR SELECTED",
    "FULLY FUNDED",
    "FUNDING COMPLETE",
    "CLOSED",
]


# ── Supabase helpers ──────────────────────────────────────────────────────────
def get_deals_to_check() -> list:
    """
    Fetch deals where:
    - viewed_status IS NULL (no status set yet)
    - source_url IS NOT NULL (has a WorkingMoni URL to check)
    - date_added is more than 3 hours ago (avoids false positives on newly added deals)
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    params = (
        "viewed_status=is.null"
        "&source_url=not.is.null"
        f"&date_added=lt.{cutoff}"
        "&select=id,source_url,assembled_address,loan_type,state,loan_amount"
        "&limit=500"
    )
    req = urllib.request.Request(
        f"{SUPABASE_DEALS}?{params}", headers=HEADERS_READ
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def mark_unavailable(deal_id: str) -> bool:
    data = json.dumps({"viewed_status": "liked_na"}).encode()
    req  = urllib.request.Request(
        f"{SUPABASE_DEALS}?id=eq.{deal_id}",
        data=data, headers=HEADERS_WRITE, method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status in (200, 204)
    except Exception as e:
        print(f"  Failed to update {deal_id}: {e}")
        return False


# ── Availability check ────────────────────────────────────────────────────────
async def is_deal_available(page, url: str):
    """
    Returns (available, reason):
      True  = still available
      False = no longer available (found a signal)
      None  = could not load page (skip, try again next run)
    """
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=25000)

        if resp and resp.status == 404:
            return False, "Page 404"

        # If redirected away from the deal page entirely
        if resp and "/investors/" not in resp.url:
            return False, "Redirected away from deal page"

        await asyncio.sleep(1.5)
        body = (await page.inner_text("body")).upper()

        for signal in UNAVAILABLE_SIGNALS:
            if signal in body:
                return False, signal.title()

        return True, "Still available"

    except Exception as e:
        return None, f"Load error: {e}"


# ── Email ─────────────────────────────────────────────────────────────────────
def send_summary_email(checked: int, unavailable: list, skipped: list):
    count = len(unavailable)
    if count == 0:
        subject = f"ASAP Pipeline — All {checked} deals still available"
    else:
        subject = f"ASAP Pipeline — {count} deal(s) no longer available"

    rows = ""
    for d in unavailable:
        deal_id  = d.get("id", "")
        loan_str = f"${d['loan_amount']:,.0f}" if d.get("loan_amount") else "—"
        addr     = d.get("assembled_address") or deal_id
        id_tag   = (f"<br><span style='font-size:10px;color:#aaa'>ID: ...{deal_id[-6:]}</span>"
                    if deal_id else "")
        rows += (
            f"<tr style='background:#fdecea'>"
            f"<td style='padding:6px 12px'>"
            f"<a href='{d.get('source_url','')}' style='color:#c0392b;text-decoration:none'>"
            f"{addr}</a>{id_tag}</td>"
            f"<td style='padding:6px 12px'>{d.get('loan_type','—')}</td>"
            f"<td style='padding:6px 12px;font-family:monospace'>{loan_str}</td>"
            f"<td style='padding:6px 12px'>{d.get('state','—')}</td>"
            f"<td style='padding:6px 12px;color:#c0392b;font-weight:600'>Liked — not available</td>"
            f"</tr>"
        )

    skip_note = ""
    if skipped:
        skip_note = (
            f"<p style='color:#888;font-size:12px'>"
            f"{len(skipped)} deal(s) could not be loaded — will retry next run.</p>"
        )

    all_good = (
        f"<p style='color:#1e9e6a'>All {checked} deals are still available.</p>"
        if count == 0 else ""
    )

    table = ""
    if count > 0:
        table = f"""
        <table style='border-collapse:collapse;width:100%;font-size:14px'>
          <thead><tr style='background:#c0392b;color:#fff'>
            <th style='padding:8px 12px;text-align:left'>Address</th>
            <th style='padding:8px 12px;text-align:left'>Loan Type</th>
            <th style='padding:8px 12px;text-align:left'>Loan Amount</th>
            <th style='padding:8px 12px;text-align:left'>State</th>
            <th style='padding:8px 12px;text-align:left'>Status</th>
          </tr></thead>
          <tbody>{rows}</tbody>
        </table>"""

    html = f"""
    <html><body style='font-family:sans-serif;color:#1a1a1a;padding:20px'>
    <h2 style='color:#0e3f63'>ASAP Pipeline — Availability Check</h2>
    <p>Checked <b>{checked}</b> deal(s) with no viewed status.</p>
    {all_good}{table}{skip_note}
    <p style='margin-top:16px;color:#888;font-size:12px'>
      {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · ASAP Funding Pipeline Automation
    </p></body></html>"""

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
async def run_check():
    print("Fetching deals to check from Supabase...")
    try:
        deals = get_deals_to_check()
    except Exception as e:
        print(f"Failed to fetch deals: {e}")
        return

    print(f"  {len(deals)} deal(s) to check (excludes deals added in last 3 hours)")
    if not deals:
        print("  Nothing to check.")
        return

    unavailable, skipped = [], []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            )
        )
        page = await context.new_page()

        for deal in deals:
            url  = deal.get("source_url", "")
            addr = deal.get("assembled_address") or deal["id"]
            print(f"  Checking: {addr}")

            available, reason = await is_deal_available(page, url)

            if available is None:
                skipped.append(url)
                print(f"    Skipped: {reason}")
            elif not available:
                print(f"    No longer available — {reason}")
                if mark_unavailable(deal["id"]):
                    unavailable.append(deal)
                    print(f"    Marked as liked_na")
            else:
                print(f"    Still available")

            await asyncio.sleep(1.5)

        await browser.close()

    send_summary_email(len(deals), unavailable, skipped)
    print(
        f"\nDone — {len(unavailable)} marked unavailable, "
        f"{len(skipped)} skipped, "
        f"{len(deals) - len(unavailable) - len(skipped)} still available"
    )


def main():
    asyncio.run(run_check())


if __name__ == "__main__":
    main()
