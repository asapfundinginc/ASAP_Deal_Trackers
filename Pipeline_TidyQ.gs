/***** ASAP PIPELINE — THEMATIC CALL-SHEET GROUPER ***********************
 * Paste as "Pipeline_TidyQ.gs" in the SAME project (replaces the old file
 * of the same name). Function name is unchanged: pipeline_tidyQuestions.
 *
 * WHAT CHANGED (v2 — thematic parent/child):
 *   The old version merged near-duplicate questions into one flat list.
 *   This version performs THEMATIC HIERARCHICAL GROUPING: it clusters all
 *   system-risk questions AND the broker's manual questions by their core
 *   real-estate theme (pre-sales, land/acreage, valuation, sponsor
 *   experience, title, seasoning, etc.) and returns, per theme:
 *     - a punchy conversational MASTER question (what the broker says out
 *       loud to open the topic), and
 *     - an array of short bite-size SUBPOINTS (the details to verify).
 *   Long run-on "monster" questions are split into several subpoints.
 *
 * Same Gemini key/model as the other AI files (Script Property GEMINI_KEY,
 * optional GEMINI_MODEL). Text-only call (no PDF).
 *
 * CONTRACT (coverage-safe): every input index appears in exactly ONE theme.
 * If the model drops any index, clean_() returns null and the caller keeps
 * its current on-screen list untouched, so a topic can never be lost.
 *
 *   pipeline_tidyQuestions(itemsJson, contextJson)
 *     -> { ok:true, themes:[ { master:"...", severity:"hard|medium|low",
 *                              ids:[0,3], subpoints:["...", "..."] }, ... ] }
 ************************************************************************/

