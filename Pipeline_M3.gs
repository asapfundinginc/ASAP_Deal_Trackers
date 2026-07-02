/***** ASAP PIPELINE — MODULE 3a: DASHBOARD (server) ***********************
 * Paste as a NEW file ("Pipeline_M3.gs") in the SAME project as M1 + M2.
 * Also create an HTML file named exactly  Pipeline_Dashboard  (next message).
 *
 * ONE edit to your Code.gs is required (so the web app can serve the
 * dashboard) — add this as the FIRST line inside your existing doGet(e):
 *
 *     if (e && e.parameter && e.parameter.dashboard) return Pipeline_serveDashboard();
 *
 * Then Deploy ▸ Manage deployments ▸ (edit) ▸ New version, and open:
 *     <your /exec URL>?dashboard
 ****************************************************************************/

function Pipeline_serveDashboard() {
  return HtmlService.createHtmlOutputFromFile('Pipeline_Dashboard')
    .setTitle('ASAP Deal Pipeline')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* Build the whole actionable pipeline for the dashboard (one Sheet read each). */
function pipeline_getPipeline() {
  var deals   = tableObjects_(ASAP_CFG.DEALS_TAB);
  var contacts = fetchContacts_();
  var lenders  = fetchProductsWithLenderCode_();     // read ONCE (perf)
  var out = [];
  for (var i = 0; i < deals.length; i++) {
    var d  = deals[i];
    var sr = screenDeal(d);
    if (sr.decision === 'FAIL') continue;               // dashboard = actionable only
    var mm = pipeline_matchFast_(d, sr, lenders);
    out.push(compactDeal_(d, sr, mm, i + 2));
  }
  out.sort(function (a, b) {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    var rk = { 'FIT': 0, 'NEEDS DATA': 1 };
    if (rk[a.decision] !== rk[b.decision]) return rk[a.decision] - rk[b.decision];
    return b.topScore - a.topScore;
  });
  return out;
}

/* Same logic as M2 matchLenders but takes a pre-read lender array. */
function pipeline_matchFast_(d, sr, lenders) {
  var matches = [], near = [];
  var loan = sr.loan, st = sr.state, fico = sr.fico;
  for (var i = 0; i < lenders.length; i++) {
    var L = lenders[i], reasons = [], fails = [];
    var prod   = sr.lenderFlags.some(function (f) { return String(L[f]).toUpperCase() === 'Y'; });
    var coming = sr.lenderFlags.some(function (f) { return /coming/i.test(String(L[f])); });
    if (!prod) { fails.push(coming ? 'product "coming soon"' : 'does not offer this product'); }
    else reasons.push(sr.cat + ' lender');
    var mn = num_(L.MinLoanNum), mx = num_(L.MaxLoanNum);
    if (loan && mn && loan < mn) fails.push('loan below their $' + comma_(mn) + ' min');
    if (loan && mx && loan > mx) fails.push('loan above their $' + comma_(mx) + ' max');
    if (loan && mn && mx && loan >= mn && loan <= mx) reasons.push('size in range');
    var sOk = stateOk_(L.States_Notes, st);
    if (sOk.ok === false) fails.push(sOk.note); else if (sOk.note) reasons.push(sOk.note);
    var mf = num_(L.MinFICONum);
    if (fico && mf && fico < mf) fails.push('FICO ' + fico + ' below their ' + mf + ' floor');
    else if (fico && mf) reasons.push('FICO clears ' + mf);
    var rec = { lender: L.Lender, contact: contact_(L), states: L.States_Notes,
                why: reasons.join(', '), reason: fails.join('; '),
                score: scoreLender_(L, loan, reasons.length) };
    if (fails.length) near.push(rec); else matches.push(rec);
  }
  matches.sort(function (a, b) { return b.score - a.score; });
  return { matches: matches, nearMisses: near };
}

/* Save the 3 borrower-info fields back to the deal's row + rebuild address. */
function pipeline_saveDealFields(id, fields) {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cId = H.indexOf('DealID'), cHouse = H.indexOf('HouseNum'),
      cName = H.indexOf('BorrowerName'), cEmail = H.indexOf('BorrowerEmail'),
      cStreet = H.indexOf('Street'), cCity = H.indexOf('City'),
      cState = H.indexOf('State'), cZip = H.indexOf('Zip'), cAddr = H.indexOf('AssembledAddress');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][cId]) === String(id)) {
      if (fields.house != null) sh.getRange(r + 1, cHouse + 1).setValue(fields.house);
      if (fields.name  != null) sh.getRange(r + 1, cName  + 1).setValue(fields.name);
      if (fields.email != null) sh.getRange(r + 1, cEmail + 1).setValue(fields.email);
      var house = (fields.house != null) ? fields.house : vals[r][cHouse];
      var full  = assemble_(house, vals[r][cStreet], vals[r][cCity], vals[r][cState], vals[r][cZip]);
      sh.getRange(r + 1, cAddr + 1).setValue(full);
      return { ok: true, fullAddress: full,
               ready: { house: !!String(house).trim(),
                        name:  !!String(fields.name  != null ? fields.name  : vals[r][cName]).trim(),
                        email: !!String(fields.email != null ? fields.email : vals[r][cEmail]).trim() } };
    }
  }
  return { ok: false };
}

