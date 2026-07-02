/***** ASAP PIPELINE — CALL-SHEET DOC PERSISTENCE *************************
 * Paste as a NEW script file ("Pipeline_CallDocs.gs") in the SAME project.
 *
 * Lets the Deal Calculator's "Documents" box remember the PDFs it has read,
 * so a "Refresh deal" / reopen restores their extracted risk flags instead of
 * wiping them. Stores a small JSON record per deal in a CallDocs column on
 * Pipeline_Deals. The PDF file itself is NOT stored (a browser can't restore a
 * file) — only its findings, shown as a "read earlier" row.
 *
 * Self-contained: depends only on M1 globals ss_() and ASAP_CFG.DEALS_TAB.
 * Does not touch M4 or any other file.
 *
 * The calculator calls these directly via google.script.run:
 *   pipeline_saveCallDocs(dealKey, docsJson)   — on every "Read with AI"
 *   pipeline_getCallDocs(dealKey)              — on load, to restore
 ************************************************************************/

/* Resolve the calculator's dealKey ('id:<DealID>' / a trailing hex id / a
   SourceURL) to a row index in vals. Returns -1 if not found. */
function pipeline_cd_findRow_(H, vals, dealKey) {
  var cId = H.indexOf('DealID'), cUrl = H.indexOf('SourceURL');
  var key = String(dealKey == null ? '' : dealKey).trim();
  var idGuess = (key.indexOf('id:') === 0) ? key.slice(3) : '';
  var tailHex = (key.match(/([0-9a-f]{12,})\/?$/i) || [])[1] || '';
  function norm(u){ return String(u || '').trim().replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\//, ''); }
  var keyN = norm(key);
  for (var r = 1; r < vals.length; r++) {
    var did = String(vals[r][cId] || '').trim();
    var url = (cUrl >= 0) ? String(vals[r][cUrl] || '').trim() : '';
    if ((idGuess && did === idGuess) ||
        (tailHex && did === tailHex) ||
        (keyN && url && norm(url) === keyN) ||
        (tailHex && url && url.toLowerCase().indexOf(tailHex.toLowerCase()) >= 0)) return r;
  }
  return -1;
}

/* Save the calculator's read documents (their extracted flags) for this deal. */
function pipeline_saveCallDocs(dealKey, docsJson) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn();
    var H0 = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H0.indexOf('CallDocs') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('CallDocs').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var rowIdx = pipeline_cd_findRow_(H, vals, dealKey);
    if (rowIdx < 0) return { ok: false, error: 'Deal not found for key.' };
    sh.getRange(rowIdx + 1, H.indexOf('CallDocs') + 1).setValue(docsJson == null ? '' : String(docsJson));
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Read back this deal's saved documents so the calculator can restore them. */
function pipeline_getCallDocs(dealKey) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var ci = H.indexOf('CallDocs');
    if (ci < 0) return { ok: true, docs: [] };
    var rowIdx = pipeline_cd_findRow_(H, vals, dealKey);
    if (rowIdx < 0) return { ok: false, error: 'Deal not found for key.' };
    var raw = String(vals[rowIdx][ci] || '');
    if (!raw) return { ok: true, docs: [] };
    var arr = [];
    try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; }
    if (!(arr && arr.join)) arr = [];
    return { ok: true, docs: arr };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Editor sanity check — round-trips a fake record on the first data row. */
function pipeline_testCallDocs() {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cId = H.indexOf('DealID');
  if (vals.length < 2) { Logger.log('No deal rows to test with.'); return; }
  var key = 'id:' + String(vals[1][cId]);
  var sample = JSON.stringify([{ name: 'Test.pdf', type: 'lender_package', flags: [{ name: 'demo flag', sev: 'medium' }], readAt: Date.now() }]);
  Logger.log('save -> ' + JSON.stringify(pipeline_saveCallDocs(key, sample)));
  Logger.log('get  -> ' + JSON.stringify(pipeline_getCallDocs(key)));
}