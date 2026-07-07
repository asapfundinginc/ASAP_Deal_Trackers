"""
ASAP Pipeline — Morning Availability Check
Runs once daily at 8 AM Pacific via GitHub Actions.
Checks all deals where viewed_status IS NULL.
If a deal is no longer available on WorkingMoni, sets viewed_status = 'liked_na'.
Sends an email summary of what changed.
"""

import asyncio, json, os, re, smtplib, urllib.request
from datetime import datetime
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
HEADERS_WRITE  = {**HEADERS_READ, "Content-Type": "application/json",
                  "Prefer": "return=minimal"}

# Signals that a deal is no longer available (from the deal page screenshot)
UNAVAILABLE_SIGNALS = [
    "INVESTOR SELECTED",
    "On Hold - Investor Selected",
    "Fully Funded",
    "Funding Complete",
    "Closed",
]


# ── Supabase helpers ──────────────────────────────────────────────────────────
def get_deals_to_check() -> list[dict]:
    """Fetch all deals where viewed_status IS NULL and source_url is set."""
    params = "viewed_status=is.null&source_url=not.is.null&select=id,source_url,assembled_address,loan_type,state"
    req = urllib.request.Request(
        f"{SUPABASE_DEALS}?{params}",
        headers=HEADERS_READ
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def mark_unavailable(deal_id: str) -> bool:
    """Set viewed_status = 'liked_na' on a deal."""
    data = json.dumps({"viewed_status": "liked_na"}).encode()
    req  = urllib.request.Request(
        f"{SUPABASE_DEALS}?id=eq.{deal_id}",
        data=data,
        headers=HEADERS_WRITE,
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status in (200, 204)
    except Exception as e:
        print(f"  ✗ Failed to update {deal_id}: {e}")
        return False


# ── Availability check ────────────────────────────────────────────────────────
async def is_deal_available(page, url: str) -> tuple[bool, str]:
    """
    Returns (is_available, reason).
    Checks for investor-selected / funded signals on the deal page.
    """
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=25000)

        # Hard 404 or redirect away from deal page
        if resp and resp.status == 404:
            return False, "Page returned 404"
        if resp and url not in resp.url and "/investors/" not in resp.url:
            return False, "Redirected away from deal page"

        await asyncio.sleep(1.5)
        body = await page.inner_text("body")

        for signal in UNAVAILABLE_SIGNALS:
            if signal.upper() in body.upper():
                return False, signal

        return True, "Still available"

    except Exception as e:
        # Timeout or nav error — treat as unknown, skip rather than mark unavailable
        print(f"  ⚠ Could not load {url}: {e}")
        return None, f"Load error: {e}"


# ── Email ─────────────────────────────────────────────────────────────────────
def send_summary_email(checked: int, unavailable: list[dict], skipped: list[str]):
    if not unavailable and not skipped:
        subject = f"ASAP Pipeline — All {checked} deals still available ✓"
    else:
        subject = f"ASAP Pipeline — {len(unavailable)} deal(s) no longer available"

    rows = ""
    for d in unavailable:
        rows += (
            f"<tr style='background:#fdecea'>"
            f"<td style='padding:6px 12px'>"
            f"<a href='{d['source_url']}' style='color:#c0392b'>"
            f"{d.get('assembled_address') or d['id']}</a></td>"
            f"<td style='padding:6px 12px'>{d.get('loan_type','—')}</td>"
            f"<td style='padding:6px 12px'>{d.get('state','—')}</td>"
            f"<td style='padding:6px 12px;color:#c0392b'>Liked — not available</td>"
            f"</tr>"
        )

    skip_note = ""
    if skipped:
        skip_note = f"<p style='color:#888;font-size:12px'>⚠ {len(skipped)} deal(s) could not be checked (load errors) — will retry tomorrow.</p>"

    html = f"""
    <html><body style='font-family:sans-serif;color:#1a1a1a'>
    <h2 style='color:#0e3f63'>ASAP Pipeline — Morning Availability Check</h2>
    <p>Checked <b>{checked}</b> deal(s) with no viewed status.</p>
    {'<p style="color:#1e9e6a">✓ All deals are still available on WorkingMoni.</p>' if not unavailable else ''}
    {'<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#c0392b;color:#fff"><th style="padding:8px 12px;text-align:left">Address</th><th style="padding:8px 12px;text-align:left">Loan Type</th><th style="padding:8px 12px;text-align:left">State</th><th style="padding:8px 12px;text-align:left">Status</th></tr></thead><tbody>' + rows + '</tbody></table>' if unavailable else ''}
    {skip_note}
    <p style='margin-top:20px;color:#666;font-size:12px'>
      Checked at {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} · ASAP Funding Pipeline Automation
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
    print(f"  ✓ Summary email sent to {', '.join(RECIPIENTS)}")


# ── Main ──────────────────────────────────────────────────────────────────────
async def run_check():
    # 1. Get deals to check from Supabase
    print("Fetching deals with no viewed_status from Supabase…")
    try:
        deals = get_deals_to_check()
    except Exception as e:
        print(f"✗ Failed to fetch deals: {e}")
        return

    print(f"  {len(deals)} deal(s) to check")
    if not deals:
        print("  Nothing to check — all deals have a viewed_status already.")
        return

    unavailable = []
    skipped     = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
        )
        page = await context.new_page()

        for deal in deals:
            url = deal.get("source_url", "")
            addr = deal.get("assembled_address") or deal["id"]
            print(f"  Checking: {addr}")

            available, reason = await is_deal_available(page, url)

            if available is None:
                # Load error — skip, don't mark unavailable
                skipped.append(url)
                print(f"    ⚠ Skipped (load error)")
            elif not available:
                print(f"    ✗ No longer available — {reason}")
                ok = mark_unavailable(deal["id"])
                if ok:
                    unavailable.append(deal)
                    print(f"    ✓ Marked as liked_na in Supabase")
            else:
                print(f"    ✓ Still available")

            await asyncio.sleep(1.5)  # polite crawl rate

        await browser.close()

    # 2. Send summary email
    send_summary_email(len(deals), unavailable, skipped)

    print(f"\n✅ Done — {len(unavailable)} marked unavailable, {len(skipped)} skipped, "
          f"{len(deals) - len(unavailable) - len(skipped)} still available")


def main():
    asyncio.run(run_check())

if __name__ == "__main__":
    main()
