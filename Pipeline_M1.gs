/***** ASAP PIPELINE — MODULE 1: FOUNDATION & CONFIG *************************
 * Paste this as a NEW script file (e.g. "Pipeline_M1.gs") in your EXISTING
 * ASAP loan-app Apps Script project. It does NOT touch your loan app code.
 *
 * WHAT IT DOES
 *   1. Holds the shared config — knockouts, LTV/LTC caps mirrored from your
 *      loan-app GUIDE (single source of truth), priority rules, tax/ins.
 *   2. Builds two clean working tabs in your Sheet:
 *        • Pipeline_Lenders  (normalized 81-lender matrix)
 *        • Pipeline_Deals    (normalized WorkingMoni deals + status columns)
 *   3. Imports your lender tracker + WorkingMoni deals into those tabs.
 *
 * ONE-TIME SETUP (about 3 min) — NO Sheet ID needed. This auto-targets the SAME
 * spreadsheet your loan app logs to (it reuses your getLogSheet() function).
 *   A. In the Apps Script editor: Run > showLogSheet, then open the execution
 *      log and click the "Log Sheet URL" it prints. That's your submissions
 *      spreadsheet (it gets created automatically if it didn't exist yet).
 *   B. In THAT spreadsheet:
 *        File > Import > Upload > ASAP_Lender_tracker_master_listver3.xlsx
 *          -> "Insert new sheet(s)"  (keeps tab "Deal Matching Matrix")
 *        File > Import > Upload > WorkingMoni_Deals_CLEANED.xlsx
 *          -> "Insert new sheet(s)"  (keeps tab "Deals (cleaned)")
 *      (Extra tabs that tag along are harmless — delete them if you like.)
 *   C. Back in the editor: Run > runFullSetup   (authorize once).
 *
 *   Then check the two Pipeline_* tabs filled in. Tell me any red errors.
 ****************************************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ASAP')
    .addItem('Run screen + match (one row)', 'screenAndMatchOne')
    .addItem('Run screen + match (all rows)', 'runScreenAll')
    .addSeparator()
    .addItem('Refresh lender data from Supabase', 'refreshLenderCache')
    .addItem('Import deals from WorkingMoni', 'importDeals')
    .addToUi();
}

const ASAP_CFG = {
  // Leave blank — the module auto-uses your loan app's own log spreadsheet.
  // (Only set this to a Sheet ID if you ever want to override that.)
 SS_ID: '1bfbptTehrBLjP7fyLYyAXRDfuExAvaBacofJyJfgGeM',

  // Clean working tabs (created by this module):
  LENDERS_TAB: 'Pipeline_Lenders',
  DEALS_TAB:   'Pipeline_Deals',

  // Raw tabs imported from the two xlsx files (rename here if yours differ):
  RAW_LENDERS_TAB: 'Deal Matching Matrix',
  RAW_DEALS_TAB:   'Deals (cleaned)',

  // ---- Screening rules (used by Module 2) -------------------------------
  MIN_LOAN: 100000,                 // knockout below this
  OWNER_OCC_OK_STATES: ['CA'],      // owner-occupied allowed ONLY in these

  // LTV / LTC caps — mirror loan-app GUIDE (keep in sync so they never drift)
  CAPS: {
    purchase:     0.80,
    cashout:      0.75,
    refi:         0.75,
    bridge:       0.75,
    land:         0.60,
    dscrPurchase: 0.80,
    dscrCashout:  0.75,
    commercial:   0.70
  },
  DSCR_MIN: 1.00,
  FF_HI_LEV_FICO: 700,              // 90%PP/100%rehab needs F&F + experience + 700+

  // Estimate defaults (used pre-borrower-confirmation)
  TAX_RATE: 0.0125,                 // 1.25%/yr of value
  INS_RATE: 0.0035,                 // 0.35%/yr of value
  HOA_DEFAULT: 0,
  DSCR_QUAL_RATE: 0.0725,           // GUIDE.dscrRate

  // Priority boosts (ranking, Module 2)
  PRIORITY_NOTE: '1-4 unit SFR; standard purchase >=20% down; DSCR'
};

/* =========================================================================
 * RUN THIS ONCE after setup steps A & B.
 * ========================================================================= */
