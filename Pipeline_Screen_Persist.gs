/***** ASAP PIPELINE — IMPORT-TIME AI SCREEN + PERSIST  (Pipeline_Screen_Persist.gs)
 * Paste as a NEW file in the SAME project as M1–M4 + Pipeline_Screen.gs.
 *
 * WHAT THIS DOES (and why it's a separate file)
 *   The screener (Pipeline_Screen.gs) can run a Gemini metrics-read, but calling it
 *   on every board load would be slow + costly. This file runs that AI screen ONCE
 *   per NEW deal — server-side, no human — and SAVES the result onto the deal's row.
 *   The board (compactDeal_) then just READS the saved screen: free + instant, with
 *   the AI one-line, confidence, chase score, and any extra killers/missing baked in.
 *
 *   It does the work WITHOUT touching pipeline_uploadDeals (so your M4 — which holds
 *   your e-mail-signature photo — is left exactly as-is). A 5-minute time trigger
 *   screens any deal that hasn't been AI-screened yet, then leaves it alone.
 *
 * ONE-TIME SETUP (run once from the editor; approve the auth prompt):
 *       pipeline_screenSetup()
 *   -> adds the Screen* columns, installs the 5-min trigger, and AI-screens whatever
 *      is already on the board. After that it's automatic. Re-running is harmless.
 *
 * OPTIONAL — make it instant AT upload (not within 5 min): add this ONE line inside
 *   pipeline_uploadDeals (M4), just before its final `return { ok: true, ... }`:
 *       try { if (imported > 0) pipeline_screenNewDeals_({ ai: true, max: 12 }); } catch (e) {}
 *   (The trigger still mops up anything beyond 12 in a big upload.)
 *
 * Reads GEMINI_KEY (+ optional GEMINI_MODEL) from Script Properties — same key the
 * rest of the app uses. New columns: ScreenColumn, ScreenConf, ScreenChase,
 * ScreenLine, ScreenJSON (ScreenJSON is the full saved screen the board reads).
 ****************************************************************************/

/* Build the screener input from a screened deal — IDENTICAL shape to the one
 * compactDeal_ builds, so the saved "fingerprint" matches on read. */
function Pipeline_screenInput_(sr, d) {
  return {
    type: sr.cat,
    purpose: prettyType_(d.LoanType),
    loan:  sr.loan  ? ('$' + comma_(sr.loan))  : String(d.LoanAmount || '\u2014'),
    value: sr.value ? ('$' + comma_(sr.value)) : '\u2014',
    ltv:   sr.ltv   ? pct_(sr.ltv)             : '\u2014',
    dscr:  sr.dscr  ? sr.dscr.toFixed(2)       : '',
    rent:  (d.MonthlyRent ? ('$' + comma_(money_(d.MonthlyRent)) + '/mo') : '') || (d.MarketRent ? ('$' + d.MarketRent) : ''),
    fico:  String(d.FICO || ''),
    lien:  String(d.LienPosition || ''),
    acres: (d.LotAcres !== '' && d.LotAcres != null) ? (d.LotAcres + ' ac') : '',
    propClass: prettyClass_(d.PropertyType)
  };
}

/* A short fingerprint of the numbers the screen depends on. If it changes (deal
 * edited), the saved AI screen is treated as stale and re-derived deterministically. */
function Pipeline_screenFp_(input) {
  function n(v) { var x = _num(v); return x == null ? '' : String(x); }
  return [
    _type(input), n(input.loan), n(input.value), n(input.ltv), n(input.dscr),
    n(input.rent), n(input.fico), n(input.lien), n(input.acres),
    String(input.propClass || '').toLowerCase().slice(0, 12)
  ].join('|');
}

/* Make sure the Screen* columns exist (independent of M4's pipeline_ensureColumns_). */
function pipeline_ensureScreenColumns_() {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  if (!sh) return;
  var lastCol = sh.getLastColumn();
  var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  ['ScreenColumn', 'ScreenConf', 'ScreenChase', 'ScreenLine', 'ScreenJSON'].forEach(function (name) {
    if (H.indexOf(name) < 0) { lastCol++; sh.getRange(1, lastCol).setValue(name).setFontWeight('bold'); H.push(name); }
  });
}