function pipeline_tidyQuestions(itemsJson, contextJson) {
  try {
    var arr = [];
    try { arr = JSON.parse(itemsJson || '[]') || []; } catch (e) { arr = []; }
    arr = (arr && arr.join) ? arr.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean) : [];
    if (arr.length < 2) {
      // Nothing to cluster — one theme per item (still coverage-safe).
      return { ok: true, themes: arr.map(function (q, i) { return { master: q, severity: 'low', ids: [i], subpoints: [q] }; }) };
    }

    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var numbered = arr.map(function (q, i) { return i + '. ' + q; }).join('\n');
    var sysText = Pipeline_tidySys_();
    var userText = 'DEAL CONTEXT (reference only):\n' + (contextJson || '(none)') +
      '\n\nITEMS (0-indexed; a mix of system-risk questions and the broker\'s own questions):\n' + numbered +
      '\n\nReturn JSON {"themes":[{"master":"<one short conversational question the broker says out loud to open this topic>",' +
      '"severity":"hard|medium|low","ids":[<every input index that belongs to this theme>],' +
      '"subpoints":["<short bite-size checklist item>", "..."]}]}. ' +
      'Cluster by underlying real-estate theme. Every index 0..' + (arr.length - 1) +
      ' must appear in exactly one theme. Split any long run-on item into several short subpoints. ' +
      'Do not invent topics that are not present. Output strict JSON only, no preamble.';

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
    });

    function call_(model) {
      var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: payload });
      return { code: resp.getResponseCode(), text: resp.getContentText() };
    }
    function parse_(text) {
      var data = JSON.parse(text || '{}'), t = '';
      try { t = data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join(''); } catch (e) { t = ''; }
      if (!t) return null;
      var p = null, ts = String(t);
      try { p = JSON.parse(ts); }
      catch (e) {
        try { p = JSON.parse(ts.replace(/```json|```/g, '').trim()); }
        catch (e2) { try { var a = ts.indexOf('{'), b = ts.lastIndexOf('}'); p = (a >= 0 && b > a) ? JSON.parse(ts.slice(a, b + 1)) : null; } catch (e3) { p = null; } }
      }
      return p;
    }
    function clean_(p, n) {
      var themes = (p && p.themes && p.themes.join) ? p.themes : [];
      var out = [], seen = {};
      themes.forEach(function (t) {
        if (!t) return;
        var master = String(t.master || t.question || t.text || '').trim();
        var sev = String(t.severity || '').toLowerCase();
        if (['hard', 'medium', 'low'].indexOf(sev) < 0) sev = 'medium';
        var ids = (t.ids && t.ids.join) ? t.ids.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x) && x >= 0 && x < n; }) : [];
        // First theme to claim an index wins it, so no index is double-counted.
        ids = ids.filter(function (i) { if (seen[i]) return false; seen[i] = 1; return true; });
        var subs = (t.subpoints && t.subpoints.join) ? t.subpoints.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(Boolean) : [];
        if (!subs.length && ids.length) subs = ids.map(function (i) { return arr[i]; });
        if (!master) master = subs[0] || (ids.length ? arr[ids[0]] : '');
        if (master && ids.length) out.push({ master: master, severity: sev, ids: ids, subpoints: subs });
      });
      var covered = 0; for (var i = 0; i < n; i++) { if (seen[i]) covered++; }
      if (covered < n) return null; // a topic was dropped -> caller keeps its current list
      return out;
    }

    var lastErr = 'unknown';
    for (var mi = 0; mi < models.length; mi++) {
      var r = call_(models[mi]);
      if (r.code === 200) {
        var themes = clean_(parse_(r.text), arr.length);
        if (themes && themes.length) return { ok: true, themes: themes, model: models[mi] };
        lastErr = 'empty_or_incomplete';
      } else {
        lastErr = 'http_' + r.code; // 429 / 5xx fall through to the next model
        if (r.code !== 429 && r.code < 500) break;
      }
    }
    return { ok: false, error: lastErr };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function Pipeline_tidySys_() {
  return [
    'You organize a loan officer\'s call-prep items into a clean, thematic parent/child checklist before they phone a borrower.',
    'You receive a numbered, 0-indexed list of items. Some are system-generated risk questions; some are the broker\'s own questions. Many OVERLAP, repeat, or are long run-on questions that bundle several asks together.',
    'Your job is THEMATIC HIERARCHICAL GROUPING:',
    '1. CLUSTER every item by its core underlying real-estate theme (for example: pre-sales, land / acreage, valuation, sponsor experience, title / liens, seasoning, occupancy, property condition, flood / insurance). Items that touch the same theme, even partially, belong in the SAME cluster.',
    '2. For each cluster, write ONE short, conversational MASTER question the broker actually says out loud to open the topic. Plain English, one breath, no jargon. Example master: "Can you walk me through the development plan for the acreage beyond the model home?"',
    '3. For each cluster, list short bite-size SUBPOINTS: the specific details to verify or check off. SPLIT any long run-on item into several subpoints. Example subpoints: "Usable vs. raw land breakdown", "Status of roads / utilities / stormwater", "Expected absorption rate".',
    '4. Set a severity for each theme: "hard" for deal-killers, "medium" for items that need confirming, "low" for routine asks.',
    '5. Keep EVERY distinct topic. If two items are about genuinely different things, put them in different themes. When unsure whether two overlap, lean toward MERGING into one theme — but never drop a topic.',
    '6. Do not invent topics or questions that are not present in the list.',
    'Every input index must appear in exactly one theme\'s ids. Output strict JSON only: {"themes":[{"master":"...","severity":"medium","ids":[0,3],"subpoints":["...","..."]}]} with no preamble.'
  ].join('\n');
}

/* Editor sanity check. */
function pipeline_testTidyQuestions() {
  var items = JSON.stringify([
    'When will the verbally committed pre-sales be converted into signed purchase agreements?',
    'What is the current status of any signed contracts for the four pre-sold homes?',
    'Are the four pre-sold homes under binding contract or just a verbal commitment?',
    'For the acreage, detail the development plan beyond the model home, the usable vs raw land split, and the status of existing infrastructure.',
    'What is the borrower\'s liquidity and cash reserves available for cost overruns?',
    'Has an independent third-party appraisal been completed to support the land value?'
  ]);
  Logger.log(JSON.stringify(pipeline_tidyQuestions(items, 'Sylvan Acres, 19-lot subdivision, VA')));
}