function runFullSetup() {
  setupPipelineSheets();
  const nL = importLenders();
  const nD = importDeals();
  Logger.log('Setup complete.  Lenders imported: %s   |   Deals imported: %s', nL, nD);
}

/* ---- clean-tab headers --------------------------------------------------*/
const LENDER_HEADERS = [
  'LenderID','Lender','Type','Bridge','FixFlip','DSCR','GroundUp','Multifamily',
  'MixedUse','Commercial','Mezz','MinLoan','MaxLoan','MinLoanNum','MaxLoanNum',
  'SweetSpot','MaxLTV_Bridge','MaxLTC_FF','MaxLTV_DSCR','RateRange','OrigFee',
  'States_Notes','MinFICO','MinFICONum','ForeignNat','TS_TAT','TypicalClose',
  'Contact','Phone_Email','DealsWithDK','Confidence','LastUpdated',
  'MaxLTVByFICO','AppraisalReq','Responsiveness','WhiteLabel'
];
const DEAL_HEADERS = [
  'DealID','SourceURL','City','State','Zip','Street','HouseNum','AssembledAddress',
  'LoanAmount','LoanType','MarketValue','ValueSource','SecondValue','LTV',
  'AnnualReturn','AnnualIncome','MonthlyRent','DesiredTerm','LienPosition',
  'BuildingSize','LotSize','LotAcres','ZoningUse','Occupancy','PropertyType',
  'FICO','LoanPurpose','PropertySummary','ExitPlan','BorrowerDetails','UploadBy',
  'BorrowerName','BorrowerEmail','Grade','Status','Provenance'
];

function setupPipelineSheets() {
  const ss = ss_();
  ensureTab_(ss, ASAP_CFG.LENDERS_TAB, LENDER_HEADERS);
  ensureTab_(ss, ASAP_CFG.DEALS_TAB,   DEAL_HEADERS);
}

/* =========================================================================
 * IMPORT: lender tracker matrix  ->  Pipeline_Lenders
 * ========================================================================= */
function importLenders() {
  const ss  = ss_();
  const raw = findTab_(ss, ASAP_CFG.RAW_LENDERS_TAB);
  if (!raw) throw new Error('Raw lender tab "' + ASAP_CFG.RAW_LENDERS_TAB +
    '" not found. Do setup step A (File > Import the lender tracker xlsx).');
  const vals = raw.getDataRange().getValues();
  const hdr  = vals[0].map(normHeader_);
  const c    = lenderColIndex_(hdr);

  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const row   = vals[r];
    const idNum = parseInt(String(row[c.idx]).trim(), 10);
    if (!idNum) continue;                          // skip section dividers / blanks
    const lender = String(row[c.lender] || '').trim();
    if (!lender) continue;
    out.push([
      idNum, lender, val_(row, c.type),
      flag_(row, c.bridge), flag_(row, c.ff), flag_(row, c.dscr), flag_(row, c.guc),
      flag_(row, c.mf), flag_(row, c.mixed), flag_(row, c.comm), flag_(row, c.mezz),
      val_(row, c.minLoan), val_(row, c.maxLoan), money_(val_(row, c.minLoan)), money_(val_(row, c.maxLoan)),
      val_(row, c.sweet), val_(row, c.ltvBridge), val_(row, c.ltcFF), val_(row, c.ltvDSCR),
      val_(row, c.rate), val_(row, c.orig), val_(row, c.states),
      val_(row, c.fico), fico_(val_(row, c.fico)), val_(row, c.fn),
      val_(row, c.tat), val_(row, c.close), val_(row, c.contact), val_(row, c.phone),
      val_(row, c.deals), val_(row, c.conf), val_(row, c.updated),
      val_(row, c.maxLtvByFico), val_(row, c.appraisal), val_(row, c.responsive), val_(row, c.whitelabel)
    ]);
  }
  writeRows_(ss, ASAP_CFG.LENDERS_TAB, LENDER_HEADERS, out);
  return out.length;
}

