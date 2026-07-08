"""
ASAP Pipeline — Deal Availability Check
Runs twice daily (8:45 AM and 2:45 PM Pacific) — always before the scraper.

Logic:
1. Query Supabase for deals where viewed_status IS NULL
   Skips deals added in the last 3 hours (avoids checking brand-new deals)
   Checks all deals with no viewed_status
2. Visit each deal URL with Playwright
3. If unavailability signal found → set viewed_status = 'liked_na'
4. Always sends an email summary regardless of results
"""

import asyncio, json, os, smtplib, urllib.request, urllib.parse
from datetime import datetime, timezone
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
HEADERS_WRITE  = {**HEADERS_READ, "Content-Type": "application/json", "Prefer": "return=minimal"}




# ── Supabase helpers ──────────────────────────────────────────────────────────
def get_deals_to_check() -> list:
    """
    Fetch ALL deals where:
    - viewed_status IS NULL (no status set yet)
    - source_url IS NOT NULL (has a WorkingMoni URL to check)

    No date filter — scraper uses availableOnly=true so every added
    deal was available at scrape time. No need to skip recent deals.
    """
    params = urllib.parse.urlencode({
        "viewed_status": "is.null",
        "source_url":    "not.is.null",
        "select":        "id,source_url,assembled_address,loan_type,state,loan_amount",
        "limit":         "500",
    })
    req = urllib.request.Request(f"{SUPABASE_DEALS}?{params}", headers=HEADERS_READ)
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
      False = no longer available
      None  = could not load (skip, retry next run)

    Uses DOM selectors instead of full body text search to avoid false positives.
    Only the two confirmed unavailability signals from WorkingMoni are checked:
      1. "INVESTOR SELECTED!" button at the bottom of the page
      2. "On Hold - Investor Selected" status badge on the deal image
    """
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=25000)

        if resp and resp.status == 404:
            return False, "Page 404"

        if resp and "/investors/" not in resp.url:
            return False, "Redirected away from deal page"

        # Wait for the page to fully render
        await asyncio.sleep(2)

        # Signal 1: "INVESTOR SELECTED!" button (appears at the bottom of unavailable deals)
        # Use text matching on button elements only — not full body text
        selected_btn = await page.query_selector(
            "button:has-text('INVESTOR SELECTED'), "
            "div[class*='button']:has-text('INVESTOR SELECTED'), "
            "a:has-text('INVESTOR SELECTED')"
        )
        if selected_btn:
            return False, "Investor Selected button found"

        # Signal 2: "On Hold - Investor Selected" status badge on the deal image
        on_hold = await page.query_selector(
            "text='On Hold - Investor Selected'"
        )
        if on_hold:
            return False, "On Hold — Investor Selected badge found"

        # Signal 3: "Fully Funded" badge (if WorkingMoni uses this)
        funded = await page.query_selector(
            "text='Fully Funded', text='Funding Complete'"
        )
        if funded:
            return False, "Fully Funded badge found"

        return True, "Still available"

    except Exception as e:
        return None, f"Load error: {e}"


# ── Email — always sent regardless of results ─────────────────────────────────
def send_summary_email(checked: int, unavailable: list, skipped: list, error: str = ""):
    count = len(unavailable)
    now   = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')

    if error:
        subject = "ASAP Pipeline — Availability Check: ERROR"
    elif checked == 0:
        subject = "ASAP Pipeline — Availability Check: no deals to check"
    elif count == 0:
        subject = f"ASAP Pipeline — All {checked} deal(s) still available ✓"
    else:
        subject = f"ASAP Pipeline — {count} deal(s) no longer available"

    # Status summary line
    if error:
        summary = f"<p style='color:#c0392b'>Error: {error}</p>"
    elif checked == 0:
        summary = (
            "<p>No deals were found to check. This means either:<br>"
            "• All deals in the database already have a <code>viewed_status</code> set, or<br>"
            "• No deals with a WorkingMoni URL exist yet.</p>"
        )
    else:
        summary = f"<p>Checked <b>{checked}</b> deal(s) with no viewed status.</p>"

    # Unavailable deals table
    rows = ""
    for d in unavailable:
        deal_id  = d.get("id", "")
        loan_str = f"${d['loan_amount']:,.0f}" if d.get("loan_amount") else "—"
        addr     = d.get("assembled_address") or deal_id
        id_tag   = f"<br><span style='font-size:10px;color:#aaa'>ID: ...{deal_id[-6:]}</span>" if deal_id else ""
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

    table = ""
    if count > 0:
        table = f"""
        <table style='border-collapse:collapse;width:100%;font-size:14px;margin-top:12px'>
          <thead><tr style='background:#c0392b;color:#fff'>
            <th style='padding:8px 12px;text-align:left'>Address</th>
            <th style='padding:8px 12px;text-align:left'>Loan Type</th>
            <th style='padding:8px 12px;text-align:left'>Loan Amount</th>
            <th style='padding:8px 12px;text-align:left'>State</th>
            <th style='padding:8px 12px;text-align:left'>Status</th>
          </tr></thead><tbody>{rows}</tbody>
        </table>"""

    all_good = (
        f"<p style='color:#1e9e6a;font-weight:600'>✓ All {checked} deals are still available.</p>"
        if checked > 0 and count == 0 else ""
    )

    skip_note = (
        f"<p style='color:#888;font-size:12px'>⚠ {len(skipped)} deal(s) could not be loaded "
        f"and will be retried next run.</p>"
    ) if skipped else ""

    html = f"""
    <html><body style='font-family:sans-serif;color:#1a1a1a;padding:20px'>
    <h2 style='color:#0e3f63'>ASAP Pipeline — Availability Check</h2>
    {summary}{all_good}{table}{skip_note}
    <p style='margin-top:16px;color:#888;font-size:12px'>
      {now} · ASAP Funding Pipeline Automation
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
        send_summary_email(0, [], [], error=str(e))
        return

    print(f"  {len(deals)} deal(s) to check")

    if not deals:
        # Always send email even when nothing to check
        send_summary_email(0, [], [])
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

    # Always send email
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
