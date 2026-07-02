/***** ASAP PIPELINE — 4c: TITLE / PROPERTY-PROFILE PDF READER **********
 * Paste as a NEW script file ("Pipeline_TitleFlags.gs") in the SAME project.
 *
 * WHAT IT DOES
 *   The "On the call" section now has a PDF upload. DK pulls a preliminary
 *   title report or property profile from PropertyScout (a PDF), uploads it,
 *   and clicks "Read title PDF with AI". The dashboard sends the file here as
 *   base64; Gemini reads the PDF NATIVELY (works on scanned/image PDFs too)
 *   and returns the hidden title-killers — liens, easements, chain-of-title
 *   defects, vesting/owner mismatch, true acreage, zoning — each as a flag
 *   card in the same shape the calculator already renders.
 *
 *   Reuses the SAME Gemini key as the deal-questions email and the 4b note
 *   reader (Script Property GEMINI_KEY, optional GEMINI_MODEL). NOTHING new.
 *   Self-contained: does not touch M4, NoteFlags, or any other file.
 *
 * RETURNS
 *   { ok:true,  flags:[ {sev, name, threat, ask:[], docs:[], lenders, src} ] }
 *   { ok:true,  flags:[] }           // document read, nothing flagged (clean)
 *   { ok:false, error:'...' }        // key missing / too big / API error
 *
 * TEST: pipeline_testTitleFlags() needs a real PDF on Drive; for a quick key
 *       check just confirm 4b's pipeline_testNoteFlags() works (same key).
 ************************************************************************/