/* =========================================================================
 * IMPORT: WorkingMoni deals  ->  Pipeline_Deals
 *
 * LOCATION FIX (2026-06): the "City, ST ZIP" string lives in the scraper's
 * "State" column (e.g. "Holmes County, OH 44654"); the "deal" / "street"
 * columns only carry the street/deal name (e.g. "Holmes County"). We now read
 * the State column first and fall back to the deal name. parseCityStateZip_()
 * is also tolerant of varied formats and NEVER throws — a row with an
 * unparseable address still imports (state simply comes back blank).
 * ========================================================================= */
function importDeals() {
  const ss  = ss_();
  const raw = findTab_(ss, ASAP_CFG.RAW_DEALS_TAB);
  if (!raw) throw new Error('Raw deals tab "' + ASAP_CFG.RAW_DEALS_TAB +
    '" not found. Do setup step A (File > Import the WorkingMoni xlsx).');
  const vals = raw.getDataRange().getValues();
  const hdr  = vals[0].map(normHeader_);
  const c    = dealColIndex_(hdr);

  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const row     = vals[r];
    const dealStr = String(val_(row, c.deal) || '').trim();
    const url     = String(val_(row, c.href) || '').trim();
    if (!dealStr && !url) continue;
    // Read the location from the "State" column ("City, ST ZIP"); fall back to
    // the deal name if that column is empty. Blank state is allowed.
    const locInput = String(val_(row, c.state) || '').trim() || dealStr;
    const loc      = parseCityStateZip_(locInput);
    const street   = String(val_(row, c.street) || '').trim();
    // Avoid a duplicated "City, City, ST ZIP" address when the scraper put the
    // same value in both the street and State columns (still store the full
    // street in its own column for search).
    const streetForAddr = (street && loc.city && street.toLowerCase() === loc.city.toLowerCase()) ? '' : street;
    out.push([
      dealId_(url, r), url, loc.city, loc.state, loc.zip, street, '',   // HouseNum blank
      assemble_('', streetForAddr, loc.city, loc.state, loc.zip),       // AssembledAddress
      val_(row, c.amount), val_(row, c.loanType), val_(row, c.value), 'listing',
      val_(row, c.second), val_(row, c.ltv), val_(row, c.areturn), val_(row, c.aincome),
      val_(row, c.rent), val_(row, c.term), val_(row, c.lien), val_(row, c.bsize),
      val_(row, c.lot), parseAcres_(val_(row, c.lot)), val_(row, c.zoning), val_(row, c.occ),
      val_(row, c.ptype), val_(row, c.fico), val_(row, c.purpose), val_(row, c.psummary),
      val_(row, c.exit), val_(row, c.bdetails), val_(row, c.uploadby),
      '', '',          // BorrowerName, BorrowerEmail — not in export, captured later
      '', '',          // Grade, Status — filled by M2 / M3
      'listing'        // Provenance default tag
    ]);
  }
  writeRows_(ss, ASAP_CFG.DEALS_TAB, DEAL_HEADERS, out);
  return out.length;
}

/* =========================== helpers ==================================== */
function ss_() {
  // Optional explicit override:
  if (ASAP_CFG.SS_ID && ASAP_CFG.SS_ID.indexOf('PASTE') !== 0) {
    return SpreadsheetApp.openById(ASAP_CFG.SS_ID);
  }
  // Default: reuse your loan app's own log spreadsheet. getLogSheet() is
  // already defined in your Code.gs (it reads LOG_SHEET_ID from Script
  // Properties and creates the sheet if missing). .getParent() = the workbook.
  return getLogSheet().getParent();
}

/* Run this first to find (and, if needed, create) your submissions
   spreadsheet, then import the two xlsx files into the URL it prints. */
