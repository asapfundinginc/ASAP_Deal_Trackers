/*****************************************************************************
 * ASAP — Key deal facts condenser
 * pipeline_condenseDealFacts(factsJson) -> { ok, bullets:[...] } | { ok:false, error }
 *
 * Takes the borrower-submitted free text (collateral/property summary, exit
 * plan, borrower background) PLUS the structured fields already on screen, and
 * returns a SHORT bulleted digest of only the key facts NOT already shown.
 * Called from the Deal Calculator's "Key deal facts" panel (On the call).
 *
 * Uses the same Gemini key/model as the rest of the toolset (Script Property
 * GEMINI_KEY, optional GEMINI_MODEL). Falls back gracefully on any error — the
 * calculator then shows a short teaser from the summary instead.
 *****************************************************************************/
function pipeline_condenseDealFacts(factsJson) {
  try {
    var inp = {};
    try { inp = (typeof factsJson === 'string') ? JSON.parse(factsJson || '{}') : (factsJson || {}); } catch (e) { inp = {}; }
    var summary = String(inp.summary || '').trim();
    var exit = String(inp.exit || '').trim();
    var bd = String(inp.borrowerDetails || '').trim();
    if (!summary && !exit && !bd) return { ok: false, error: 'no_text' };
    var known = inp.known || {};

    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var sysText = [
      'You condense a private-lending / hard-money deal into a SHORT bulleted digest for Daniel, a loan broker, to glance at while underwriting on a call.',
      'You are given the borrower-submitted free text (collateral / property summary, exit plan, borrower background) AND a list of facts ALREADY shown to Daniel as separate fields on the same screen.',
      'Your job: pull out ONLY the key facts a broker/lender needs, as short bullets.',
      'HARD RULES:',
      '- Do NOT repeat anything already in the "alreadyShown" fields (loan amount, property value, monthly or annual rent, FICO, lien position, building size, lot size, occupancy, property type, loan purpose). Those are already on screen — repeating them is the whole problem you are solving.',
      '- DO surface what is NOT in those fields: year built, beds / baths, unit mix or multiple properties, construction / condition, the scope of any renovation, notable features (e.g. EV charger, ADU, new systems), whether the exact address is withheld, the exit strategy in brief, the borrower experience in brief, the protective-equity cushion, and any risk / story-deal flags (seasoning, non-arm\u2019s-length, rural acreage, etc.).',
      '- Each bullet must be SHORT and telegraphic (about 4 to 12 words), NOT a full sentence. No trailing period.',
      '- Prefix exit-plan bullets with "Exit \u2014 " and borrower-background bullets with "Borrower \u2014 ". Property/collateral bullets get no prefix.',
      '- 4 to 8 bullets total. Order: property facts first, then exit, then borrower.',
      '- Do NOT invent facts. Use only what is in the text. Omit a category entirely if the text has nothing new for it.',
      'Return ONLY JSON in this exact shape: {"bullets":["...","..."]} with no markdown and no commentary.'
    ].join('\n');

    var userText = JSON.stringify({
      collateralSummary: summary,
      exitPlan: exit,
      borrowerBackground: bd,
      alreadyShown: {
        loan: known.loan || '', propertyValue: known.value || '', monthlyRent: known.rent || '', annualRent: known.annualRent || '',
        fico: known.fico || '', lien: known.lien || '', buildingSize: known.buildingSize || '', lotSize: known.lotSize || '',
        occupancy: known.occupancy || '', propertyType: known.propertyType || '', loanPurpose: known.purpose || ''
      }
    });

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } }
    });

    function call_(model) {
      var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: payload });
      return { code: resp.getResponseCode(), text: resp.getContentText() };
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
      if (!p || !p.bullets || !p.bullets.length) return { bad: true };
      var arr = [];
      for (var i = 0; i < p.bullets.length; i++) { var s = String(p.bullets[i] || '').replace(/\s+/g, ' ').trim(); if (s) arr.push(s); }
      if (!arr.length) return { bad: true };
      return { ok: true, bullets: arr.slice(0, 10) };
    }

    var lastErr = 'unknown';
    for (var mi = 0; mi < models.length; mi++) {
      var r = call_(models[mi]);
      if (r.code === 200) { var out = parse_(r.text); if (out.ok) return out; lastErr = out.empty ? 'empty' : 'parse'; break; }
      lastErr = 'api_' + r.code;
      if (r.code === 429) break;
      if (r.code === 503 || r.code === 500) {
        for (var a = 1; a <= 2; a++) {
          Utilities.sleep(900 * a);
          r = call_(models[mi]);
          if (r.code === 200) { var o2 = parse_(r.text); if (o2.ok) return o2; lastErr = o2.empty ? 'empty' : 'parse'; break; }
          lastErr = 'api_' + r.code;
          if (r.code !== 503 && r.code !== 500) break;
        }
        if (r.code === 429) break;
      }
    }
    return { ok: false, error: lastErr };
  } catch (err) { return { ok: false, error: String(err) }; }
}