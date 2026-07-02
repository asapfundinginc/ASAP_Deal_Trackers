/***** TRACKER CLEANUP — paste anywhere, then: Run ▸ cleanupTracker ********
 * 1) Rebuilds the Current Status dropdown as a fixed list that INCLUDES
 *    "On Hold" (baked in, so it can't fall off like the range version did).
 * 2) Retires Loan Data + Helper by HIDING them (fully reversible:
 *    right-click any tab > Unhide sheet). Hiding never breaks formulas.
 * Your numbers/summaries live on Loan Tracker and are untouched.
 ****************************************************************************/
function cleanupTracker() {
  var TRACKER_ID = '1M7tbNvwJxmksCgzRO6dRI-Yu4sonKpg0It4NHcB9F50';
  var STATUSES = ['Application','Application Received','Waiting on Docs',
    'Waiting on Request Docs','Processing','Underwriting','Pre-Approved',
    'Conditionally Approved','Clear to Close','Emailed Loan App','Funded',
    'Dead','On Hold'];
  var log = [];
  try {
    var ss = SpreadsheetApp.openById(TRACKER_ID);

    // 1) bulletproof dropdown on Loan Tracker (fixed list, no range dependency)
    var rule = SpreadsheetApp.newDataValidation()
                 .requireValueInList(STATUSES, true)   // true = show dropdown
                 .setAllowInvalid(true)                // keep any existing odd values
                 .build();
    var lt = ss.getSheetByName('Loan Tracker');
    if (!lt) { log.push('FATAL: no "Loan Tracker" tab.'); Logger.log(log.join('\n')); return; }
    var vals = lt.getDataRange().getValues();
    var hr = -1;
    for (var r = 0; r < vals.length; r++) {
      if (vals[r].map(function (x) { return String(x || '').toLowerCase().trim(); }).indexOf('borrower name') >= 0) { hr = r; break; }
    }
    if (hr < 0) { log.push('FATAL: no header row on Loan Tracker.'); Logger.log(log.join('\n')); return; }
    var hdr = vals[hr].map(function (x) { return String(x || '').toLowerCase().trim(); });
    var c = hdr.indexOf('current status');
    if (c < 0) { log.push('FATAL: no Current Status column.'); Logger.log(log.join('\n')); return; }
    var n = lt.getMaxRows() - (hr + 1);
    lt.getRange(hr + 2, c + 1, n, 1).setDataValidation(rule);
    log.push('Dropdown rebuilt on Loan Tracker (col ' + (c + 1) + ', rows ' + (hr + 2) + '-' + lt.getMaxRows() + ') incl. "On Hold".');

    // 2) retire Loan Data + Helper (hide = reversible, safe)
    ['Loan Data', 'Helper'].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (sh) { sh.hideSheet(); log.push('Hid "' + name + '" (reversible).'); }
      else { log.push('"' + name + '" not found (already gone).'); }
    });
  } catch (e) { log.push('ERROR: ' + e); }
  Logger.log(log.join('\n'));
}