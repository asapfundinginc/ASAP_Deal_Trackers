/***** Pipeline_ManualAdd.gs — shared deal-create + manual add *****/

/**
 * SHARED CREATE GATE.
 * Manual-add uses this now; the future loan-app originator and the dedupe
 * logic will call this SAME function (just adding a match-check in front).
 * Writes one row to Pipeline_Deals, mapping by HEADER NAME (robust to schema
 * changes / column reordering — never hard-coded positions).
 *
 * fields: { borrowerName, borrowerEmail, address, state, loanAmount, loanType, marketValue, fico }
 * provenance: "Manual / phone" | "Loan App — direct" | "WorkingMoni" | ...
 * returns { ok:true, dealId } | { ok:false, error }
 */
function pipeline_createDeal_(fields, provenance) {
  fields = fields || {};
  try {
    var sh = _mad_dealsSheet_();
    if (!sh) return { ok: false, error: 'Pipeline_Deals sheet not found' };

    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var idx = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] == null ? '' : headers[i]).trim();
      if (h) idx[h] = i;
    }

    var dealId = _mad_newDealId_(sh, idx);
    var addr = String(fields.address || '').trim();
    var row = [];
    for (var c = 0; c < lastCol; c++) row.push('');
    function put(name, val) { if (idx[name] != null) row[idx[name]] = val; }

    put('DealID', dealId);
    put('BorrowerName', String(fields.borrowerName || '').trim());
    put('BorrowerEmail', String(fields.borrowerEmail || '').trim());
    put('AssembledAddress', addr);
    put('Street', addr);
    put('State', String(fields.state || '').trim().toUpperCase());
    put('LoanAmount', _mad_num_(fields.loanAmount));
    put('LoanType', String(fields.loanType || '').trim());
    put('LoanPurpose', String(fields.loanType || '').trim());
    put('MarketValue', _mad_num_(fields.marketValue));
    put('FICO', String(fields.fico || '').trim());
    put('Grade', 'NEEDS DATA');
    put('Status', 'New');
    put('Provenance', provenance || 'Manual / phone');
    put('DateAdded', new Date());
    put('Archived', '');
    put('Viewed', '');

    sh.appendRow(row);
    return { ok: true, dealId: dealId };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/** Client-callable wrapper for the manual-add modal (google.script.run). */
function pipeline_addManualDeal(json) {
  var f;
  try { f = (typeof json === 'string') ? JSON.parse(json) : (json || {}); }
  catch (e) { return { ok: false, error: 'bad payload' }; }
  if (!String(f.address || '').trim() && !String(f.borrowerName || '').trim())
    return { ok: false, error: 'Enter at least a borrower name or property address' };
  return pipeline_createDeal_(f, 'Manual / phone');
}

/* ---------- helpers (namespaced _mad_ so nothing collides) ---------- */

// Reuse the project's shared sheet accessor if present; otherwise fall back.
function _mad_dealsSheet_() {
  try { if (typeof ss_ === 'function') { var s = ss_().getSheetByName('Pipeline_Deals'); if (s) return s; } } catch (e) {}
  try { if (typeof getLogSheet === 'function') { var p = getLogSheet().getParent(); var s2 = p.getSheetByName('Pipeline_Deals'); if (s2) return s2; } } catch (e) {}
  try { return SpreadsheetApp.openById('1bfbptTehrBLjP7fyLYyAXRDfuExAvaBacofJyJfgGeM').getSheetByName('Pipeline_Deals'); } catch (e) {}
  return null;
}

// Unique, sortable, clearly-manual DealID; re-rolls on the rare collision.
function _mad_newDealId_(sh, idx) {
  function gen() {
    var t = Date.now().toString(36).toUpperCase();
    var r = Math.floor(Math.random() * 1e7).toString(36).toUpperCase();
    return 'MAN-' + t + '-' + r;
  }
  var id = gen();
  try {
    if (sh && idx && idx['DealID'] != null) {
      var n = sh.getLastRow();
      if (n >= 2) {
        var col = sh.getRange(2, idx['DealID'] + 1, n - 1, 1).getValues();
        var seen = {};
        for (var i = 0; i < col.length; i++) seen[String(col[i][0])] = true;
        var guard = 0;
        while (seen[id] && guard++ < 5) id = gen();
      }
    }
  } catch (e) {}
  return id;
}

function _mad_num_(v) {
  if (v == null) return '';
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '' : n;
}