function myFunction() {
  
}
/***** ASAP PIPELINE — 4b: GEMINI NOTE-FLAGGER ***************************
 * Paste as a NEW script file ("Pipeline_NoteFlags.gs") in the SAME project.
 *
 * WHAT IT DOES
 *   The calculator's "On the call" section has a Notes box. When DK clicks
 *   "Read notes with AI", the dashboard calls pipeline_analyzeNoteFlags()
 *   with the typed notes. Gemini reads the free text and returns the
 *   story-deal complications the RULES flagger (4a) can't catch — each as a
 *   flag card in the same shape the calculator already renders.
 *
 *   Reuses the SAME Gemini key as the "Ask deal questions" email
 *   (Script Property GEMINI_KEY, optional GEMINI_MODEL). NOTHING new to set up.
 *   Self-contained: does not touch M4 or any other file.
 *
 * RETURNS
 *   { ok:true,  flags:[ {sev, name, threat, ask:[], docs:[], lenders, src} ] }
 *   { ok:true,  flags:[] }           // notes empty, or AI found nothing extra
 *   { ok:false, error:'...' }        // key missing / API error
 *
 * TEST: run pipeline_testNoteFlags() in the editor, then View > Execution log.
 ************************************************************************/

/* Dashboard entry point — called via google.script.run.pipeline_analyzeNoteFlags */
function pipeline_analyzeNoteFlags(notes, contextJson) {
  try {
    notes = String(notes == null ? '' : notes).trim();
    if (!notes) return { ok: true, flags: [] };                 // nothing typed -> nothing to do
    var ctx = '';
    try { ctx = contextJson ? String(contextJson) : ''; } catch (e) { ctx = ''; }
    var g = Pipeline_geminiNoteFlags_(Pipeline_noteFlagsSys_(), Pipeline_noteFlagsUser_(notes, ctx));
    if (!g.ok) return { ok: false, error: g.error || 'gemini_error' };
    return { ok: true, flags: g.flags, model: g.model };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function Pipeline_noteFlagsSys_() {
  return [
    'You are a senior underwriter at ASAP Funding, a U.S. hard-money / private-money mortgage broker.',
    'The loan officer (Daniel) typed free-text notes from a borrower call. Read the notes and surface ONLY unusual, deal-shaping complications a national hard-money / DSCR lender would need clarified, or that could threaten funding or the take-out exit.',
    '',
    'Look for story-deal issues such as: large acreage / rural / agricultural use; unusual or hard-to-comp property type (log, dome, barndominium, manufactured / mobile, mixed-use); condition / not rent-ready (heavy rehab, no certificate of occupancy); square-footage or value mismatch; multi-tenant on an SFR / 5-10 unit / mixed-use; sub-12-month seasoning on a cash-out; non-arm\u2019s-length or unusual chain of title (gift, quitclaim, inheritance, related party, tax deed, foreclosure / sheriff\u2019s deed); proceeds paying personal or third-party debt; a prior appraisal that didn\u2019t close or a prior loan that fell through; existing liens / clouds / 2nd-lien / co-owners; vacancy / no lease / short-term-rental income; foreign national or unusual vesting (irrevocable / land trust, LP); flood zone / insurability; environmental / contamination (gas station, dry cleaner, tanks); active litigation / lis pendens / bankruptcy / probate on title; HOA litigation or special assessments; unpermitted work / ADUs / conversions; problem tenants / eviction / holdover / estoppel; cross-collateral / blanket / partial-release; ground lease / leasehold / TIC / co-op.',
    '',
    'RULES:',
    '- Flag ONLY what the notes actually raise. If the notes raise nothing unusual, return an empty list.',
    '- Do NOT restate routine qualification (LTV caps, credit / FICO minimums, standard down payment) \u2014 those are handled elsewhere.',
    '- Some structured items (acreage, lien position, property type) may already be caught by rules; include a note-driven item only if the notes ADD detail the rules would not have (e.g., \u201Cborrower mentioned a quitclaim from a relative\u201D, \u201Chalf the acreage is leased hay field\u201D).',
    '- For each flag give: a short "name"; the "threat" in ONE sentence (what it endangers \u2014 the bridge math or the exit); 1-3 short borrower questions ("ask"); 0-3 light "docs" to pull; and a one-line "lenders" note (which lenders fit / avoid, or \u201Crule-driven \u2014 confirm a capable lender\u201D if unsure).',
    '- Also give a "topic": ONE lowercase keyword from this list so duplicate cards merge: acreage, value_gap, multi_unit, seasoning, chain_of_title, lien_position, property_type, condition, occupancy_str, foreign_national, flood, environmental, litigation, hoa, ground_lease, permits, cross_collateral, proceeds_use, insurability, other.',
    '- Also give a "solution" object {"primary","fallback","lastResort"} as a decision tree: "primary" = "If <the borrower\u2019s situation is X> \u2192 <do Y>"; "fallback" = "If that\u2019s not available \u2192 <Z>"; "lastResort" = "Otherwise \u2192 <pass / bridge / restructure>". Be specific; name lender types where you can.',
    '- severity is "hard" (1-2 lender homes, or needs a specific structure / exit) or "medium" (a handful of homes, workable with conditions).',
    '- RESOLUTION: if the notes show a concern is now HANDLED (e.g. \u201Cborrower has a DSCR lender that accepts the acreage\u201D, \u201Cseasoning is actually 18 months\u201D, \u201Cit was arm\u2019s-length at $300k\u201D), output that item with "resolved": true, a short "resolutionNote" on why it\u2019s no longer a hurdle, and the matching "topic" so it clears the earlier flag \u2014 do NOT also raise it as an open problem.',
    '- Keep every string short and in plain underwriter English. Reference the borrower\u2019s actual words where useful. Merge overlapping items. 6 flags maximum.',
    'Return ONLY JSON in this exact shape: {"flags":[{"severity":"hard|medium","name":"...","topic":"...","threat":"...","ask":["..."],"docs":["..."],"lenders":"...","solution":{"primary":"...","fallback":"...","lastResort":"..."},"resolved":false,"resolutionNote":""}]}. No markdown, no commentary.'
  ].join('\n');
}

function Pipeline_noteFlagsUser_(notes, ctx) {
  return 'BORROWER CALL NOTES (verbatim):\n' + notes +
    '\n\nDEAL CONTEXT (reference only \u2014 do not re-flag routine items):\n' + (ctx || '(none provided)');
}

/* Gemini caller — mirrors Pipeline_geminiQuestions_ (same key, endpoint, model
   fallback, JSON parse). Returns {ok, flags[]} or {ok:false, error}. */
function Pipeline_geminiNoteFlags_(sysText, userText) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    });

    function call_(model) {
      var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: payload });
      return { code: resp.getResponseCode(), text: resp.getContentText() };
    }

    function list_(v) {
      if (v && v.join) return v.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 4);
      return (v != null && String(v).trim() !== '') ? [String(v).trim()] : [];
    }
    function norm_(p) {
      var arr = (p && p.flags && p.flags.length) ? p.flags : [];
      var out = [];
      for (var i = 0; i < arr.length && out.length < 6; i++) {
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
        var resolved = (f.resolved === true || String(f.resolved).toLowerCase() === 'true');
        out.push({
          sev: sev,
          name: name,
          topic: String(f.topic || '').trim().toLowerCase(),
          threat: String(f.threat || '').trim(),
          ask: list_(f.ask || f.questions),
          docs: list_(f.docs),
          lenders: String(f.lenders || '').trim(),
          solution: sol,
          resolved: resolved,
          resolutionNote: String(f.resolutionNote || f.resolution_note || '').trim(),
          src: 'notes'
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
      return { ok: true, flags: norm_(p) };
    }

    var lastErr = 'unknown';
    for (var mi = 0; mi < models.length; mi++) {
      var r = call_(models[mi]);
      if (r.code === 200) { var out = parse_(r.text); if (out.ok) { out.model = models[mi]; return out; } lastErr = out.empty ? 'empty' : 'parse'; break; }
      lastErr = 'api_' + r.code;
      if (r.code === 429) break;                                  // rate limited — stop, don't burn quota
      if (r.code === 503 || r.code === 500) {                     // transient overload — brief backoff, same model
        for (var a = 1; a <= 2; a++) {
          Utilities.sleep(900 * a);
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

/* One-click editor test — fake notes through the real pipeline. */
function pipeline_testNoteFlags() {
  var notes = 'Borrower says the house sits on about 30 acres, half of it is hay field he leases to a neighbor. He inherited it from his late father last year and the deed was a quitclaim, never properly put in his own name. There is an old barn and a second mobile home on the back of the lot that a cousin lives in. He also mentioned a prior lender ordered an appraisal a few months ago but the deal fell through.';
  var res = pipeline_analyzeNoteFlags(notes, '{"cat":"cashout","propClass":"Single-family","value":650000,"purpose":"Cash-Out Refinance"}');
  Logger.log('NOTE-FLAGS TEST ->\n' + JSON.stringify(res, null, 2));
}