/* shape one deal for the client */
function compactDeal_(d, sr, mm, row) {
  var top = mm.matches.slice(0, 3).map(function (m) {
    return { n: m.lender, short: shortName_(m.lender), contact: m.contact,
             ae: aeFirst_(m.contact), email: emailOf_(m.contact), why: m.why };
  });
  var card = {
    id: String(d.DealID), row: row, decision: sr.decision, priority: !!sr.priority,
    loan: sr.loan ? '$' + comma_(sr.loan) : String(d.LoanAmount || '\u2014'),
    type: prettyType_(d.LoanType),
    propClass: prettyClass_(d.PropertyType), pitchClass: pitchClass_(d.PropertyType),
    addrShort: addrShort_(d),
    value: sr.value ? '$' + comma_(sr.value) : '\u2014', valueSrc: String(d.ValueSource || 'listing'),
    ltv: sr.ltv ? pct_(sr.ltv) : '\u2014', cap: Math.round(sr.cap * 100) + '%',
    dscr: sr.dscr ? sr.dscr.toFixed(2) : '',
    lien: String(d.LienPosition || ''), fico: String(d.FICO || ''),
    acres: (d.LotAcres !== '' && d.LotAcres != null) ? (d.LotAcres + ' ac') : '',
    rent: d.MonthlyRent ? '$' + comma_(money_(d.MonthlyRent)) + '/mo' : '',
    summary: String(d.PropertySummary || ''), borrowerDetails: String(d.BorrowerDetails || ''),
    buildingSize: String(d.BuildingSize || ''), lotSize: String(d.LotSize || ''),
    occupancy: String(d.Occupancy || ''), annualIncome: String(d.AnnualIncome || ''),
    statedType: String(d.PropertyType || ''),
    exit: String(d.ExitPlan || ''), term: termFor_(sr.cat), cat: sr.cat,
    note: noteFor_(sr), watchouts: sr.watchouts || [], sourceUrl: String(d.SourceURL || ''),
    lenders: top, topScore: top.length ? mm.matches[0].score : 0,
    ready: { house: !!String(d.HouseNum || '').trim(),
             name:  !!String(d.BorrowerName || '').trim(),
             email: !!String(d.BorrowerEmail || '').trim() }
  };

  // --- 4-column screener: Priority / Fit / Needs-data / Specialty-Hold ---
  // Prefer the AI-enhanced screen persisted at import (free + instant to read). If the
  // deal's numbers changed since that screen — or it was never AI-screened — fall back to
  // the deterministic screen ({ai:false}) so the board is always correct-for-now and free.
  try {
    var screenInput = (typeof Pipeline_screenInput_ === 'function')
      ? Pipeline_screenInput_(sr, d)
      : { type: card.cat, purpose: card.type,
          loan: card.loan, value: card.value, ltv: card.ltv, dscr: card.dscr,
          rent: card.rent || (d.MarketRent ? ('$' + d.MarketRent) : ''),
          fico: card.fico, lien: card.lien, acres: card.acres, propClass: card.propClass };
    var s = null;
    if (d.ScreenJSON && typeof Pipeline_screenFp_ === 'function') {
      try { var saved = JSON.parse(d.ScreenJSON); if (saved && saved.fp && saved.fp === Pipeline_screenFp_(screenInput)) s = saved; } catch (e) { s = null; }
    }
    if (!s) s = pipeline_screenDeal(screenInput, { ai: false });   // deterministic, free
    card.column = s.column || '';
    card.chaseScore = (s.chaseScore != null ? s.chaseScore : -1);
    card.confidence = s.confidence || '';
    card.screen = s;
  } catch (e) {
    card.column = ''; card.chaseScore = -1;   // board falls back to its FIT / NEEDS DATA logic
  }

  return card;
}