/* Dashboard entry point — called via google.script.run.pipeline_analyzeTitlePdf */
function pipeline_analyzeTitlePdf(base64, mime, contextJson) {
  try {
    base64 = String(base64 == null ? '' : base64);
    if (!base64) return { ok: false, error: 'no_file' };
    if (base64.length > 26000000) return { ok: false, error: 'file_too_large' };   // ~19MB raw — Gemini inline cap
    mime = String(mime || 'application/pdf');
    var ctx = '';
    try { ctx = contextJson ? String(contextJson) : ''; } catch (e) { ctx = ''; }
    var g = Pipeline_geminiTitleFlags_(Pipeline_titleFlagsSys_(), Pipeline_titleFlagsUser_(ctx), base64, mime);
    if (!g.ok) return { ok: false, error: g.error || 'gemini_error' };
    return { ok: true, flags: g.flags, model: g.model };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function Pipeline_titleFlagsSys_() {
  return [
    'You are a senior underwriter at ASAP Funding, a U.S. hard-money / private-money mortgage broker.',
    'You are reading a document a loan officer uploaded \u2014 a PRELIMINARY TITLE REPORT and/or a PROPERTY PROFILE report. Extract ONLY the concrete title / collateral risks that could threaten funding or the take-out exit. These are the hidden deal-killers borrowers often can\u2019t self-report, so read the actual document carefully.',
    '',
    'Look for and report, when the document shows them:',
    '- Involuntary liens \u2014 tax liens, mechanic\u2019s / materialman liens, IRS / state liens, judgment liens (give amounts, recording dates, and claimant when shown).',
    '- Unreleased prior / open mortgages or deeds of trust still of record.',
    '- Chain-of-title defects \u2014 quitclaim deeds, gift / inter-family transfers, tax deeds, foreclosure / sheriff\u2019s deeds, probate or estate transfers, gaps in recording, wild deeds.',
    '- Vesting / ownership \u2014 the current vested owner of record; flag if it does NOT match the borrower in the deal context (authority-to-sign / non-arm\u2019s-length).',
    '- Easements, rights-of-way, and deed restrictions / covenants / CC&Rs that limit use of the lot.',
    '- Lis pendens / active litigation, bankruptcy, or open probate touching title.',
    '- HOA \u2014 delinquent dues, special assessments, or HOA litigation.',
    '- Parcel facts \u2014 true acreage / lot size and legal description if they differ from a typical residential lot; zoning / land-use or permitted-use notes.',
    '- Seasoning \u2014 the most recent sale / transfer date and price (used to judge sub-12-month seasoning on a cash-out).',
    '',
    'RULES:',
    '- Report ONLY what the document actually shows. If the document is clean (no liens, clear chain, fee-simple owner matches), return an empty list.',
    '- Do NOT restate routine qualification (LTV caps, FICO / credit minimums). Focus on title / collateral.',
    '- Quote concrete figures and dates from the document where present (e.g., \u201CIRS lien $42,180 recorded 3/2024\u201D, \u201Cvested owner WILLIAMS DARRICK, deed is a quitclaim\u201D).',
    '- For each item give: a short "name"; the "threat" in ONE sentence (what it endangers \u2014 closing clean, the payoff math, or the exit); 0-3 borrower / escrow questions ("ask"); 0-3 "docs" or actions to pull next (payoff statement, quiet-title, endorsement, release, survey); and a one-line "lenders" note (which lenders fit / avoid, or \u201Crule-driven \u2014 confirm a capable lender / title can insure over it\u201D).',
    '- Also give a "topic": ONE lowercase keyword from this list so duplicate cards merge: chain_of_title, lien_position, value_gap, seasoning, litigation, hoa, ground_lease, permits, environmental, property_type, acreage, cross_collateral, insurability, occupancy_str, foreign_national, flood, proceeds_use, other.',
    '- Also give a "solution" object {"primary","fallback","lastResort"} as a decision tree: "primary" = "If <the situation is X> \u2192 <do Y>"; "fallback" = "If that\u2019s not available \u2192 <Z>"; "lastResort" = "Otherwise \u2192 <pass / cure / restructure>". Be specific; name a payoff, endorsement, or lender type where you can.',
    '- severity is "hard" (likely blocks a clean close or kills the exit unless cured) or "medium" (payable / curable from proceeds, or a condition to clear).',
    '- RESOLUTION: if the document shows a prior concern is now CLEARED (e.g. a release / satisfaction is recorded, the deed is actually arm\u2019s-length with a price, the lien is paid), output that item with "resolved": true, a short "resolutionNote" on why it\u2019s cleared, and the matching "topic" so it clears the earlier flag \u2014 do NOT also raise it as an open problem.',
    '- Keep every string short and in plain underwriter English. Merge overlapping items. 8 items maximum.',
    'Return ONLY JSON in this exact shape: {"flags":[{"severity":"hard|medium","name":"...","topic":"...","threat":"...","ask":["..."],"docs":["..."],"lenders":"...","solution":{"primary":"...","fallback":"...","lastResort":"..."},"resolved":false,"resolutionNote":""}]}. No markdown, no commentary.'
  ].join('\n');
}

function Pipeline_titleFlagsUser_(ctx) {
  return 'Read the attached document (a preliminary title report and/or property profile) and extract the title / collateral risks per your instructions.' +
    '\n\nDEAL CONTEXT (for the owner-vs-borrower match and the seasoning check; reference only \u2014 do not re-flag routine items):\n' + (ctx || '(none provided)');
}

/* Gemini caller — same key / endpoint / model fallback as 4b, but the request
   carries the PDF as inline_data so Gemini reads it natively. Returns
   {ok, flags[]} or {ok:false, error}. */
function Pipeline_geminiTitleFlags_(sysText, userText, base64, mime) {
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
      if (v && v.join) return v.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 4);
      return (v != null && String(v).trim() !== '') ? [String(v).trim()] : [];
    }
    function norm_(p) {
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
          src: 'title'
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
      if (r.code === 429) break;                                  // rate limited — stop
      if (r.code === 503 || r.code === 500) {                     // transient — brief backoff, same model
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

/* Editor test — point it at a real PDF on your Drive to see live output.
   Put a prelim-title or property-profile PDF in Drive, copy its file ID in. */
function pipeline_testTitleFlags() {
  var FILE_ID = 'PASTE_A_DRIVE_PDF_FILE_ID_HERE';
  if (FILE_ID.indexOf('PASTE') === 0) { Logger.log('Set FILE_ID to a Drive PDF file ID first.'); return; }
  var blob = DriveApp.getFileById(FILE_ID).getBlob();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var res = pipeline_analyzeTitlePdf(b64, blob.getContentType() || 'application/pdf', '{"borrowerName":"(test)","cat":"cashout"}');
  Logger.log('TITLE-FLAGS TEST ->\n' + JSON.stringify(res, null, 2));
}