function showLogSheet() {
  var ss = getLogSheet().getParent();
  Logger.log('Log Sheet name: %s', ss.getName());
  Logger.log('Log Sheet URL : %s', ss.getUrl());
  Logger.log('Log Sheet ID  : %s', ss.getId());
}
function ensureTab_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}
function writeRows_(ss, name, headers, rows) {
  const sh = ss.getSheetByName(name);
  if (sh.getLastRow() > 1)
    sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();   // idempotent
  if (rows.length)
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
function findTab_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (sh) return sh;
  const want = normHeader_(name);
  return ss.getSheets().filter(function(s){ return normHeader_(s.getName()) === want; })[0] || null;
}
function normHeader_(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function val_(row, i){ return (i == null || i < 0) ? '' : row[i]; }
function flag_(row, i){
  const v = String(val_(row, i) || '').trim();
  if (v === '\u2713') return 'Y';
  if (v === '\u2717') return 'N';
  if (/^coming/i.test(v)) return 'Coming';
  if (/^(y|yes|true)$/i.test(v)) return 'Y';
  return v;                                   // '?' or blank pass through
}
function money_(s){
  const m = String(s || '').replace(/[, ]/g, '').match(/\$?([0-9.]+)\s*([kKmM])?/);
  if (!m) return '';
  let n = parseFloat(m[1]); if (isNaN(n)) return '';
  const u = (m[2] || '').toLowerCase();
  if (u === 'k') n *= 1e3;
  if (u === 'm') n *= 1e6;
  return Math.round(n);
}
function fico_(s){ const m = String(s || '').match(/(\d{3})/); return m ? parseInt(m[1], 10) : ''; }
function parseAcres_(s){
  const t = String(s || '').toLowerCase();
  let m = t.match(/([0-9.]+)\s*ac/);             if (m) return parseFloat(m[1]);
  m = t.match(/([0-9,]+)\s*(sq\s*ft|sf)\b/);     if (m) return +(parseFloat(m[1].replace(/,/g, '')) / 43560).toFixed(2);
  return '';
}

/* ---------------------------------------------------------------------------
 * parseCityStateZip_  — TOLERANT location parser (replaces the old strict one)
 *
 * Accepts the varied WorkingMoni formats and NEVER throws:
 *   "City, ST 12345"            -> {city:"City",  state:"ST", zip:"12345"}
 *   "City, ST"                  -> {city:"City",  state:"ST", zip:""}
 *   "Street, City, ST 12345"    -> {city:"City",  state:"ST", zip:"12345"}
 *   "ST 12345" / "ST"           -> {city:"",      state:"ST", zip:"12345"/""}
 *   anything with no valid state -> {city:<best>, state:"",   zip:<if any>}
 *
 * The state is taken from a valid 2-letter USPS code (preferring the token
 * right before the ZIP / at the very end). A blank state is fine — the deal
 * still imports; it just won't have a state for filtering until corrected.
 * ------------------------------------------------------------------------- */
function parseCityStateZip_(s){
  var raw = String(s == null ? '' : s).trim();
  if (!raw) return { city: '', state: '', zip: '' };

  var US = {AL:1,AK:1,AZ:1,AR:1,CA:1,CO:1,CT:1,DE:1,DC:1,FL:1,GA:1,HI:1,ID:1,IL:1,IN:1,
            IA:1,KS:1,KY:1,LA:1,ME:1,MD:1,MA:1,MI:1,MN:1,MS:1,MO:1,MT:1,NE:1,NV:1,NH:1,
            NJ:1,NM:1,NY:1,NC:1,ND:1,OH:1,OK:1,OR:1,PA:1,RI:1,SC:1,SD:1,TN:1,TX:1,UT:1,
            VT:1,VA:1,WA:1,WV:1,WI:1,WY:1};

  // ZIP: prefer a trailing 5-digit (optionally ZIP+4); else any 5-digit group.
  var zip = '';
  var zm = raw.match(/(\d{5})(?:-\d{4})?\s*$/) || raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zm) zip = zm[1];

  // STATE: prefer the 2-letter token just before the ZIP / at the very end;
  // else the last valid USPS code anywhere in the string.
  var head  = zip ? raw.slice(0, raw.lastIndexOf(zip)) : raw;
  var state = '';
  var sm = head.match(/[,\s]([A-Za-z]{2})[\s,]*$/);
  if (sm && US[sm[1].toUpperCase()]) state = sm[1].toUpperCase();
  if (!state) {
    var toks = raw.toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
    for (var i = toks.length - 1; i >= 0; i--) { if (US[toks[i]]) { state = toks[i]; break; } }
  }

  // CITY: best-effort. With commas, the city is the segment before the
  // "ST[ ZIP]" tail; otherwise strip any trailing state/zip off the string.
  var city = '';
  var parts = raw.split(',');
  if (parts.length >= 2) {
    var last = parts[parts.length - 1].trim();
    var lastIsTail = /^[A-Za-z]{2}\b/.test(last) && US[last.slice(0, 2).toUpperCase()] &&
                     /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?\s*$/.test(last);
    city = (lastIsTail ? parts[parts.length - 2] : parts[parts.length - 1]).trim();
  } else {
    city = raw;
    if (zip)   city = city.replace(/\s*\d{5}(-\d{4})?\s*$/, '').trim();
    if (state) city = city.replace(new RegExp('\\b' + state + '\\b\\s*$', 'i'), '').trim();
  }

  return { city: city, state: state, zip: zip };
}