/* ---- presentation helpers ---- */
function prettyType_(t) {
  var s = String(t || '').toLowerCase();
  if (/cash.?out/.test(s)) return 'Cash-out refinance';
  if (/refinance|refi/.test(s)) return 'Refinance';
  if (/ground.?up|construction/.test(s)) return 'Ground-up construction';
  if (/fix|flip/.test(s)) return 'Fix & flip';
  if (/dscr|rental/.test(s)) return 'DSCR rental';
  if (/bridge/.test(s)) return 'Bridge';
  if (/purchase|acquisition/.test(s)) return 'Purchase';
  if (/land|lot/.test(s)) return 'Land';
  return String(t || 'Loan');
}
function prettyClass_(pt) {
  var s = String(pt || '').toLowerCase();
  if (/5\+|multi|apartment/.test(s)) return 'Multifamily 5+';
  if (/mixed/.test(s)) return 'Mixed-use';
  if (/commercial|office|retail|industrial|storage|warehouse/.test(s)) return 'Commercial';
  if (/res|1-4|single|sfr|duplex|tri|four|condo|town/.test(s)) return 'Residential 1\u20134 unit';
  if (/land|lot/.test(s)) return 'Land';
  return String(pt || '');
}
function pitchClass_(pt) {                 // sanitized for lender pitch (no unit-count guess)
  var s = String(pt || '').toLowerCase();
  if (/5\+|multi|apartment/.test(s)) return 'multifamily property';
  if (/mixed/.test(s)) return 'mixed-use property';
  if (/commercial|office|retail|industrial|storage|warehouse/.test(s)) return 'commercial property';
  if (/res|1-4|single|sfr|duplex|tri|four|condo|town/.test(s)) return 'residential property';
  return 'property';
}
function addrShort_(d) {
  var line1 = [String(d.HouseNum || '').trim(), String(d.Street || '').trim()].filter(String).join(' ').trim();
  var line2 = [String(d.City || '').trim(), String(d.State || '').trim()].filter(String).join(', ');
  return [line1, line2].filter(String).join(', ');
}
function noteFor_(sr) {
  if (sr.decision === 'FIT') return 'Clears leverage \u2014 ready to pitch.';
  if (sr.watchouts && sr.watchouts.length) return sr.watchouts[0];
  return 'A few data points needed before pitching.';
}
function termFor_(cat) {
  switch (cat) {
    case 'fixflip':    return '12\u201318 mo interest-only, rehab draws';
    case 'groundup':   return '12\u201318 mo interest-only, construction draws';
    case 'bridge':     return '12-month interest-only bridge';
    case 'purchase':   return '12-month interest-only bridge';
    case 'dscr':       return '30-yr DSCR, IO option';
    case 'cashout':    return '30-yr DSCR cash-out (or 12-mo bridge)';
    case 'refi':       return '30-yr DSCR (or 12-mo bridge)';
    case 'land':       return '12-month interest-only, 1st lien';
    case 'commercial': return '12\u201324 mo bridge, interest-only';
    default:           return '12-month interest-only';
  }
}
function shortName_(n) {
  n = String(n || '').replace(/\([^)]*\)/g, '').trim();
  return n.split(/\s+/).slice(0, 2).join(' ');
}
function aeFirst_(contact) {
  var name = String(contact || '').split('\u00b7')[0].split(',')[0].trim();
  return name.split(/\s+/)[0] || 'there';
}
function emailOf_(contact) {
  var m = String(contact || '').match(/[\w.+-]+@[\w.-]+/);
  return m ? m[0] : '';
}