/***** ASAP PIPELINE — OUTREACH LOG ***************************************
 * NEW file. Stores the per-deal outreach log (calls + emails logged on the
 * card) in ONE new column, OutreachLog, on Pipeline_Deals. Self-creates the
 * column on first save — no other setup. Read back by pipeline_getBoard.
 ****************************************************************************/
function pipeline_saveOutreachLog(dealId, logJson) {
  try {
    if (!dealId) return { ok: false, error: 'Missing deal id.' };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('OutreachLog') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('OutreachLog').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    sh.getRange(rowIdx + 1, H.indexOf('OutreachLog') + 1).setValue(logJson == null ? '' : String(logJson));
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}