/* Write one screen result onto a deal row. */
function Pipeline_persistScreen_(sh, rowIdx, H, sc) {
  function set(name, v) { var c = H.indexOf(name); if (c >= 0) sh.getRange(rowIdx + 1, c + 1).setValue(v == null ? '' : v); }
  set('ScreenColumn', sc.column || '');
  set('ScreenConf',  sc.confidence || '');
  set('ScreenChase', (sc.chaseScore != null ? sc.chaseScore : ''));
  set('ScreenLine',  sc.oneLine || '');
  set('ScreenJSON',  JSON.stringify(sc));
}

/* THE WORKER — AI-screen deals that haven't been screened yet, then persist.
 * opts: { ai:true|false (default true), force:true re-screens already-screened rows,
 *         max: cap per run (default 25, quota/runtime safety) }.
 * Called by the 5-minute trigger (which passes a trigger event we safely ignore). */
function pipeline_screenNewDeals_(opts) {
  opts = (opts && typeof opts === 'object' && !opts.triggerUid) ? opts : {};   // ignore the trigger event object
  var withAI = (opts.ai !== false);
  var force  = !!opts.force;
  var max    = opts.max || 25;

  pipeline_ensureScreenColumns_();
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cArch = H.indexOf('Archived'), cJSON = H.indexOf('ScreenJSON');

  var screened = 0, skipped = 0, failed = 0;
  for (var r = 1; r < vals.length && screened < max; r++) {
    if (cArch >= 0 && String(vals[r][cArch]).trim() !== '') { continue; }           // archived -> off the board
    var hasScreen = cJSON >= 0 && String(vals[r][cJSON] || '').trim() !== '';
    if (hasScreen && !force) { skipped++; continue; }                                // already AI-screened -> leave it (cost control)
    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i];
    var sr; try { sr = screenDeal(d); } catch (e) { failed++; continue; }
    if (sr.decision === 'FAIL') { skipped++; continue; }                             // not shown on the board
    var input = Pipeline_screenInput_(sr, d);
    var sc;  try { sc = pipeline_screenDeal(input, { ai: withAI }); } catch (e) { failed++; continue; }
    sc.fp = Pipeline_screenFp_(input);
    Pipeline_persistScreen_(sh, r, H, sc);
    screened++;
  }
  return { ok: true, screened: screened, skipped: skipped, failed: failed, withAI: withAI };
}

/* Install the 5-minute background trigger (idempotent). */
function pipeline_installScreenTrigger_() {
  var fn = 'pipeline_screenNewDeals_';
  var have = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; });
  if (have) return { ok: true, already: true };
  ScriptApp.newTrigger(fn).timeBased().everyMinutes(5).create();
  return { ok: true, created: true };
}

/* RUN ONCE from the editor: columns + trigger + first AI screen of what's on the board. */
function pipeline_screenSetup() {
  pipeline_ensureScreenColumns_();
  var t = pipeline_installScreenTrigger_();
  var s = pipeline_screenNewDeals_({ ai: true });
  Logger.log('Screen setup -> trigger ' + JSON.stringify(t) + '  |  first run ' + JSON.stringify(s));
  return { trigger: t, run: s };
}

/* Manual: AI-screen EVERYTHING now (e.g. right after a big upload). Re-screens all
 * non-archived, non-FAIL rows. Run from the editor; safe to re-run. */
function pipeline_screenAllNow() {
  var s = pipeline_screenNewDeals_({ ai: true, force: true, max: 200 });
  Logger.log('screenAllNow -> ' + JSON.stringify(s));
  return s;
}

/* Remove the background trigger (if you ever want to stop the auto-screen). */
function pipeline_removeScreenTrigger_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pipeline_screenNewDeals_') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Removed ' + n + ' screen trigger(s).');
  return { ok: true, removed: n };
}