/***** ASAP PIPELINE — DOCUMENTS MULTI-TYPE EXTRACTOR ******************
 * Paste as a NEW script file ("Pipeline_DocFlags.gs") in the SAME project.
 * Self-contained. Does NOT touch TitleFlags, NoteFlags, M4, or anything else.
 *
 * WHAT IT DOES
 *   The Documents box (multi-file, one type dropdown per file) sends each PDF
 *   here as base64 with its docType. Gemini reads the PDF natively (scans too)
 *   and returns three things in one call:
 *     - fields:    the numbers/facts the calculator needs (auto-fill, amber)
 *     - flags:     the risks, same card shape the calculator already renders
 *     - unmapped:  notable items with no field -> become call questions
 *
 *   Same Gemini key/model/retry as TitleFlags (Script Property GEMINI_KEY,
 *   optional GEMINI_MODEL). One prompt per docType. Title docs can still use
 *   the old TitleFlags reader; this also has a 'title' type for parity.
 *
 * ENTRY (call from the calculator via google.script.run):
 *   pipeline_analyzeDocPdf(base64, mime, docType, contextJson)
 * RETURNS
 *   { ok:true, docType, fields:{}, flags:[...], unmapped:[...], confidence:{}, model }
 *   { ok:false, error:'...' }
 *
 * TEST: pipeline_testDocFlags() — point FILE_ID at a real Drive PDF + set TYPE.
 ************************************************************************/

/* ---- the shared topic vocabulary (keeps doc flags de-duping with the rules + title flags) ---- */
var PIPELINE_DOC_TOPICS = [
  'chain_of_title','lien_position','value_gap','seasoning','litigation','hoa','ground_lease',
  'permits','environmental','property_type','acreage','cross_collateral','insurability',
  'occupancy_str','foreign_national','flood','proceeds_use','vacant','belowmarket','lease',
  'multitenant','expenseratio','nonrecurring','taxreassessment','condition','comps',
  'sqftmismatch','unpermitted','nonarmslength','delayedfinancing','budget_gap','draw',
  'entitlement','absorption','feasibility','experience','missing_docs','reserves','other'
].join(', ');

/* ---- per-docType specs: label + the field keys to extract + the risks to flag ----
   Field keys are SEMANTIC; the calculator maps them to the right input per tab. */
