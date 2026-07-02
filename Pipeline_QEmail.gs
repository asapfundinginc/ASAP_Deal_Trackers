/**
 * Pipeline_QEmail.gs — "Email borrower questions"
 *
 * Takes the questions gathered in the Deal Calculator's on-the-call section
 * (the story-deal FLAG questions + whatever is in the call checklist, which
 * itself may include the pulled "Ask deal questions") and merges them — by
 * MEANING, not just exact text — into one clean, de-duplicated set, then
 * writes a short borrower email requesting those clarifications.
 *
 * Reuses the SAME Gemini key as the other AI helpers (Script Property
 * GEMINI_KEY, optional GEMINI_MODEL). Nothing new to set up.
 *
 * The returned {email, subject, body, source} is fed straight into the existing
 * "Clarifying questions" preview modal (openQ), so Daniel can edit it, pick a
 * sender, and Draft/Send via pipeline_commitDealQuestions — no new send path.
 *
 * If the AI key is missing or the call fails, it still returns a usable email
 * built from a plain (exact-match) de-dupe, with a "source" note so the modal
 * shows that it wasn't AI-merged.
 *
 * Returns: { ok:true, email, subject, body, source } | { ok:false, error }
 */
function pipeline_buildBorrowerQuestionEmail(borrowerName, borrowerEmail, address, questionsJson, contextJson) {
  var name = String(borrowerName || '').trim();
  var addr = String(address || '').trim();

  // ---- route by the selected email type (the dropdown's choice rides inside the context) ----
  var ctxKind = '';
  try { var __pc = JSON.parse(contextJson || '{}') || {}; ctxKind = String(__pc.kind || (__pc.loanOfficerWorkingNumbers || {}).kind || '').toLowerCase(); } catch (eK) { ctxKind = ''; }
  if (ctxKind === 'intro') {
    var introOut = QEmail_intro_(name);
    if (introOut && introOut.ok) return { ok: true, email: String(borrowerEmail || ''), subject: introOut.subject, body: introOut.body, source: 'intro' };
  }
  if (ctxKind === 'docs' || ctxKind === 'doc' || ctxKind === 'docrequest') {
    var ctxD = {}; try { ctxD = JSON.parse(contextJson || '{}') || {}; } catch (eD) { ctxD = {}; }
    var docsOut = QEmail_docs_(name, addr, ctxD.docsNeeded || ctxD.docs || (ctxD.loanOfficerWorkingNumbers || {}).docsNeeded || []);
    if (docsOut && docsOut.ok) return { ok: true, email: String(borrowerEmail || ''), subject: docsOut.subject, body: docsOut.body, source: 'docs' };
    return { ok: false, error: (docsOut && docsOut.error) || 'no_docs' };
  }

  // ---- gather + exact-dedupe the incoming questions ----
  var raw = [];
  try { raw = JSON.parse(questionsJson || '[]'); } catch (e) { raw = []; }
  if (!raw || !raw.join) raw = [];
  var seen = {}, questions = [];
  for (var i = 0; i < raw.length; i++) {
    var q = String(raw[i] == null ? '' : raw[i]).replace(/\s+/g, ' ').trim();
    if (q.length < 5) continue;
    var k = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k || seen[k]) continue;
    seen[k] = 1;
    questions.push(q);
  }
  if (!questions.length && !contextJson) return { ok: false, error: 'no_questions' };

  var firstName = name ? name.split(/\s+/)[0] : '';
  var greet = firstName ? ('Hi ' + firstName + ',') : 'Hi,';

  // ---- holistic build (when the dashboard passed deal context: data, flags, screen) ----
  if (contextJson) {
    try {
      var smart = QEmail_geminiSmart_(name, addr, questions, contextJson);
      if (smart && smart.ok && smart.body) {
        return { ok: true, email: String(borrowerEmail || ''), subject: smart.subject || QEmail_defaultSubject_(addr), body: smart.body, source: 'gemini-smart' };
      }
    } catch (eSmart) {}
  }

  // ---- fallback: AI semantic merge (no context, or smart build failed) ----
  var ai = QEmail_gemini_(name, addr, questions);
  if (ai && ai.ok && ai.body) {
    return { ok: true, email: String(borrowerEmail || ''), subject: ai.subject || QEmail_defaultSubject_(addr), body: ai.body, source: 'gemini' };
  }

  // ---- fallback: plain list, no AI merge ----
  var lines = [];
  lines.push(greet);
  lines.push('');
  lines.push('To keep your file moving, could you help me with a few quick questions on the property' + (addr ? (' at ' + addr) : '') + '?');
  lines.push('');
  for (var j = 0; j < questions.length; j++) lines.push((j + 1) + '. ' + questions[j]);
  lines.push('');
  lines.push('No rush — whatever you have handy is a great start. Thanks!');
  var why = (ai && ai.error) ? ('AI merge unavailable: ' + ai.error + ' — questions listed as-is') : 'listed as-is (not AI-merged)';
  return { ok: true, email: String(borrowerEmail || ''), subject: QEmail_defaultSubject_(addr), body: lines.join('\n'), source: why };
}

