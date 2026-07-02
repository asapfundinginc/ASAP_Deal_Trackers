/**
 * Pipeline_CalcStore.gs  (HARDENED)
 * Per-deal persistence for the Deal Calculator.
 * Stores each deal's calculator inputs as one row in a "Pipeline_CalcInputs" tab:
 *   DealKey | Inputs (JSON) | UpdatedAt
 *
 * WHAT CHANGED vs the old version:
 *   - Reads and writes are wrapped in try/catch. A transient Google
 *     "INTERNAL" storage error now returns '' (read) or false (write)
 *     instead of crashing the calculator — the deal simply loads fresh.
 *   - Reads retry once after a short pause (these INTERNAL errors are
 *     often transient).
 *   - Saves are size-guarded to stay under the 50,000-character cell
 *     limit, so an oversized snapshot can never corrupt a cell.
 *
 * Self-contained: finds the spreadsheet via existing helpers if present
 * (ss_ / getLogSheet), otherwise falls back to the known Log spreadsheet ID.
 * No changes to Code.gs required.
 */

var CALC_INPUTS_TAB_ = 'Pipeline_CalcInputs';
var CALC_LOG_SS_ID_  = '1bfbptTehrBLjP7fyLYyAXRDfuExAvaBacofJyJfgGeM';
var CALC_MAX_JSON_    = 45000;   // safety margin under the 50,000-char cell limit

function calcStoreSS_() {
  try { if (typeof ss_ === 'function') { var a = ss_(); if (a) return a; } } catch (e) {}
  try { if (typeof getLogSheet === 'function') { var b = getLogSheet(); if (b) return b.getParent(); } } catch (e) {}
  return SpreadsheetApp.openById(CALC_LOG_SS_ID_);
}

function calcInputsSheet_() {
  var ss = calcStoreSS_();
  var sh = ss.getSheetByName(CALC_INPUTS_TAB_);
  if (!sh) {
    sh = ss.insertSheet(CALC_INPUTS_TAB_);
    sh.getRange(1, 1, 1, 3).setValues([['DealKey', 'Inputs (JSON)', 'UpdatedAt']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setColumnWidth(1, 260);
    sh.setColumnWidth(2, 520);
    sh.setColumnWidth(3, 160);
  }
  return sh;
}

function calcFindRow_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var keys = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(key)) return i + 2;
  }
  return 0;
}

/** Save (upsert) a deal's calculator inputs. Called from the dashboard. */
function Pipeline_saveCalcInputs(dealKey, json) {
  dealKey = String(dealKey || '').trim();
  if (!dealKey) return false;
  json = String(json || '');
  if (json.length > CALC_MAX_JSON_) return false;   // too big for one cell — skip rather than corrupt
  try {
    var sh = calcInputsSheet_();
    var row = calcFindRow_(sh, dealKey);
    var now = new Date();
    if (row) {
      sh.getRange(row, 2, 1, 2).setValues([[json, now]]);
    } else {
      sh.appendRow([dealKey, json, now]);
    }
    return true;
  } catch (e) {
    return false;   // storage hiccup — don't crash the calculator
  }
}

/** Fetch a deal's saved calculator inputs (JSON string), or '' if none / on any error. */
function Pipeline_getCalcInputs(dealKey) {
  dealKey = String(dealKey || '').trim();
  if (!dealKey) return '';
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var sh = calcInputsSheet_();
      var row = calcFindRow_(sh, dealKey);
      if (!row) return '';
      return String(sh.getRange(row, 2).getValue() || '');
    } catch (e) {
      if (attempt === 0) { Utilities.sleep(400); continue; }  // transient INTERNAL? retry once
      return '';   // give up gracefully — calc loads fresh instead of erroring
    }
  }
  return '';
}

/** Optional: clear a deal's saved inputs (used if you ever want a reset button). */
function Pipeline_clearCalcInputs(dealKey) {
  dealKey = String(dealKey || '').trim();
  if (!dealKey) return false;
  try {
    var sh = calcInputsSheet_();
    var row = calcFindRow_(sh, dealKey);
    if (row) { sh.deleteRow(row); return true; }
  } catch (e) {}
  return false;
}