function assemble_(house, street, city, state, zip){
  const line1 = [house, street].filter(String).join(' ').trim();
  const line2 = [city, [state, zip].filter(String).join(' ')].filter(String).join(', ');
  return [line1, line2].filter(String).join(', ');
}
function dealId_(url, r){
  const m = String(url || '').match(/([a-f0-9]{16,})\/?$/i);
  return m ? m[1] : ('D' + String(r).padStart(4, '0'));
}

/* column-index maps (matched by normalized header, so minor header
   differences / extra spaces won't break the import) */
function lenderColIndex_(h){
  const f = function(a){ for (let k = 0; k < a.length; k++){ const i = h.indexOf(a[k]); if (i >= 0) return i; } return -1; };
  return {
    idx:f(['','no','num','number']), lender:f(['lender']), type:f(['type']),
    bridge:f(['bridge']), ff:f(['fixflip']), dscr:f(['dscr14unit','dscr1to4unit','dscr']),
    guc:f(['groundupconstruct','groundupconstruction','groundup']),
    mf:f(['multifamily5','multifamily5unit','multifamily']),
    mixed:f(['mixeduse']), comm:f(['commercialcre','commercial']),
    mezz:f(['mezzprefeq','mezz']), minLoan:f(['minloan']), maxLoan:f(['maxloan']),
    sweet:f(['sweetspot']), ltvBridge:f(['maxltvbridge']), ltcFF:f(['maxltcffguc']),
    ltvDSCR:f(['maxltvdscrperm','maxltvdscr']), rate:f(['raterange']), orig:f(['origfee']),
    states:f(['primarystatesnotes','primarystates']), fico:f(['minfico']),
    fn:f(['foreignnat']), tat:f(['termsheettat']), close:f(['typicalclose']),
    contact:f(['primarycontact']), phone:f(['phoneemail']),
    deals:f(['dealswdk','dealswithdk']), conf:f(['confidence']), updated:f(['lastupdated']),
    maxLtvByFico:f(['maxltvbyfico','ltvbyfico']),
    appraisal:f(['appraisalrequired','appraisalreq','appraisal']),
    responsive:f(['responsiveness','responsive']),
    whitelabel:f(['whitelabel','whitelabelpartner','whitelabeling'])
  };
}
function dealColIndex_(h){
  const f = function(a){ for (let k = 0; k < a.length; k++){ const i = h.indexOf(a[k]); if (i >= 0) return i; } return -1; };
  return {
    deal:f(['deal']), href:f(['dealhref']), street:f(['street']), state:f(['state']),
    amount:f(['loanamount']), loanType:f(['loantype']), value:f(['appraiser']),
    second:f(['2ndexistingvalue','secondexistingvalue','existingvalue']),
    ltv:f(['ltv']), areturn:f(['annualreturn']), aincome:f(['annualincome']),
    rent:f(['monthlyincome']), term:f(['desiredterm']), lien:f(['lienposition']),
    bsize:f(['buildingsize']), lot:f(['lotsize']), zoning:f(['zoninguse']),
    occ:f(['occupancy']), ptype:f(['propertytype']), fico:f(['fico']),
    purpose:f(['loanpurpose']), psummary:f(['propertysummary']), exit:f(['exitplan']),
    bdetails:f(['borrowerdetails']), uploadby:f(['uploadby'])
  };
}