function QEmail_defaultSubject_(addr) {
  return 'A few quick questions on your loan request' + (addr ? (' — ' + addr) : '');
}

function QEmail_intro_(name) {
  var first = name ? String(name).split(/\s+/)[0] : '';
  var nm = first || 'there';
  var intros = [
    { s: 'Quick question on your deal', b: "Hi [N],\n\nI've got your deal up on my screen right now and have a few thoughts on how we can structure it. What's the best way to connect? Happy to jump on a quick call, or just let me know a time that works for you." },
    { s: 'Your ASAP Funding scenario', b: "Hi [N],\n\nI'm taking a look at your loan scenario and have a couple of options in mind. Nothing complicated, I just want to make sure I fully understand your goals before we go further. When's a good time to connect? A quick 10-minute call is usually all it takes to get started." },
    { s: 'Quick check on your property financing', b: "Hi [N],\n\nYour file crossed my desk today. I've got a couple of ways we can structure the funding for this, but I want to make sure I'm aligned with your timeline before I put the options together. Let me know when you've got 5 minutes to connect." },
    { s: 'Your loan scenario', b: "Hello [N],\n\nYour loan file just came across my desk and I want to make sure we get you the right structure from the start. Are you free for a quick call later today or tomorrow? Feel free to call me directly, or just reply here with what's easiest for you." },
    { s: 'Numbers on your project', b: "Hi [N],\n\nI'm running some preliminary numbers on your property right now. I think we can make this work smoothly, but I have a few questions for you before I send anything over. Are you around for a brief call later today?" },
    { s: 'Next steps on your loan', b: "Hello [N],\n\nI just finished looking over the details for your loan request. Everything looks pretty straightforward on my end. Let me know what your timeline looks like and we can map out the next steps. Feel free to call or text me when you have a second." },
    { s: 'Quick chat about your deal', b: "Hi [N],\n\nI'm reviewing your loan scenario today. I could write up a long email with different options, but it's usually faster to just hash it out on a quick call. What does your schedule look like tomorrow?" },
    { s: 'Your financing request', b: "Hello [N],\n\nYour file just landed on my desk. I have a solid idea of what we need to do to get this to the finish line. Let me know when you've got a few minutes to jump on a call and go over the specifics." },
    { s: 'Funding for your property', b: "[N],\n\nI'm taking a look at your file today and wanted to get in touch. I have some availability later to go over the best ways to structure the funding for this. Let me know the best number to reach you at." }
  ];
  var pick = intros[Math.floor(Math.random() * intros.length)];
  return { ok: true, subject: pick.s, body: pick.b.split('[N]').join(nm) };
}

function QEmail_docs_(name, addr, docsNeeded) {
  var first = name ? String(name).split(/\s+/)[0] : '';
  var greet = first ? ('Hi ' + first + ',') : 'Hi,';
  var list = [];
  (docsNeeded || []).forEach(function (d) { var t = String(d == null ? '' : d).replace(/\s+/g, ' ').trim(); if (t) list.push(t); });
  if (!list.length) return { ok: false, error: 'no_docs' };
  var lines = [];
  lines.push(greet);
  lines.push('');
  lines.push('To keep your file moving' + (addr ? (' on the property at ' + addr) : '') + ', here are the remaining items I still need from you:');
  lines.push('');
  for (var i = 0; i < list.length; i++) lines.push('- ' + list[i]);
  lines.push('');
  lines.push('Whatever you have on hand is a great start \u2014 send them over as you get them and we will keep things moving. Thanks!');
  return { ok: true, subject: 'Documents needed for your loan' + (addr ? (' \u2014 ' + addr) : ''), body: lines.join('\n') };
}