var PIPELINE_DOC_SPECS = {

  /* ===== UNIVERSAL (any deal) ===== */
  lender_package: {
    label: 'a sponsor-prepared pitch deck / lender package / executive summary / prospectus / offering memorandum -- a narrative built to win financing, so read it as a skeptical underwriter and separate verified fact from owner-reported claim',
    src: 'docs',
    fields: ['projectName','sponsorName','sponsorEntity','propertyAddress','assetType','loanRequested','loanOptions','loanTermMonths','extensionOptions','targetCloseDays','existingDebt','freeAndClear (true/false)','statedLtv','statedLtc','landAcres','unitCount','asIsValue','asCompletedValue','selloutValue','buildCostPerUnit','allInCostPerUnit','salePricePerUnit','grossMarginPerUnit','preSalesCount','preSalesBinding (true/false)','projectStatus','primaryExit','brokerContact'],
    flags: [
      'headline valuations are owner-reported or broker-estimated, NOT a certified third-party appraisal (topic:value_gap)',
      'pre-sales / pre-leases are verbal or owner-reported rather than binding executed contracts (topic:absorption)',
      'the third-party proof is only available-on-request -- appraisal, plat, environmental, pre-sale contracts, cost detail are referenced but not included in the package (topic:missing_docs)',
      'sponsor track record is a different asset type, out of state, or unverified volume versus THIS project (topic:experience)',
      'projected profit / ARV depends on full build-out or later phases that are not yet funded or pre-sold (topic:feasibility)',
      'the ask offers multiple structures or a wide loan-amount range, or a single broker / personal email is the only contact -- the request is not yet firm and is lightly sourced (topic:other)'
    ]
  },
  purchase_contract: {
    label: 'a purchase & sale agreement / purchase contract',
    src: 'docs',
    fields: ['purchasePrice','earnestMoney','closeDate','propertyAddress','sellerName','buyerName','asIsSale (true/false)'],
    flags: [
      'related-party / non-arm\u2019s-length sale, or buyer also controls the seller (topic:nonarmslength)',
      'assignment of contract / double-close / wholesale spread (topic:chain_of_title)',
      'seller credits or concessions that inflate the recorded price vs true value (topic:value_gap)',
      'very short close timeline that pressures appraisal / title (topic:other)'
    ]
  },
  settlement: {
    label: 'a settlement / closing statement (ALTA / HUD-1)',
    src: 'docs',
    fields: ['purchasePrice','acquisitionDate','costBasis','cashToBorrower','sellerName','wasFinanced (true/false)','wasAllCash (true/false)'],
    flags: [
      'ownership under 12 months on a cash-out (cost-basis cap risk) (topic:seasoning)',
      'related-party / gift / quitclaim chain, no true price (topic:nonarmslength)',
      'purchase was financed, so delayed-financing may not apply (topic:delayedfinancing)',
      'payoffs / liens shown on the statement (topic:lien_position)'
    ]
  },
  title: {
    label: 'a preliminary title report / commitment',
    src: 'title',
    fields: ['vesting','lienPosition','legalOwner','openLiensTotal','unpaidTaxes','lastSaleDate','lastSalePrice','lotAcres'],
    flags: [
      'existing senior loan / 2nd-lien situation (topic:lien_position)',
      'judgments, back taxes, mechanic\u2019s or IRS liens, clouds (topic:lien_position)',
      'lis pendens / active suit / bankruptcy / open probate (topic:litigation)',
      'tax-deed or foreclosure / sheriff\u2019s deed in the chain (topic:chain_of_title)',
      'easements or CC&Rs that limit the buildable area or use (topic:chain_of_title)',
      'HOA delinquency, special assessment, or HOA litigation (topic:hoa)',
      'vested owner does not match the borrower (topic:nonarmslength)',
      'true acreage / legal description well beyond a normal residential lot (topic:acreage)'
    ]
  },
  appraisal: {
    label: 'an appraisal or BPO (may be as-is and/or as-completed / ARV)',
    src: 'docs',
    fields: ['asIsValue','asCompletedValue','marketRent','propertyType','condition','sqft','beds','baths','yearBuilt','lotAcres'],
    flags: [
      'condition C5-C6 / not rent-ready -> bridge, not DSCR (topic:condition)',
      'thin or no comparable sales (topic:comps)',
      'GLA / square footage differs materially from public record (topic:sqftmismatch)',
      'rural, large-acreage, or agricultural use (topic:acreage)',
      'ADU / addition / conversion flagged as unpermitted (topic:unpermitted)',
      'FEMA flood zone noted (topic:flood)'
    ]
  },
  insurance: {
    label: 'an insurance binder / quote (hazard and/or flood)',
    src: 'docs',
    fields: ['dwellingCoverage','annualPremium','floodZone','floodPremium','carrier','effectiveDate'],
    flags: [
      'FEMA special flood hazard zone with a premium big enough to dent the DSCR (topic:flood)',
      'coverage below replacement cost or loan amount (topic:insurability)',
      'lapsed / expired / bound-but-unpaid policy (topic:insurability)'
    ]
  },
  entity: {
    label: 'borrowing-entity docs (articles / operating agreement)',
    src: 'docs',
    fields: ['entityName','entityType','stateOfFormation','members','managerName','goodStanding (true/false)'],
    flags: [
      'a foreign-national member (eligibility / higher down) (topic:foreign_national)',
      'title vested in an irrevocable trust, land trust, or LP that many lenders exclude (topic:property_type)',
      'signer / member does not match the borrower on the deal (topic:nonarmslength)'
    ]
  },
  financials: {
    label: 'borrower financials (bank statements / proof of funds / PFS)',
    src: 'docs',
    fields: ['liquidReserves','statementEndingBalance','netWorth','coverageMonths'],
    flags: [
      'reserves look short for closing costs plus a few months PITIA (topic:reserves)',
      'large unsourced deposits (topic:other)'
    ]
  },
  track_record: {
    label: 'a sponsor track record / REO schedule / experience resume',
    src: 'docs',
    fields: ['dealsCompleted','unitsOwned','yearsExperience','reoCount','largestProject'],
    flags: [
      'thin or no relevant experience for ground-up or heavy rehab (topic:experience)',
      'no comparable completed project for this asset class / scale (topic:experience)'
    ]
  },
  payoff: {
    label: 'a payoff statement / demand',
    src: 'docs',
    fields: ['payoffAmount','perDiem','goodThroughDate','lender','lienPosition'],
    flags: [
      'payoff exceeds the expected balance or pinches the LTV (topic:lien_position)',
      'prepayment penalty or short good-through date adds timing pressure (topic:other)'
    ]
  },

  /* ===== INCOME CRE (multifamily, mixed-use, retail, office, industrial, self-storage, hospitality) ===== */
  rent_roll: {
    label: 'a rent roll',
    src: 'docs',
    fields: ['unitCount','occupiedUnits','vacantUnits','grossMonthlyRent','grossAnnualRent','avgRentPerUnit','anyMonthToMonth (true/false)'],
    flags: [
      'vacant / un-leased units the DSCR cannot count (topic:vacant)',
      'in-place rents materially below market (topic:belowmarket)',
      'month-to-month or unsigned leases (topic:lease)',
      'tenant count exceeds unit count / room-by-room rental (topic:multitenant)'
    ]
  },
  operating_statement: {
    label: 'a trailing-12 operating statement / T-12 / P&L',
    src: 'docs',
    fields: ['grossIncome','vacancyLoss','operatingExpenses','noi','expenseRatio','realEstateTaxes','insurance','managementFee','replacementReserves'],
    flags: [
      'expense ratio too low to be real, or no replacement reserves (topic:expenseratio)',
      'one-time / non-recurring items inflating NOI (topic:nonrecurring)',
      'taxes that will reassess on sale and cut NOI (topic:taxreassessment)'
    ]
  },
  leases: {
    label: 'commercial leases and/or tenant estoppels',
    src: 'docs',
    fields: ['tenantCount','totalInPlaceRent','weightedAvgRemainingTermMonths','anyBelowMarket (true/false)'],
    flags: [
      'short remaining term / near-term rollover (topic:lease)',
      'below-market in-place rent vs pro forma (topic:belowmarket)',
      'missing estoppels or rent that cannot be verified -> use market rent (topic:lease)',
      'eviction, holdover, or possession issue at closing (topic:occupancy_str)'
    ]
  },
  environmental: {
    label: 'an environmental report (Phase I / Phase II)',
    src: 'docs',
    fields: ['phase','recognizedConditions (true/false)','priorUse','tanksPresent (true/false)'],
    flags: [
      'a recognized environmental condition (REC) (topic:environmental)',
      'prior gas station / dry cleaner / auto / industrial use (topic:environmental)',
      'open contamination most lenders will not touch without remediation (topic:environmental)'
    ]
  },
  pca: {
    label: 'a property condition assessment (PCA / PCR)',
    src: 'docs',
    fields: ['immediateRepairsCost','annualReplacementReserve','majorSystemsAge','conditionRating'],
    flags: [
      'large immediate / critical repairs (topic:condition)',
      'heavy deferred maintenance (topic:condition)',
      'major systems near end of useful life (topic:condition)'
    ]
  },
  str: {
    label: 'short-term-rental income (AirDNA / platform statements)',
    src: 'docs',
    fields: ['annualStrRevenue','occupancyRate','avgDailyRate','marketName'],
    flags: [
      'STR income needs a haircut (often ~20%) and an STR-friendly lender (topic:occupancy_str)',
      'local STR permitting / restriction risk (topic:permits)',
      'thin or volatile income history (topic:occupancy_str)'
    ]
  },
  hospitality: {
    label: 'hospitality docs (franchise agreement and/or STAR report)',
    src: 'docs',
    fields: ['keys','occupancy','adr','revpar','brandFlag','franchiseExpiry'],
    flags: [
      'a PIP / brand-mandated renovation requirement (topic:condition)',
      'franchise expiring or non-transferable (topic:other)',
      'underperformance vs the competitive set (topic:feasibility)'
    ]
  },

  /* ===== FIX & FLIP / REHAB ===== */
  scope_of_work: {
    label: 'a scope of work / rehab budget',
    src: 'docs',
    fields: ['totalRehabBudget','lineItemCount','contingencyPct','timelineMonths'],
    flags: [
      'budget looks light for the scope described (topic:budget_gap)',
      'no contingency line (topic:budget_gap)',
      'structural / foundation / roof items (topic:condition)',
      'work that will require permits (topic:permits)'
    ]
  },
  contractor_bid: {
    label: 'a contractor bid / estimate',
    src: 'docs',
    fields: ['bidTotal','contractorName','licensed (true/false)','startDate','durationMonths'],
    flags: [
      'unlicensed or unverifiable contractor (topic:experience)',
      'bid well above the stated rehab budget (topic:budget_gap)',
      'vague or open-ended scope (topic:budget_gap)'
    ]
  },

  /* ===== GROUND-UP / VERTICAL SUBDIVISION ===== */
  construction_budget: {
    label: 'a ground-up construction budget / cost breakdown',
    src: 'docs',
    fields: ['totalProjectCost','hardCosts','softCosts','contingencyPct','costPerSqft','costPerUnit'],
    flags: [
      'hard cost per sqft out of line for the market (topic:budget_gap)',
      'thin contingency for ground-up (topic:budget_gap)',
      'soft costs / financing carry not fully captured (topic:budget_gap)'
    ]
  },
  gc_contract: {
    label: 'a general-contractor contract',
    src: 'docs',
    fields: ['contractSum','contractType','gcName','performanceBond (true/false)','completionDate'],
    flags: [
      'no performance / payment bond (topic:other)',
      'cost-plus without a guaranteed-maximum cap (topic:budget_gap)',
      'weak or unproven GC track record (topic:experience)'
    ]
  },
  plans_permits: {
    label: 'plans & specs and/or building permits',
    src: 'docs',
    fields: ['permitStatus','plansApproved (true/false)','buildingType','unitsPlanned','sqftPlanned'],
    flags: [
      'permits not yet issued / entitlement risk (topic:entitlement)',
      'plans not final (topic:permits)',
      'planned use or density conflicts with zoning (topic:entitlement)'
    ]
  },
  draw_schedule: {
    label: 'a construction draw schedule',
    src: 'docs',
    fields: ['numDraws','totalDrawAmount','retentionPct','inspectionRequired (true/false)'],
    flags: [
      'front-loaded draws ahead of completed work (topic:draw)',
      'no retention / holdback (topic:draw)',
      'no third-party inspection tied to draws (topic:draw)'
    ]
  },

  /* ===== LAND / A&D (raw land, horizontal) ===== */
  zoning_entitlement: {
    label: 'zoning / entitlement approvals',
    src: 'docs',
    fields: ['currentZoning','intendedUse','entitlementStatus','approvalsNeeded'],
    flags: [
      'not yet entitled / a rezone or variance is required (topic:entitlement)',
      'intended use not permitted by-right (topic:entitlement)',
      'conditions, CEQA / NEPA, or appeals still pending (topic:entitlement)'
    ]
  },
  plat_civil: {
    label: 'a plat / subdivision map and/or civil site plans',
    src: 'docs',
    fields: ['grossAcres','netAcres','numLots','density','offsiteWorkNeeded (true/false)'],
    flags: [
      'tentative vs final map risk (topic:entitlement)',
      'offsite / infrastructure cost exposure (topic:budget_gap)',
      'lot yield / density below the pro forma (topic:feasibility)'
    ]
  },
  development_proforma: {
    label: 'a development pro forma / feasibility / absorption study',
    src: 'docs',
    fields: ['totalDevCost','projectedSellout','projectedProfit','marginPct','absorptionMonthsPerUnit'],
    flags: [
      'thin profit margin (topic:feasibility)',
      'aggressive absorption / sellout pace (topic:absorption)',
      'cost basis or contingency understated (topic:budget_gap)'
    ]
  },

  /* ===== OTHER ===== */
  misc: {
    label: 'a document that does not fit the standard categories -- read it for any deal-relevant facts and risks it contains',
    src: 'docs',
    fields: ['propertyAddress','keyAmount','keyDate','partyName','assetType','loanRequested'],
    flags: [
      'anything in the document that could threaten a clean closing, the loan math, or the take-out exit (topic:other)',
      'owner-reported or unverified figures presented as established fact (topic:value_gap)',
      'references to other documents, approvals, or conditions that are not included here (topic:missing_docs)'
    ]
  },

  /* ===== fallback ===== */
  generic: {
    label: 'a loan-file document',
    src: 'docs',
    fields: ['propertyAddress','keyAmount','keyDate','partyName'],
    flags: ['anything in the document that could threaten funding or the take-out exit (topic:other)']
  }
};

