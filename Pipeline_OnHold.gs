/***** Repoint the On Hold tab to read your LOAN TRACKER tab *****************
 * Paste anywhere, then: Run ▸ fixOnHoldSource   (read-mostly, safe)
 * Only rewrites the formula in the On Hold tab. Touches nothing else.
 ****************************************************************************/
function fixOnHoldSource() {
  var ss = SpreadsheetApp.openById('1M7tbNvwJxmksCgzRO6dRI-Yu4sonKpg0It4NHcB9F50');
  var oh = ss.getSheetByName('On Hold');
  if (!oh) { Logger.log('No "On Hold" tab found — run setupOnHold first.'); return; }
  oh.clearContents();
  // Loan Tracker: header is row 6, Current Status is column C
  var f = '=IFERROR(QUERY(\'Loan Tracker\'!A6:Q, "select * where C = \'On Hold\'", 1), "No deals are on hold right now.")';
  oh.getRange(1, 1).setFormula(f);
  Logger.log('Done. The On Hold tab now auto-lists Loan Tracker rows where Current Status = "On Hold".');
}