function QEmail_gemini_(name, addr, questions) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var sysText = [
      'You write a first-contact email that a private-lending / hard-money loan broker sends DIRECTLY to a borrower, in first person as the broker speaking. You are given a list of clarifying questions for the borrower. The list was assembled from two sources and may contain DUPLICATES or near-duplicates worded differently.',
      'Your job:',
      '1) MERGE the questions into ONE clean set. Combine any that ask for the same thing — even when the wording differs (e.g. "what will the cash-out proceeds be used for?" and "...and what will the proceeds be used for?" are the SAME question) — into a single, clear question. Drop exact duplicates. Keep every genuinely distinct question. Do not invent new questions.',
      '2) Order them logically (property/value first, then loan purpose/use of funds, then title/ownership, then leases/income, then docs).',
      '3) Write a SHORT, friendly, professional email body to the borrower asking for these clarifications as a NUMBERED list. Keep the intro to one or two sentences and the closing to one line. INTRO FRAMING: the borrower did NOT contact you first, so NEVER thank the borrower for "reaching out", "contacting us", or "your interest" -- do NOT mention any referral source, platform, or introduction (the borrower already knows the context); write in the FIRST PERSON as the sender and open warm and brief: you may briefly hope they are well and show measured interest (the deal looks worth a closer look), but do NOT claim you can definitely fund it -- you are reviewing it and need a few things clarified before you can assess fit and give a firm yes; vary the opening wording each time.',
      'Hard rules: keep it concise; plain text only; write the ENTIRE email in the first person as the sender and do NOT put any personal name (such as Daniel or Joe) or our company name in the body as the person evaluating or sending (keep the body name-neutral); do NOT add a signature, sign-off name, or "Best regards"-style closing with a name (a signature is added later); do NOT add disclaimers; do NOT mention lenders by name; do NOT restate that questions were merged.',
      'Return ONLY JSON in this exact shape: {"subject":"...","body":"..."} with no markdown and no commentary. The body must already start with the greeting "' + (name ? ('Hi ' + String(name).split(/\s+/)[0] + ',') : 'Hi,') + '" and contain the numbered questions.'
    ].join('\n');

    var userText = JSON.stringify({
      borrowerName: name || '',
      propertyAddress: addr || '',
      questions: questions
    });

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
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
      if (!p) return { bad: true };
      var body = String(p.body || '').trim();
      if (!body) return { bad: true };
      return { ok: true, subject: String(p.subject || '').trim(), body: body };
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