/* ---------- entry point ---------- */
function pipeline_analyzeDocPdf(base64, mime, docType, contextJson, dealKey, dealLabel, fileName) {
  try {
    base64 = String(base64 == null ? '' : base64);
    if (!base64) return { ok: false, error: 'no_file' };
    if (base64.length > 26000000) return { ok: false, error: 'file_too_large' };  // ~19MB raw — Gemini inline cap
    mime = String(mime || 'application/pdf');
    docType = String(docType || '').toLowerCase().trim();
    var spec = PIPELINE_DOC_SPECS[docType] || PIPELINE_DOC_SPECS.generic;
    var ctx = '';
    try { ctx = contextJson ? String(contextJson) : ''; } catch (e) { ctx = ''; }
    var g = Pipeline_geminiDocExtract_(Pipeline_docSys_(spec), Pipeline_docUser_(spec, ctx), base64, mime, spec.src || 'docs');
    if (!g.ok) return { ok: false, error: g.error || 'gemini_error' };
    var driveUrl = '';
    try { driveUrl = Pipeline_saveDocToDrive_(base64, mime, fileName, dealLabel, dealKey); } catch (e) { driveUrl = ''; }
    return { ok: true, docType: docType, fields: g.fields, flags: g.flags, unmapped: g.unmapped, confidence: g.confidence, model: g.model, driveUrl: driveUrl };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* RUN THIS ONCE from the editor (select pipeline_authorizeDrive, click Run, then Allow) to grant the
   Google Drive permission BEFORE deploying. Granting first is what keeps the web app from hanging. */
function pipeline_authorizeDrive() {
  var root = DriveApp.getRootFolder();
  Logger.log('Drive authorized OK. Root folder: ' + root.getName());
  return true;
}

/* Save the uploaded PDF into a per-deal folder under "ASAP Loan Docs" so it can be reopened later.
   Reuses an existing same-named file (no duplicates on a re-read). Returns the URL, or '' on any
   failure — Drive problems never block the AI read. */
function Pipeline_saveDocToDrive_(base64, mime, fileName, dealLabel, dealKey) {
  try {
    if (!base64) return '';
    var parent = Pipeline_driveFolder_('ASAP Loan Docs', null);
    var label = String(dealLabel || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label) label = String(dealKey || '').replace(/[^0-9a-z]+/gi, '').slice(0, 24) || 'Unsorted';
    var sub = Pipeline_driveFolder_(label, parent);
    var name = String(fileName || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || ('document-' + Date.now() + '.pdf');
    var existing = sub.getFilesByName(name);
    if (existing.hasNext()) return existing.next().getUrl();
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'application/pdf', name);
    return sub.createFile(blob).getUrl();
  } catch (e) { return ''; }
}
function Pipeline_driveFolder_(name, parent) {
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

/* ---------- prompt builders ---------- */
function Pipeline_docSys_(spec) {
  var fieldList = (spec.fields || []).map(function (s) { return '  - ' + s; }).join('\n');
  var flagList = (spec.flags || []).map(function (s) { return '  - ' + s; }).join('\n');
  return [
    'You are a senior underwriter at ASAP Funding, a U.S. hard-money / private-money mortgage broker.',
    'A loan officer uploaded ' + spec.label + '. Read the ACTUAL document (you read PDFs natively, including scans) and return TWO things: (1) the key numbers/facts the deal calculator needs, and (2) the concrete risks that could threaten funding or the take-out exit.',
    '',
    'EXTRACT these fields when the document shows them. Use these EXACT keys. Money as plain numbers (no $, no commas). Dates YYYY-MM-DD. Use null when a field is absent:',
    fieldList || '  - (none)',
    '',
    'FLAG these risks ONLY when the document actually supports them:',
    flagList || '  - (none)',
    '',
    'GENERAL RULES:',
    '- Report ONLY what the document shows. Never guess: use null and a low confidence instead.',
    '- Do NOT restate routine qualification (LTV caps, FICO minimums). Focus on what THIS document reveals.',
    '- For each flag give: a short "name"; the "threat" in ONE sentence (what it endangers: closing clean, the payoff math, or the exit); 0-3 borrower/escrow "ask" questions; a "solution" object {"primary","fallback","lastResort"} as a decision tree ("If X -> do Y" / "If not -> Z" / "Otherwise -> cure / restructure / pass"); a one-line "lenders" note (which lenders fit/avoid, or "rule-driven — confirm a capable lender"); and a "topic" (ONE lowercase keyword from: ' + PIPELINE_DOC_TOPICS + ').',
    '- "severity" is "hard" (likely blocks a clean close or kills the exit unless cured) or "medium" (curable from proceeds, or a condition to clear).',
    '- "unmapped": for anything notable that does NOT map to a field above (a tenant concession, an appraiser condition, an unusual credit, a name to verify), add a short borrower QUESTION string. These become call questions.',
    '- "confidence": a 0.0-1.0 number per field key you returned.',
    '- Keep every string short and in plain underwriter English. Merge overlapping items. 8 flags maximum.',
    'Return ONLY JSON in this EXACT shape: {"fields":{...},"flags":[{"severity":"hard|medium","name":"...","topic":"...","threat":"...","ask":["..."],"solution":{"primary":"...","fallback":"...","lastResort":"..."},"lenders":"..."}],"unmapped":["..."],"confidence":{...}}. No markdown, no commentary.'
  ].join('\n');
}

function Pipeline_docUser_(spec, ctx) {
  return 'Read the attached document (' + spec.label + ') and extract per your instructions.' +
    '\n\nDEAL CONTEXT (reference only — for the owner/borrower match, seasoning, and which numbers matter; do not re-flag routine items):\n' + (ctx || '(none provided)');
}

/* ---------- Gemini caller (same key/endpoint/retry as TitleFlags; parses fields + flags + unmapped) ---------- */
function Pipeline_geminiDocExtract_(sysText, userText, base64, mime, src) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [
        { inline_data: { mime_type: mime, data: base64 } },
        { text: userText }
      ] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    });

    function call_(model) {
      var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: payload });
      return { code: resp.getResponseCode(), text: resp.getContentText() };
    }

    function list_(v) {
      if (v && v.join) return v.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 6);
      return (v != null && String(v).trim() !== '') ? [String(v).trim()] : [];
    }
    function numize_(v) {
      if (v == null) return null;
      if (typeof v === 'number') return v;
      var s = String(v).trim();
      if (s === '') return null;
      var cleaned = s.replace(/[$,%\s]/g, '').replace(/,/g, '');
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) return parseFloat(cleaned);
      return v;  // keep non-numeric strings (addresses, names, dates, true/false) as-is
    }
    function fields_(o) {
      var out = {};
      if (o && typeof o === 'object') {
        Object.keys(o).forEach(function (k) {
          var kk = String(k).trim(); if (!kk) return;
          var val = o[k];
          if (val === null || val === '' || (typeof val === 'string' && val.toLowerCase() === 'null')) return; // skip empties
          out[kk] = numize_(val);
        });
      }
      return out;
    }
    function conf_(o) {
      var out = {};
      if (o && typeof o === 'object') {
        Object.keys(o).forEach(function (k) {
          var n = parseFloat(o[k]); if (isNaN(n)) return;
          out[String(k).trim()] = Math.max(0, Math.min(1, n));
        });
      }
      return out;
    }
    function flags_(p) {
      var arr = (p && p.flags && p.flags.length) ? p.flags : [];
      var out = [];
      for (var i = 0; i < arr.length && out.length < 8; i++) {
        var f = arr[i] || {};
        var name = String(f.name || '').trim();
        if (!name) continue;
        var sev = String(f.severity || f.sev || 'medium').toLowerCase();
        sev = (sev.indexOf('hard') >= 0) ? 'hard' : 'medium';
        var sol = null;
        if (f.solution && typeof f.solution === 'object') {
          var sp = String(f.solution.primary || '').trim();
          var sf = String(f.solution.fallback || '').trim();
          var sl = String(f.solution.lastResort || f.solution.last_resort || '').trim();
          if (sp || sf || sl) sol = { primary: sp, fallback: sf, lastResort: sl };
        }
        out.push({
          sev: sev,
          name: name,
          topic: String(f.topic || '').trim().toLowerCase(),
          threat: String(f.threat || '').trim(),
          ask: list_(f.ask || f.questions),
          docs: list_(f.docs),
          lenders: String(f.lenders || '').trim(),
          solution: sol,
          resolved: false,
          resolutionNote: '',
          src: src || 'docs'
        });
      }
      return out;
    }
    function parse_(text) {
      var data = JSON.parse(text || '{}'), t = '';
      try { t = data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { t = ''; }
      if (!t) return { empty: true };
      var p = null, ts = String(t);
      try { p = JSON.parse(ts); }
      catch (e) {
        try { p = JSON.parse(ts.replace(/```json|```/g, '').trim()); }
        catch (e2) { try { var a = ts.indexOf('{'), b = ts.lastIndexOf('}'); p = (a >= 0 && b > a) ? JSON.parse(ts.slice(a, b + 1)) : null; } catch (e3) { p = null; } }
      }
      if (!p) return { bad: true };
      return { ok: true, fields: fields_(p.fields), flags: flags_(p), unmapped: list_(p.unmapped), confidence: conf_(p.confidence) };
    }

    var lastErr = 'unknown';
    for (var mi = 0; mi < models.length; mi++) {
      var r = call_(models[mi]);
      if (r.code === 200) { var out = parse_(r.text); if (out.ok) { out.model = models[mi]; return out; } lastErr = out.empty ? 'empty' : 'parse'; break; }
      lastErr = 'api_' + r.code;
      if (r.code === 429) break;
      if (r.code === 503 || r.code === 500) {
        for (var a = 1; a <= 2; a++) {
          Utilities.sleep(1200 * a);
          r = call_(models[mi]);
          if (r.code === 200) { var o2 = parse_(r.text); if (o2.ok) { o2.model = models[mi]; return o2; } lastErr = o2.empty ? 'empty' : 'parse'; break; }
          lastErr = 'api_' + r.code;
          if (r.code !== 503 && r.code !== 500) break;
        }
        if (r.code === 429) break;
      }
    }
    return { ok: false, error: lastErr };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* ---------- editor test: point at a real Drive PDF and pick a type ---------- */
function pipeline_testDocFlags() {
  var FILE_ID = 'PASTE_A_DRIVE_PDF_FILE_ID_HERE';
  var TYPE = 'rent_roll';   // any key in PIPELINE_DOC_SPECS
  if (FILE_ID.indexOf('PASTE') === 0) { Logger.log('Set FILE_ID to a Drive PDF file ID first.'); return; }
  var blob = DriveApp.getFileById(FILE_ID).getBlob();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var res = pipeline_analyzeDocPdf(b64, blob.getContentType() || 'application/pdf', TYPE, '{"borrowerName":"(test)","cat":"purchase"}');
  Logger.log('DOC-FLAGS TEST (' + TYPE + ') ->\n' + JSON.stringify(res, null, 2));
}