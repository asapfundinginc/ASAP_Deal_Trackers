/**
 * ASAP PIPELINE — Supabase Adapter (Final Schema)
 * Add this as a new .gs file in your Apps Script project.
 *
 * SETUP — one time only:
 *   Apps Script → Project Settings → Script Properties → Add:
 *     SUPABASE_URL   →  https://xxxxxxxxxxxx.supabase.co
 *     SUPABASE_ANON  →  eyJ...  (anon/public key — read only)
 *     SUPABASE_SVC   →  eyJ...  (service_role key — read + write)
 */

// ── Config ─────────────────────────────────────────────────────

function supabase_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url:  props.getProperty('SUPABASE_URL'),
    anon: props.getProperty('SUPABASE_ANON'),
    svc:  props.getProperty('SUPABASE_SVC'),
  };
}

// ── Core fetch (GET — uses anon read-only key) ─────────────────

function sbFetch_(table, select, filter, bustCache) {
  var cfg = supabase_();
  if (!cfg.url || !cfg.anon) throw new Error('Supabase URL or anon key not set in Script Properties.');

  var cacheKey = 'sb_' + table + '_' + (filter || 'all');
  var cache    = CacheService.getScriptCache();

  if (!bustCache) {
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  var params = [];
  if (select) params.push('select=' + encodeURIComponent(select));
  if (filter) params.push(filter);
  params.push('limit=2000');

  var url = cfg.url + '/rest/v1/' + table + (params.length ? '?' + params.join('&') : '');
  var res = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'apikey':        cfg.anon,
      'Authorization': 'Bearer ' + cfg.anon,
    },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200)
    throw new Error('Supabase GET failed (' + table + '): ' + res.getContentText());

  var rows = JSON.parse(res.getContentText());
  var ser  = JSON.stringify(rows);
  if (ser.length < 100000) cache.put(cacheKey, ser, 21600); // 6-hour cache
  return rows;
}

// ── Core write (POST/PATCH/DELETE — uses service_role key) ──────