function QEmail_geminiSmart_(name, addr, questions, contextJson) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var primary = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    var models = [primary];
    ['gemini-flash-latest', 'gemini-2.5-flash-lite'].forEach(function (m) { if (models.indexOf(m) < 0) models.push(m); });

    var first = name ? String(name).split(/\s+/)[0] : '';
    var greet = first ? ('Hi ' + first + ',') : 'Hi,';

    // Rotate the opening so identical intros never go out (WorkingMoni staff is CC'd on every one).
    var introAngles = [
      'Open by saying you are reviewing their request on this property and just need a few details to give it a proper look. Make NO fundability claim.',
      'Briefly hope they are well, then say you are taking a closer look at the deal and need a few details before you can weigh in. Do NOT promise funding.',
      'Say the deal is on your desk and, before you can assess the fit, you need clarification on a few items. Make no fundability claim.',
      'Hope they are doing well, then say the deal looks like it could be a fit and you need a few answers to evaluate it properly -- say it could be a fit, not that you can fund it.',
      'Say you have started reviewing the request and it looks worth a serious look, and a few clarifications will help you assess it. Stop short of promising funding.',
      'Say the deal caught your attention and, to dig in further, you need a bit more detail. Do NOT say you can fund it yet.'
    ];
    var introAngle = introAngles[Math.floor(Math.random() * introAngles.length)];

    var sysText = [
      'You are an expert real estate investment loan officer. Perform a "Gap Analysis" on the borrower file given as JSON and draft a SHORT, direct email asking only for the missing or unclear information you need before you can issue loan terms.',
      'The JSON contains up to five data sources: (1) calculator data (loan amount, value or ARV, purchase price, cash-to-close and other numbers), (2) the on-the-call key deal facts (the structure and intent of the deal), (3) risk items and questions raised on the call (red flags, timeline crunches, open questions -- in the context and in draftQuestions), (4) notes (file notes, borrower background, context), and (5) findings from any uploaded documents -- what was read from bank statements, entity docs, appraisals, scopes of work, title, etc. -- provided in the context as documentFindings (each with the document name, type, any extracted fields, and risk flags).',
      'Analysis (Data Hierarchy and Conflict Resolution):',
      '- Cross-reference all five sources to find critical missing pieces or discrepancies.',
      '- Treat the document-upload findings (documentFindings) as the ULTIMATE source of truth.',
      '- Before drafting, check the risk items and call questions against documentFindings. If a previously flagged item or question (for example missing square footage, bed and bath count, or property condition) is now answered by an uploaded document (for example an appraisal or scope of work), consider that item RESOLVED and NEVER ask the borrower about it.',
      '- Formulate questions ONLY for fatal flaws, outstanding discrepancies, or genuinely missing data that actually prevents structuring the loan.',
      'Email rules:',
      '- MAXIMUM of 4 questions, written as a simple bulleted list (use a hyphen for each bullet).',
      '- NEVER ask for anything that already appears in any of the five sources.',
      '- NEVER ask open-ended or generic questions (do not ask "what is your strategy?" or "can you confirm the property address?").',
      '- Tone: direct, professional, conversational -- like a busy loan originator typing a quick email. Skip pleasantries; do NOT write "I hope this finds you well." Start straight with the purpose.',
      '- Write the ENTIRE email in the FIRST PERSON as the sender. Do NOT add a signature or sign-off name (a signature is added later). Do NOT put any personal name (such as Daniel or Joe) or our company name in the body. Do NOT mention any lender by name. Plain text only.',
      'If, after cross-referencing, there are NO fatal gaps or unresolved discrepancies, do NOT invent questions -- instead return a one or two line body saying everything you need appears to be in hand and you will follow up with terms shortly.',
      'Return ONLY JSON: {"subject":"...","body":"..."} with no markdown and no commentary. The body must start with the greeting "' + greet + '" followed by a brief purpose line (for example: "I am putting together the terms for your deal based on our call and the documents you uploaded, but I need to clarify a few quick items first:") and then the bulleted questions.'
    ].join('\n');

    var ctxObj = {};
    try { ctxObj = JSON.parse(contextJson || '{}'); } catch (eP) { ctxObj = {}; }
    var userText = JSON.stringify({
      borrowerName: name || '',
      propertyAddress: addr || '',
      introAngle: introAngle,
      context: ctxObj,
      draftQuestions: questions
    });

    var payload = JSON.stringify({
      system_instruction: { parts: [{ text: sysText }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.55, maxOutputTokens: 4096 }
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
      if (!p) return { bad: true };
      var body = String(p.body || '').trim();
      if (!body) return { bad: true };
      return { ok: true, subject: String(p.subject || '').trim(), body: body };
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

/* One-click editor test — merge a messy, duplicated set through the real pipeline. */
function pipeline_testBorrowerQuestionEmail() {
  var qs = [
    'What is the current payoff on any existing loan, and what will the cash-out proceeds be used for?',
    'If there is cash out, what will the proceeds be used for?',
    'Can you confirm the beds, baths, square footage, and overall condition?',
    'Most recent mortgage payoff statement',
    'How many acres is the property, and what is the zoning / permitted use?',
    'Is a current, completed appraisal report available?'
  ];
  var res = pipeline_buildBorrowerQuestionEmail('Jason Glass', 'jason@example.com', '123 Main St, Austin TX', JSON.stringify(qs));
  Logger.log('Q-EMAIL TEST ->\n' + JSON.stringify(res, null, 2));
}