function sbWrite_(method, table, payload, filter) {
  var cfg = supabase_();
  if (!cfg.url || !cfg.svc) throw new Error('Supabase URL or service key not set in Script Properties.');

  var url = cfg.url + '/rest/v1/' + table + (filter ? '?' + filter : '');
  var res = UrlFetchApp.fetch(url, {
    method:  method,  // 'POST', 'PATCH', 'DELETE'
    headers: {
      'apikey':        cfg.svc,
      'Authorization': 'Bearer ' + cfg.svc,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    payload:            payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code < 200 || code > 299)
    throw new Error('Supabase ' + method + ' failed (' + table + '): ' + res.getContentText());

  var body = res.getContentText();
  return body ? JSON.parse(body) : null;
}

// ── PUBLIC: Lender data (called by matchLenders in M2) ──────────

/**
 * Returns all lender contact rows mapped to the field names
 * that M2 matchLenders() expects.
 */
function fetchContacts_(bustCache) {
  var rows = sbFetch_('lenders', '*', null, bustCache);
  return rows.map(function(r) {
    return {
      // Legacy field names kept so existing M2 code needs minimal changes
      LenderID:         r.lender_code,
      LenderName:       r.name,
      Contact_AE:       r.contact_ae       || '',
      Phone_Email:      r.phone_email      || '',
      Type:             r.lender_type      || '',
      States_Notes:     r.states_notes     || '',
      Confidence:       r.confidence       || 'MED',
      AvgCloseDays:     r.avg_close_days,
      Responsiveness:   r.responsiveness   || 'Unknown',
      ExperienceRating: r.experience_rating,
      TermSheetTAT:     r.term_sheet_tat   || '',
      DealsHistory:     r.deals_history    || '',
      SweetSpot:        r.sweet_spot       || '',
      NicheBenefits:    r.niche_benefits   || '',
      Notes:            r.notes            || '',
      // Internal UUID — needed for FK writes (outreach, matches)
      _uuid:            r.id,
    };
  });
}

/**
 * Returns Active lender_products rows.
 * status=eq.Active filter happens at Supabase — only live products returned.
 */
function fetchProducts_(bustCache) {
  var rows = sbFetch_('lender_products', '*', 'status=eq.Active', bustCache);
  return rows.map(function(r) {
    return {
      ProductID:              r.product_code,
      LenderID:               r.lender_code_ref || '', // resolved below
      Product:                r.product,
      Tier:                   r.tier             || '',
      Status:                 r.status,
      MinLoan:                r.min_loan,
      MaxLoan:                r.max_loan,
      MinFICO_Hard:           r.min_fico_hard,
      MaxLTV:                 r.max_ltv,
      MaxLTV_byFICO:          r.max_ltv_by_fico  || '',
      MaxLTC:                 r.max_ltc,
      MaxLTARV:               r.max_ltarv,
      MaxCLTV:                r.max_cltv,
      MinDSCR:                r.min_dscr,
      EligiblePropTypes:      r.eligible_prop_types || [],
      MaxAcres:               r.max_acres,
      LienPositions:          r.lien_positions   || [],
      OwnerOccupiedAllowed:   r.owner_occupied_allowed,
      MinBorrowerExp:         r.min_borrower_exp || 0,
      StatesOverride:         r.states_override  || [],
      CompFactors:            r.comp_factors     || [],
      WhiteLabel:             r.white_label,
      // true/false/null — null = Unknown (never defaults to false)
      ForeignNationalsAllowed: r.foreign_nationals_allowed,
      AppraisalReq:           r.appraisal_req    || 'Unknown',
      RateRange:              r.rate_range       || '',
      OrigFee:                r.orig_fee         || '',
      // Internal UUID
      _uuid:                  r.id,
      _lenderUUID:            r.lender_id,
    };
  });
}

/**
 * Fetch products then attach lender_code from the lenders join.
 * Call this version if you need LenderID (lender_code) on each product row.
 */
function fetchProductsWithLenderCode_(bustCache) {
  // Supabase PostgREST join: lender_products + lenders
  var rows = sbFetch_(
    'lender_products',
    '*,lenders(lender_code)',
    'status=eq.Active',
    bustCache
  );
  return rows.map(function(r) {
    var mapped = fetchProducts_(bustCache).find(function(p){ return p._uuid === r.id; });
    if (mapped && r.lenders) mapped.LenderID = r.lenders.lender_code;
    return mapped;
  }).filter(Boolean);
}

// ── Deal writes (called from M3 after screening/matching) ────────

/**
 * Upsert a deal row. Creates if new, updates if deal_id already exists.
 */
function upsertDeal(dealObj) {
  return sbWrite_('POST', 'deals', dealObj, null);
  // Supabase upsert: add header 'Prefer: resolution=merge-duplicates'
  // for true upsert behavior — handled in sbWrite_ if needed
}

/**
 * Update specific fields on a deal by ID.
 * Used by automation (availability check) and dashboard edits.
 */
function updateDeal(dealId, fields) {
  return sbWrite_('PATCH', 'deals', fields, 'id=eq.' + encodeURIComponent(dealId));
}

/**
 * Update viewed_status specifically (called by GitHub Actions availability check)
 */
function markDealUnavailable(dealId) {
  return updateDeal(dealId, {
    viewed_status: 'liked_na',
    updated_at:    new Date().toISOString(),
  });
}

/**
 * Save match results for a deal run.
 */
function saveMatchResults(dealId, matches, nearMisses, lenderUUIDMap) {
  var rows = [];
  var runAt = new Date().toISOString();

  matches.forEach(function(m, i) {
    rows.push({
      deal_id:      dealId,
      run_at:       runAt,
      lender_id:    lenderUUIDMap[m.LenderID] || null,
      product_id:   m._uuid || null,
      score:        m.score,
      phase1_passed: true,
      reasons:      m.reasons || [],
      fails:        [],
      is_conditional: !!(m.reasons && m.reasons.some(function(r){ return /exception/i.test(r); })),
      match_rank:   i + 1,
    });
  });

  nearMisses.slice(0, 20).forEach(function(m) {
    rows.push({
      deal_id:      dealId,
      run_at:       runAt,
      lender_id:    lenderUUIDMap[m.LenderID] || null,
      product_id:   m._uuid || null,
      score:        m.score || 0,
      phase1_passed: false,
      reasons:      [],
      fails:        m.fails || [m.reason || ''],
      is_conditional: false,
      match_rank:   null,
    });
  });

  if (rows.length) sbWrite_('POST', 'deal_lender_matches', rows);
}

// ── Cache management ─────────────────────────────────────────────

/**
 * Bust the lender cache. Call after editing guidelines in Supabase.
 * Wire to: ASAP menu → Refresh Lender Data
 */
function refreshLenderCache() {
  var cache = CacheService.getScriptCache();
  cache.remove('sb_lenders_all');
  cache.remove('sb_lender_products_status=eq.Active');
  // Re-warm the cache immediately
  fetchContacts_(true);
  fetchProducts_(true);
  SpreadsheetApp.getActiveSpreadsheet()
    .toast('Lender database refreshed from Supabase.', 'Done', 4);
}

// ── Test ─────────────────────────────────────────────────────────

function testSupabaseConnection() {
  try {
    var contacts = fetchContacts_(true);
    var products = fetchProducts_(true);
    Logger.log('✓ lenders: %s rows', contacts.length);
    Logger.log('✓ lender_products (Active): %s rows', products.length);
    Logger.log('  First lender: %s (%s)', contacts[0].LenderName, contacts[0].LenderID);
    Logger.log('  First product: %s — %s', products[0].Product, products[0].ProductID);
  } catch(e) {
    Logger.log('✗ Connection failed: %s', e.message);
  }
}