/***** ASAP PIPELINE — MODULE 4: BORROWER BRIDGE + WRITE-BACK **************
 * Paste as a NEW script file ("Pipeline_M4.gs") in the SAME project as
 * M1/M2/M3 and your loan-app Code.gs. Depends on:
 *   • M1: ASAP_CFG, ss_(), DEAL_HEADERS, Pipeline_Deals tab
 *   • M2: screenDeal(), matchLenders()  (used only to refresh the eyeball Status)
 *   • Code.gs: LOGO_EMAIL_B64, NOTIFY_CC, applyOnlineHtml(), applyOnlinePlain(),
 *              applyOnlineImages(), getWebAppUrl(), loadDraft()  (all reused)
 *
 * WHAT IT DOES
 *   1. Pipeline_inviteBorrowerByDeal(dealId)  ← the dashboard calls this
 *        - reads the deal row, maps WorkingMoni → your loan-app field names,
 *        - mints a save-&-resume draft (same store your app already uses),
 *          tagging the DealID INSIDE the draft (rec.pipelineDealId),
 *        - creates a DRAFT-ONLY Gmail invite (never auto-sends), reusing your
 *          logo, apply-online cards, signature, and disclaimer.
 *   2. Pipeline_writeBackFromApp(dealId, data, snap)  ← fired on borrower submit
 *        - writes the borrower-confirmed values back onto the SAME deal row,
 *        - records the authoritative gradeDeal() letter in Grade,
 *        - flips ValueSource → "borrower" and Provenance → "borrower-confirmed",
 *        - refreshes the screener Status line.
 *
 * Field mapping status (all match your form exactly):
 *   loanPurpose, loanAmount, marketValue, monthlyRent, propertyAddress, email,
 *   firstName, occupancy, creditBand, propertyType.
 *
 * ONE SMALL EDIT TO Code.gs (already done) wires #2 in: the line added right
 * after `var snap = gradeDeal(data);` inside submitApplication.
 ****************************************************************************/

var INVITE_TEST_ROW = 2;   // sheet row in Pipeline_Deals to test with Pipeline_testInvite

/* =========================================================================
 * DASHBOARD ENTRY POINT  — tap a deal → invite the borrower (draft-only)
 * ========================================================================= */
function Pipeline_inviteBorrowerByDeal(dealId) {
  try {
    if (!dealId) return { ok: false, error: 'Missing deal id.' };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID');
    var d = null;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) {
        d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i];
        break;
      }
    }
    if (!d) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var pf = Pipeline_mapDealToApp_(d);
    if (!pf.email) return { ok: false, error: 'No borrower email on this deal — add it in the card\u2019s checklist first.' };
    return Pipeline_inviteBorrower(pf);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* mint a pre-filled draft + create the draft-only Gmail invite */
function Pipeline_inviteBorrower(prefill) {
  prefill = prefill || {};
  var email = String(prefill.email || '').trim();
  if (!email) return { ok: false, error: 'No borrower email.' };
  var dealId = String(prefill.dealId || '').trim();

  var data = Pipeline_prefillData_(prefill);   // only the fields your loan app understands

  // Mint + store the draft EXACTLY like saveDraft does — but WITHOUT auto-emailing,
  // and tag the pipeline DealID so submit can write back to the right row.
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var rec = { data: data, step: 1, savedAt: new Date().toISOString(), savedDocs: {}, pipelineDealId: dealId };
  PropertiesService.getScriptProperties().setProperty('DRAFT_' + token, JSON.stringify(rec));

  var url = getWebAppUrl() + '?resume=' + token;
  var draft = Pipeline_createInviteDraft_(email, url, data);   // GmailApp.createDraft (draft-only)
  return { ok: true, token: token, draftId: draft.getId(), flag: prefill._flag || '' };
}

/* Build the invite email content — a reworded clone of sendResumeLink, reusing
 * your logo / apply-online cards / signature / disclaimer. No sending here. */
/* Daniel's headshot for his email signature (180px JPEG, inline cid:danielphoto) */
var DK_PHOTO_B64 = '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';

function Pipeline_buildInviteEmail_(url, d, sigHtml, plainSig) {
  var name = (d && d.firstName) ? (' ' + d.firstName) : '';
  var prog = Pipeline_friendlyProgram_(d ? d.loanPurpose : '');
  var subject = 'I\u2019ve started your ASAP Funding ' + prog + ' application';
  var introHtml  = 'I\u2019ve started your ' + prog + ' application with the details we already have. Pick up where I left off and finish the last few items:';
  var introPlain = 'I\u2019ve started your ' + prog + ' application with the details we already have. Pick up where I left off and finish the last few items using your private link below:';
  var disc = 'Sender is not a United States Securities Dealer or Registered Investment Adviser. Sender does not provide the purchase and sale of Registered Securities of any kind. This E-mail letter and the attached related documents are never to be considered a solicitation for any purpose in any form or content. If you are not the intended recipient of this E-mail, you are hereby notified that any dissemination, distribution, copying, or action taken in relation to the contents of and attachments to this E-mail is strictly prohibited and may be unlawful. If you have received this E-mail in error, please notify the sender immediately and permanently delete the original and any copy of this E-mail and any printout.';

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2230;font-size:14px;line-height:1.5;max-width:680px;">' +
      '<p style="margin:0 0 12px;">Hi' + name + ',</p>' +
      '<p style="margin:0 0 14px;">' + introHtml + '</p>' +
      '<p style="margin:0 0 14px;"><a href="' + url + '" style="display:inline-block;background:#01A6CF;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;">Finish my application</a></p>' +
      '<p style="margin:0 0 28px;font-size:12px;color:#667;">Or paste this link into your browser:<br><a href="' + url + '" style="color:#1155cc;word-break:break-all;">' + url + '</a></p>' +
      sigHtml +
      '<p style="margin:18px 0;"><img src="cid:asaplogo" alt="ASAP Funding - Simply Better Lending" width="270" style="width:270px;height:auto;display:block;border:0;"></p>' +
      applyOnlineHtml() +
      '<p style="font-family:Georgia,\'Times New Roman\',serif;font-size:11px;color:#444;line-height:1.45;text-align:justify;margin:0;"><strong>DISCLAIMER:</strong> ' + disc + '</p>' +
    '</div>';

  var plain = ['Hi' + name + ',', '', introPlain, '', url, '',
    plainSig, applyOnlinePlain(), '',
    'DISCLAIMER: ' + disc].join('\n');

  var logo = Utilities.newBlob(Utilities.base64Decode(LOGO_EMAIL_B64), 'image/png', 'asap-logo.png');
  var images = applyOnlineImages(); images.asaplogo = logo;   // cardhm + cardhome + asaplogo
  images.danielphoto = Utilities.newBlob(Utilities.base64Decode(DK_PHOTO_B64), 'image/jpeg', 'dk.jpg');
  return { subject: subject, html: html, plain: plain, images: images };
}

/* per-sender signature block + reply-to + from display name.
 * Same logo/cards/disclaimer everywhere; only name/title/contact change.
 * (Addresses aren't Gmail aliases, so mail still sends from the dashboard
 *  account; reply-to routes replies to the chosen person.) */
function Pipeline_senderSig_(sender) {
  function line(lbl, val){ return '<p style="margin:2px 0 0;color:#0A5277;"><strong>' + lbl + ':</strong> <span style="color:#2C6A8A;">' + val + '</span></p>'; }
  var web = '<p style="margin:2px 0 0;color:#0A5277;"><strong>W:</strong> <a href="https://asap-funding.com" style="color:#2C6A8A;text-decoration:none;">ASAP-Funding.com</a></p>';
  var name, title, lines, plain, replyTo, fromName;
  if (sender === 'joe') {
    name = 'Joe Paliwala'; title = 'Client Services';
    lines = line('C','510-777-6353') + line('O','844-320-2727') + line('F','510-777-6355') + web;
    plain = ['Joe Paliwala','Client Services','C: 510-777-6353','O: 844-320-2727','F: 510-777-6355','W: ASAP-Funding.com'];
    replyTo = 'Support@ASAP-Funding.com'; fromName = 'Joe Paliwala — ASAP Funding';
  } else if (sender === 'daniel') {
    name = 'Daniel Kim'; title = 'Director';
    lines = line('C','510-399-2727') + line('O','844-320-2828') + line('F','510-777-6355') + web + line('DRE','02090117');
    plain = ['Daniel Kim','Director','C: 510-399-2727','O: 844-320-2828','F: 510-777-6355','W: ASAP-Funding.com','DRE: 02090117'];
    replyTo = 'Daniel@ASAP-Funding.com'; fromName = 'Daniel Kim — ASAP Funding';
  } else {   // marketing / team default
    name = 'THE ASAP Funding Team'; title = '';
    lines = line('O','844-320-2828') + line('F','510-981-2002') + web;
    plain = ['THE ASAP Funding Team','O: 844-320-2828','F: 510-981-2002','W: ASAP-Funding.com'];
    replyTo = 'info@ASAP-Funding.com'; fromName = 'ASAP Funding';
  }
  var core = '<p style="margin:0 0 2px;font-weight:bold;color:#0A5277;">' + name + '</p>' +
             (title ? '<p style="margin:0 0 2px;color:#0A5277;">' + title + '</p>' : '') + lines;
  var html = (sender === 'daniel')
    ? '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>' +
        '<td style="vertical-align:top;padding-right:14px;"><img src="cid:danielphoto" alt="Daniel Kim" width="72" height="72" style="width:72px;height:72px;border-radius:50%;display:block;border:0;"></td>' +
        '<td style="vertical-align:top;">' + core + '</td>' +
      '</tr></table>'
    : core;
  return { html: html, plain: plain.join('\n'), replyTo: replyTo, fromName: fromName };
}

/* the prefill data object your loan app understands */
function Pipeline_prefillData_(pf) {
  pf = pf || {};
  return {
    firstName:       pf.firstName || '',
    email:           String(pf.email || '').trim(),
    loanPurpose:     pf.loanPurpose || '',          // MUST equal a DEAL_TYPES id
    propertyType:    pf.propertyType || '',
    propertyAddress: pf.propertyAddress || '',
    loanAmount:      pf.loanAmount || '',
    marketValue:     pf.marketValue || '',
    occupancy:       pf.occupancy || '',
    monthlyRent:     pf.monthlyRent || '',
    creditBand:      pf.creditBand || ''
  };
}

/* create a draft-only Gmail invite (used by the test runner) */
function Pipeline_createInviteDraft_(email, url, d) {
  var sig = Pipeline_senderSig_('marketing');
  var em = Pipeline_buildInviteEmail_(url, d, sig.html, sig.plain);
  return GmailApp.createDraft(email, em.subject, em.plain, { cc: NOTIFY_CC, htmlBody: em.html, inlineImages: em.images, replyTo: sig.replyTo, name: sig.fromName });
}

/* swap cid: image refs for inline data: URIs so the email renders in a browser preview */
function Pipeline_inviteToPreview_(html) {
  return String(html)
    .replace(/cid:asaplogo/g, 'data:image/png;base64,' + LOGO_EMAIL_B64)
    .replace(/cid:cardhm/g,   'data:image/png;base64,' + CARD_HM_B64)
    .replace(/cid:cardhome/g, 'data:image/png;base64,' + CARD_HOME_B64)
    .replace(/cid:danielphoto/g, 'data:image/jpeg;base64,' + DK_PHOTO_B64);
}

/* DASHBOARD: build a preview. Mints the resume token + stores the draft record
 * (so the link is live), and returns the rendered email for the modal. */
function Pipeline_buildInvite(dealId) {
  try {
    if (!dealId) return { ok: false, error: 'Missing deal id.' };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID'), d = null;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) { d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i]; break; }
    }
    if (!d) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var pf = Pipeline_mapDealToApp_(d);
    if (!pf.email) return { ok: false, error: 'No borrower email on this deal — add it in the card\u2019s checklist first.' };
    var data = Pipeline_prefillData_(pf);
    var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var rec = { data: data, step: 1, savedAt: new Date().toISOString(), savedDocs: {}, pipelineDealId: String(pf.dealId || '') };
    PropertiesService.getScriptProperties().setProperty('DRAFT_' + token, JSON.stringify(rec));
    var url = getWebAppUrl() + '?resume=' + token;
    var em = Pipeline_buildInviteEmail_(url, data, '__SIGHTML__', '__SIGPLAIN__');
    var previewBase = Pipeline_inviteToPreview_(em.html);
    var sigs = {
      marketing: Pipeline_inviteToPreview_(Pipeline_senderSig_('marketing').html),
      joe:       Pipeline_inviteToPreview_(Pipeline_senderSig_('joe').html),
      daniel:    Pipeline_inviteToPreview_(Pipeline_senderSig_('daniel').html)
    };
    return { ok: true, token: token, email: pf.email, subject: em.subject,
             previewBase: previewBase, sigs: sigs, sender: 'daniel', flag: pf._flag || '' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* DASHBOARD: commit the previewed invite — mode 'draft' (Gmail draft) or 'send'. */
function Pipeline_commitInvite(token, mode, sender) {
  try {
    if (!token) return { ok: false, error: 'Missing token.' };
    var rec = loadDraft(token);
    if (!rec || !rec.data || !rec.data.email) return { ok: false, error: 'Invite expired — reopen it from the card.' };
    var data = rec.data;
    try { if (rec.pipelineDealId) Pipeline_setInviteToken_(rec.pipelineDealId, token); } catch (e) {}
    var url = getWebAppUrl() + '?resume=' + token;
    var sig = Pipeline_senderSig_(sender || 'daniel');
    var em = Pipeline_buildInviteEmail_(url, data, sig.html, sig.plain);
    if ((sender || 'daniel') !== 'daniel' && em.images) delete em.images.danielphoto;
    var opts = { cc: NOTIFY_CC, htmlBody: em.html, inlineImages: em.images, replyTo: sig.replyTo, name: sig.fromName };
    if (mode === 'send') {
      GmailApp.sendEmail(data.email, em.subject, em.plain, opts);
      var invOn = '';
      try { invOn = Pipeline_stampDealDate_(rec.pipelineDealId, 'InvitedOn'); } catch (e) {}
      return { ok: true, mode: 'send', email: data.email, sender: sig.fromName, invitedOn: invOn };
    }
    var dr = GmailApp.createDraft(data.email, em.subject, em.plain, opts);
    return { ok: true, mode: 'draft', draftId: dr.getId(), email: data.email, sender: sig.fromName };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* =========================================================================
 * WRITE-BACK  — borrower submitted → update the SAME deal row + re-grade
 * Called from Code.gs submitApplication via one added line.
 * ========================================================================= */
function Pipeline_writeBackFromApp(pipelineDealId, data, snap) {
  if (!pipelineDealId) return;
  data = data || {};
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  if (!sh) return;
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cId = H.indexOf('DealID');
  if (cId < 0) return;

  var rowIdx = -1;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][cId]) === String(pipelineDealId)) { rowIdx = r; break; }
  }
  if (rowIdx < 0) return;   // deal not found — nothing to write back

  function setIf(header, value) {          // only overwrite when the borrower gave a value
    var c = H.indexOf(header);
    if (c < 0) return;
    if (value === undefined || value === null || String(value).trim() === '') return;
    sh.getRange(rowIdx + 1, c + 1).setValue(value);
    vals[rowIdx][c] = value;
  }
  function setForce(header, value) {       // always set (provenance / grade / status)
    var c = H.indexOf(header);
    if (c < 0) return;
    sh.getRange(rowIdx + 1, c + 1).setValue(value);
    vals[rowIdx][c] = value;
  }

  // borrower-confirmed values → deal row
  setIf('LoanAmount',  data.loanAmount);
  setIf('MarketValue', data.marketValue);
  setIf('MonthlyRent', data.monthlyRent);
  setIf('Occupancy',   data.occupancy);
  setIf('PropertyType',data.propertyType);
  setIf('FICO',        data.creditBand);
  setIf('LoanPurpose', data.loanPurpose);
  setIf('BorrowerEmail', data.email);
  var bn = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
  if (bn) setForce('BorrowerName', bn);
  if (data.propertyAddress) setForce('AssembledAddress', String(data.propertyAddress));

  // provenance flips
  setForce('ValueSource', 'borrower');
  setForce('Provenance',  'borrower-confirmed');

  // authoritative grade from your gradeDeal()
  if (snap && snap.grade) setForce('Grade', snap.grade);

  // refresh the eyeball Status by re-screening the now-confirmed row
  try {
    var d = {};
    for (var i = 0; i < H.length; i++) d[H[i]] = vals[rowIdx][i];
    var sr = screenDeal(d), summary;
    if (sr.decision === 'FAIL') {
      summary = 'FAIL — ' + (sr.knockouts && sr.knockouts[0] ? sr.knockouts[0] : 'knockout');
    } else {
      var mm = matchLendersLTV_(d, sr);
      var top = mm.matches.slice(0, 3).map(function (m) { return m.lender; }).join(', ');
      summary = sr.decision + (sr.priority ? ' \u2605' : '') + ' (' + mm.matches.length + ')' + (top ? ' — ' + top : '');
    }
    setForce('Status', '\u2713 ' + summary + ' \u00b7 borrower-confirmed' + (snap && snap.grade ? ' \u00b7 Grade ' + snap.grade : ''));
  } catch (e) {
    setForce('Status', 'borrower-confirmed' + (snap && snap.grade ? ' \u00b7 Grade ' + snap.grade : ''));
  }
}

/* =========================================================================
 * CALL SHEET  — capture answers on a live call → write back + re-screen.
 * Called by the dashboard "Key metrics & call sheet" panel. Only the three
 * screener-relevant answers (occupancy, rent, FICO) are written.
 * ========================================================================= */
function pipeline_saveCallSheet(dealId, answers) {
  try {
    answers = answers || {};
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID');
    var rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };

    function set(header, v) {
      var c = H.indexOf(header);
      if (c < 0 || v == null || String(v).trim() === '') return;
      sh.getRange(rowIdx + 1, c + 1).setValue(v); vals[rowIdx][c] = v;
    }
    set('Occupancy',   answers.occupancy);
    set('MonthlyRent', Pipeline_numStr_(answers.monthlyRent));
    set('FICO',        answers.fico);

    // re-screen the now-updated row
    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[rowIdx][i];
    var sr = screenDeal(d), mm = matchLendersLTV_(d, sr);
    var top = (mm.matches || []).slice(0, 3).map(function (m) { return m.lender; }).join(', ');
    var summary = (sr.decision === 'FAIL')
      ? ('FAIL — ' + (sr.knockouts && sr.knockouts[0] ? sr.knockouts[0] : 'knockout'))
      : (sr.decision + (sr.priority ? ' \u2605' : '') + ' (' + mm.matches.length + ')' + (top ? ' — ' + top : ''));
    var cStatus = H.indexOf('Status'); if (cStatus >= 0) sh.getRange(rowIdx + 1, cStatus + 1).setValue('\u2713 ' + summary + ' \u00b7 call-confirmed');

    // keep the borrower's live invite in sync with these call answers
    try { Pipeline_resyncDraftPatch_(dealId, { occupancy: Pipeline_mapOccupancy_(answers.occupancy), monthlyRent: Pipeline_numStr_(answers.monthlyRent), creditBand: Pipeline_mapFico_(answers.fico) }); } catch (e) {}

    var deal = null;
    try { deal = compactDeal_(d, sr, mm, rowIdx + 1); } catch (e) { deal = null; }   // refreshed card for the dashboard
    return { ok: true, decision: sr.decision, deal: deal };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Stamp the active invite token onto a deal row (so edits know which link to refresh). */
function Pipeline_setInviteToken_(dealId, token) {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return;
  pipeline_ensureColumns_();
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cId = H.indexOf('DealID'), cTok = H.indexOf('InviteToken'); if (cId < 0 || cTok < 0) return;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][cId]) === String(dealId)) { sh.getRange(r + 1, cTok + 1).setValue(token); return; }
  }
}

/* Merge changed deal facts into the borrower's saved invite (DRAFT_<token>),
 * touching ONLY the keys that changed so in-progress borrower entries survive. */
function Pipeline_resyncDraftPatch_(dealId, patch) {
  try {
    if (!patch) return false;
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return false;
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cTok = H.indexOf('InviteToken'); if (cTok < 0) return false;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) !== String(dealId)) continue;
      var token = String(vals[r][cTok] || '').trim(); if (!token) return false;
      var raw = PropertiesService.getScriptProperties().getProperty('DRAFT_' + token); if (!raw) return false;
      var rec; try { rec = JSON.parse(raw); } catch (e) { return false; }
      rec.data = rec.data || {};
      Object.keys(patch).forEach(function (k) { var v = patch[k]; if (v !== undefined && v !== null && String(v).trim() !== '') rec.data[k] = v; });
      rec.resyncedAt = new Date().toISOString();
      PropertiesService.getScriptProperties().setProperty('DRAFT_' + token, JSON.stringify(rec));
      return true;
    }
    return false;
  } catch (e) { return false; }
}

/* Read the editable deal facts for the dashboard "Edit details" form. */
function pipeline_getDealFields(dealId) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID');
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) {
        var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i];
        return { ok: true, fields: {
          loanType:        Pipeline_mapLoanPurpose_(d).purpose,
          loanAmount:      Pipeline_numStr_(d.LoanAmount),
          marketValue:     Pipeline_numStr_(d.MarketValue),
          propertyType:    Pipeline_mapPropertyType_(d.PropertyType),
          propertyAddress: String(d.AssembledAddress || ''),
          borrowerName:    String(d.BorrowerName || ''),
          borrowerEmail:   String(d.BorrowerEmail || '')
        } };
      }
    }
    return { ok: false, error: 'Deal ' + dealId + ' not found.' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Save manual edits to a deal's facts, re-screen, and resync the live invite. */
function pipeline_saveDealEdits(dealId, fields) {
  try {
    fields = fields || {};
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID');
    var rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    function set(header, v) { var c = H.indexOf(header); if (c < 0 || v == null || String(v).trim() === '') return; sh.getRange(rowIdx + 1, c + 1).setValue(v); vals[rowIdx][c] = v; }

    var patch = {};
    if (fields.loanType != null && String(fields.loanType).trim() !== '') {
      set('LoanType', fields.loanType); set('LoanPurpose', fields.loanType);   // canonical to both -> screens + prefills consistently
      patch.loanPurpose = fields.loanType;
    }
    if (fields.loanAmount != null && String(fields.loanAmount).trim() !== '') { var la = Pipeline_numStr_(fields.loanAmount); set('LoanAmount', la); patch.loanAmount = la; }
    if (fields.marketValue != null && String(fields.marketValue).trim() !== '') { var mv = Pipeline_numStr_(fields.marketValue); set('MarketValue', mv); patch.marketValue = mv; }
    if (fields.propertyType != null && String(fields.propertyType).trim() !== '') { set('PropertyType', fields.propertyType); patch.propertyType = Pipeline_mapPropertyType_(fields.propertyType); }
    if (fields.propertyAddress != null && String(fields.propertyAddress).trim() !== '') { set('AssembledAddress', fields.propertyAddress); patch.propertyAddress = String(fields.propertyAddress); }
    if (fields.borrowerName != null && String(fields.borrowerName).trim() !== '') { set('BorrowerName', fields.borrowerName); patch.firstName = Pipeline_firstName_(fields.borrowerName); }
    if (fields.borrowerEmail != null && String(fields.borrowerEmail).trim() !== '') { set('BorrowerEmail', String(fields.borrowerEmail).trim()); patch.email = String(fields.borrowerEmail).trim(); }

    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[rowIdx][i];
    var sr = screenDeal(d), mm = matchLendersLTV_(d, sr);
    var top = (mm.matches || []).slice(0, 3).map(function (m) { return m.lender; }).join(', ');
    var summary = (sr.decision === 'FAIL') ? ('FAIL — ' + (sr.knockouts && sr.knockouts[0] ? sr.knockouts[0] : 'knockout'))
      : (sr.decision + (sr.priority ? ' ★' : '') + ' (' + mm.matches.length + ')' + (top ? ' — ' + top : ''));
    var cStatus = H.indexOf('Status'); if (cStatus >= 0) sh.getRange(rowIdx + 1, cStatus + 1).setValue('✓ ' + summary + ' · edited');

    try { Pipeline_resyncDraftPatch_(dealId, patch); } catch (e) {}

    var deal = null; try { deal = compactDeal_(d, sr, mm, rowIdx + 1); } catch (e) { deal = null; }
    return { ok: true, decision: sr.decision, deal: deal };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* =========================================================================
 * RENTCAST  — market rent (AVM), property facts + as-is value (AVM), and a
 * monthly request tally so we stay under the free 50-calls/month cap.
 * Free key stored in Script Properties as RENTCAST_KEY (rentcast.io).
 * ========================================================================= */

function _pl_rcMonth_() { return Utilities.formatDate(new Date(), _pl_tz_(), 'yyyy-MM'); }

/* Read this month's running tally (does NOT make an API call). */
function pipeline_rentcastUsage() {
  var p = PropertiesService.getScriptProperties(), cur = _pl_rcMonth_();
  var c = (p.getProperty('RENTCAST_MONTH') === cur) ? (parseInt(p.getProperty('RENTCAST_COUNT') || '0', 10) || 0) : 0;
  return { count: c, limit: 50, month: cur };
}
/* Add 1 to this month's tally (auto-resets on a new month). Returns the new count. */
function _pl_rcBump_() {
  var p = PropertiesService.getScriptProperties(), cur = _pl_rcMonth_();
  var c = (p.getProperty('RENTCAST_MONTH') === cur) ? (parseInt(p.getProperty('RENTCAST_COUNT') || '0', 10) || 0) : 0;
  c++;
  p.setProperty('RENTCAST_MONTH', cur);
  p.setProperty('RENTCAST_COUNT', String(c));
  return c;
}
/* If the RentCast dashboard and this tally ever drift apart, zero it here. */
function pipeline_rentcastResetCount() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('RENTCAST_MONTH', _pl_rcMonth_()); p.setProperty('RENTCAST_COUNT', '0');
  Logger.log('RentCast tally reset to 0 for ' + _pl_rcMonth_());
}

/* Market-rent estimate. Returns {ok, rent, low, high, used, limit}. */
function pipeline_estimateRent(address) {
  try {
    address = String(address || '').trim();
    if (!address) return { ok: false, error: 'no_address' };
    var key = PropertiesService.getScriptProperties().getProperty('RENTCAST_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var url = 'https://api.rentcast.io/v1/avm/rent/long-term?address=' + encodeURIComponent(address);
    var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { 'X-Api-Key': key, 'Accept': 'application/json' } });
    var used = _pl_rcBump_();
    var code = resp.getResponseCode();
    if (code !== 200) return { ok: false, error: 'api_' + code, used: used, limit: 50 };
    var data = JSON.parse(resp.getContentText() || '{}');
    var rent = (data && data.rent != null) ? data.rent : null;
    if (rent == null) return { ok: false, error: 'no_estimate', used: used, limit: 50 };
    return { ok: true, rent: Math.round(rent),
             low:  (data.rentRangeLow  != null) ? Math.round(data.rentRangeLow)  : null,
             high: (data.rentRangeHigh != null) ? Math.round(data.rentRangeHigh) : null,
             used: used, limit: 50 };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Property facts + as-is value. Calls /avm/value (value + attributes when on file);
 * if structural attributes are missing, falls back to /properties (the public record).
 * Returns {ok, beds, baths, sqft, yearBuilt, lotSize, propertyType, value, low, high,
 *          lastSalePrice, lastSaleDate, recordFound, used, limit}. */
function pipeline_lookupProperty(address) {
  try {
    address = String(address || '').trim();
    if (!address) return { ok: false, error: 'no_address' };
    var key = PropertiesService.getScriptProperties().getProperty('RENTCAST_KEY');
    if (!key) return { ok: false, error: 'no_key' };
    var enc = encodeURIComponent(address);
    var hdr = { method: 'get', muteHttpExceptions: true, headers: { 'X-Api-Key': key, 'Accept': 'application/json' } };
    var n = function (v) { return (v != null && v !== '') ? v : null; };
    var out = { ok: true, beds: null, baths: null, sqft: null, yearBuilt: null, lotSize: null,
                propertyType: null, value: null, low: null, high: null,
                lastSalePrice: null, lastSaleDate: null, recordFound: false, used: 0, limit: 50 };

    /* 1) AVM value (also returns subjectProperty attributes when RentCast has them) */
    var vResp = UrlFetchApp.fetch('https://api.rentcast.io/v1/avm/value?address=' + enc, hdr);
    out.used = _pl_rcBump_();
    if (vResp.getResponseCode() === 200) {
      var v = JSON.parse(vResp.getContentText() || '{}');
      out.value = (v.price != null) ? Math.round(v.price) : null;
      out.low   = (v.priceRangeLow  != null) ? Math.round(v.priceRangeLow)  : null;
      out.high  = (v.priceRangeHigh != null) ? Math.round(v.priceRangeHigh) : null;
      var sp = v.subjectProperty || {};
      out.beds = n(sp.bedrooms); out.baths = n(sp.bathrooms); out.sqft = n(sp.squareFootage);
      out.yearBuilt = n(sp.yearBuilt); out.lotSize = n(sp.lotSize); out.propertyType = n(sp.propertyType);
      if (out.beds != null || out.baths != null || out.sqft != null) out.recordFound = true;
    } else {
      out.valueError = 'api_' + vResp.getResponseCode();
    }

    /* 2) If beds/baths/sqft are still blank, pull the public property record */
    if (out.beds == null && out.baths == null && out.sqft == null) {
      var pResp = UrlFetchApp.fetch('https://api.rentcast.io/v1/properties?address=' + enc + '&limit=1', hdr);
      out.used = _pl_rcBump_();
      if (pResp.getResponseCode() === 200) {
        var arr = JSON.parse(pResp.getContentText() || '[]');
        var rec = (arr && arr.length) ? arr[0] : null;
        if (rec) {
          out.recordFound = true;
          if (n(rec.bedrooms)      != null) out.beds = rec.bedrooms;
          if (n(rec.bathrooms)     != null) out.baths = rec.bathrooms;
          if (n(rec.squareFootage) != null) out.sqft = rec.squareFootage;
          if (n(rec.yearBuilt)     != null) out.yearBuilt = rec.yearBuilt;
          if (n(rec.lotSize)       != null) out.lotSize = rec.lotSize;
          if (n(rec.propertyType)  != null) out.propertyType = rec.propertyType;
          if (rec.lastSalePrice != null) out.lastSalePrice = Math.round(rec.lastSalePrice);
          if (rec.lastSaleDate) out.lastSaleDate = String(rec.lastSaleDate).slice(0, 10);
        }
      }
    }

    if (out.value == null && out.beds == null && out.baths == null && out.sqft == null) {
      return { ok: false, error: 'no_record', used: out.used, limit: 50 };
    }
    return out;
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Save the looked-up property facts/value onto the deal (one JSON column). */
function pipeline_savePropData(dealId, data) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('PropData') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('PropData').setFontWeight('bold'); H.push('PropData'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    sh.getRange(rowIdx + 1, H.indexOf('PropData') + 1).setValue(data ? JSON.stringify(data) : '');
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Auto-save a RentCast market-rent figure to the deal (no re-screen needed). */
function pipeline_saveMarketRent(dealId, rent) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('MarketRent') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('MarketRent').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var clean = Pipeline_numStr_(rent);
    sh.getRange(rowIdx + 1, H.indexOf('MarketRent') + 1).setValue(clean === '' ? '' : Number(clean));
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Auto-save the in-progress call sheet (occupancy/rent/FICO/flip inputs/notes)
   as one JSON blob so nothing is lost on refresh. No re-screen. */
function pipeline_saveCallState(dealId, state) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('CallState') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('CallState').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    sh.getRange(rowIdx + 1, H.indexOf('CallState') + 1).setValue(state == null ? '' : String(state));
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Save the appraised value, then re-screen the deal off it (appraised first,
   listing value as fallback) and return the refreshed card. */
function pipeline_saveAppraised(dealId, value) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('AppraisedValue') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('AppraisedValue').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var clean = Pipeline_numStr_(value);
    var cAppr = H.indexOf('AppraisedValue');
    sh.getRange(rowIdx + 1, cAppr + 1).setValue(clean === '' ? '' : Number(clean));
    vals[rowIdx][cAppr] = (clean === '' ? '' : Number(clean));

    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[rowIdx][i];
    var sr = screenDeal(d), mm = matchLendersLTV_(d, sr);
    var top = (mm.matches || []).slice(0, 3).map(function (m) { return m.lender; }).join(', ');
    var summary = (sr.decision === 'FAIL')
      ? ('FAIL \u2014 ' + (sr.knockouts && sr.knockouts[0] ? sr.knockouts[0] : 'knockout'))
      : (sr.decision + (sr.priority ? ' \u2605' : '') + ' (' + mm.matches.length + ')' + (top ? ' \u2014 ' + top : ''));
    var cStatus = H.indexOf('Status'); if (cStatus >= 0) sh.getRange(rowIdx + 1, cStatus + 1).setValue('\u2713 ' + summary);
    var deal = null;
    try { deal = compactDeal_(d, sr, mm, rowIdx + 1); } catch (e) { deal = null; }
    if (deal) deal.appraised = (clean === '' ? '' : String(Number(clean)));
    return { ok: true, decision: sr.decision, deal: deal };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* =========================================================================
 * FICO-TIERED LTV GATE (opt-in, additive)
 * Reads each lender's new "Max LTV by FICO" cell (e.g. "80@700, 75@640" =
 * 80% for 700+ FICO, 75% for 640+). When that cell is filled AND the deal's
 * LTV is known, a matched lender whose cap the deal exceeds is moved into the
 * near-miss list with a clear reason. Lenders with a blank cell are untouched
 * — matching for them behaves exactly as before.
 * ========================================================================= */
function lenderMaxLTVByFico_(text, fico) {
  var byF = String(text == null ? '' : text).trim();
  if (!byF) return null;
  var pairs = byF.split(/[,;]+/).map(function (s) {
    var m = String(s).match(/([0-9.]+)\s*@\s*([0-9]+)/);   // ltv @ fico-floor
    return m ? { ltv: parseFloat(m[1]), fico: parseInt(m[2], 10) } : null;
  }).filter(function (x) { return x && !isNaN(x.ltv) && !isNaN(x.fico); })
    .sort(function (a, b) { return b.fico - a.fico; });     // highest FICO floor first
  if (!pairs.length) {                                       // no "ltv@fico" pairs -> accept a bare number as a flat cap
    var flat = parseFloat(byF.replace(/[^0-9.]/g, ''));
    return (!isNaN(flat) && flat > 0 && flat <= 100) ? flat : null;
  }
  if (!fico) return pairs[0].ltv;                           // unknown FICO -> top (most lenient) tier
  for (var i = 0; i < pairs.length; i++) { if (fico >= pairs[i].fico) return pairs[i].ltv; }
  return pairs[pairs.length - 1].ltv;                       // below lowest tier -> lowest cap (MinFICO gate handles eligibility)
}
/* name(lower) -> MaxLTVByFICO text, from the clean Pipeline_Lenders tab.
   Build once and pass into loops to avoid re-reading the sheet per deal. */
function _pl_ltvCapMap_() {
  var rows = tableObjects_(ASAP_CFG.LENDERS_TAB) || [];
  var m = {};
  rows.forEach(function (L) { m[String(L.Lender || '').trim().toLowerCase()] = L.MaxLTVByFICO; });
  return m;
}
/* matchLenders() + the opt-in FICO-tiered LTV gate. Returns the usual
   { matches, nearMisses } plus { demoted } = lenders the gate moved out. */
function matchLendersLTV_(d, sr, capMap) {
  var mm = matchLenders(d, sr) || {};
  if (!mm.matches) mm.matches = [];
  if (!mm.nearMisses) mm.nearMisses = [];
  mm.demoted = [];
  var ltv = sr && sr.ltv;
  if (!ltv || !mm.matches.length) return mm;
  var fico = (sr && sr.fico) || '';
  var caps = capMap || _pl_ltvCapMap_();
  var keep = [];
  mm.matches.forEach(function (m) {
    var nm = String((m && (m.lender || m.name || m.n)) || '').trim().toLowerCase();
    var capF = lenderMaxLTVByFico_(caps[nm], fico);
    if (capF != null && (ltv * 100) > capF + 0.5) {
      var lbl = (m.lender || m.name || m.n);
      var why = 'LTV ' + pct_(ltv) + ' over their ' + capF + '% cap' + (fico ? ' at ' + fico + ' FICO' : '');
      mm.demoted.push({ lender: lbl, name: lbl, reason: why, why: why });
    } else { keep.push(m); }
  });
  mm.matches = keep;
  mm.nearMisses = mm.demoted.concat(mm.nearMisses);
  return mm;
}

/* Full ranked lender list for the pitch modal — the top matches PLUS the ones
 * right behind them (not capped at 3), each with its AE contact, so DK can pick
 * alternatives when a top pick passes. nearMissList (optional) = [{name,why}]
 * from the card, resolved with contacts too. Re-runs your M2 screen + match. */
/* Build name->{ae,email} for ALL lenders in ONE read of the Matrix tab.
   (Same parsing as Pipeline_lenderContact_, but batched — the per-lender
   version was re-reading the whole sheet once per lender, which is what made
   the "Matched Lenders" list slow to appear.) */
function _pl_contactMap_() {
  var map = {};
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.RAW_LENDERS_TAB);
    if (!sh) return map;
    var vals = sh.getDataRange().getValues();
    if (!vals.length) return map;
    var H = vals[0].map(normHeader_);
    function col(test) { for (var i = 0; i < H.length; i++) { if (test(H[i])) return i; } return -1; }
    var cL = col(function (h) { return h === 'lender'; });
    var cC = col(function (h) { return h.indexOf('contact') >= 0; });
    var cE = col(function (h) { return h.indexOf('email') >= 0 || h.indexOf('phone') >= 0; });
    if (cL < 0) return map;
    for (var r = 1; r < vals.length; r++) {
      var key = String(vals[r][cL] || '').trim().toLowerCase();
      if (!key) continue;
      var pe = cE >= 0 ? String(vals[r][cE] || '') : '';
      var em = (pe.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0];
      var contact = cC >= 0 ? String(vals[r][cC] || '') : '';
      var ae = contact.split(/[,(]/)[0].trim().split(/\s+/)[0];
      map[key] = { ae: ae, email: em };
    }
  } catch (e) {}
  return map;
}

function pipeline_lenderOptions(dealId, nearMissList) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[rowIdx][i];
    var sr = screenDeal(d), mm = matchLendersLTV_(d, sr);
    function nm(m) { return String((m && (m.lender || m.name || m.n)) || '').trim(); }
    function wy(m) { return String((m && (m.why || m.reason || m.note || (m.reasons && m.reasons.join ? m.reasons.join(', ') : ''))) || '').trim(); }
    var CMAP = _pl_contactMap_();   // one Matrix read for all lenders (was the popup lag)
    function withC(name, why) { var c = CMAP[String(name || '').trim().toLowerCase()] || { ae: '', email: '' }; return { name: name, ae: c.ae, email: c.email, hasEmail: !!c.email, why: why || '' }; }
    var matches = (mm.matches || []).map(function (m) { var name = nm(m); return name ? withC(name, wy(m)) : null; }).filter(function (x) { return x; });
    var seen = {};
    var demoted = (mm.demoted || []).map(function (x) { var name = nm(x); if (!name) return null; seen[name.toLowerCase()] = 1; return withC(name, wy(x)); }).filter(function (x) { return x; });
    var near = demoted.concat((nearMissList || []).map(function (x) {
      var name = String((x && (x.name || x.lender)) || '').trim();
      if (!name || seen[name.toLowerCase()]) return null;
      return withC(name, String((x && x.why) || ''));
    }).filter(function (x) { return x; }));
    return { ok: true, matches: matches, nearMisses: near, top: Math.min(3, matches.length) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* =========================================================================
 * LENDER PROFILES — read/write a lender's row on your human master list
 * (ASAP_CFG.RAW_LENDERS_TAB = 'Deal Matching Matrix', the same tab the pitch
 * contact lookup reads). Edits here show up in future deals automatically.
 * ========================================================================= */
function _pl_lenderSheet_() { return ss_().getSheetByName(ASAP_CFG.RAW_LENDERS_TAB); }
function _pl_normH_(h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase(); }
function _pl_lcol_(H, test) { for (var i = 0; i < H.length; i++) { if (test(H[i])) return i; } return -1; }

/* Read one lender's full profile for the popup. */
function pipeline_getLenderProfile(name) {
  try {
    var sh = _pl_lenderSheet_(); if (!sh) return { ok: false, error: "Lender tab '" + ASAP_CFG.RAW_LENDERS_TAB + "' not found." };
    var vals = sh.getDataRange().getValues(); if (!vals.length) return { ok: false, error: 'Lender tab is empty.' };
    var H = vals[0].map(_pl_normH_);
    var cName = _pl_lcol_(H, function (h) { return h === 'lender'; });
    if (cName < 0) return { ok: false, error: "No 'Lender' column on the master list." };
    var target = String(name || '').trim().toLowerCase(), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cName] || '').trim().toLowerCase() === target) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: '“' + name + '” is not on the master list yet.' };
    var row = vals[rowIdx];
    function g(test) { var c = _pl_lcol_(H, test); return c >= 0 ? String(row[c] || '').trim() : ''; }
    var contact = g(function (h) { return h.indexOf('primary contact') >= 0; }) || g(function (h) { return h.indexOf('contact') >= 0 && h.indexOf('last') < 0; });
    return { ok: true, name: String(row[cName]).trim(),
      contact: contact,
      phoneEmail: g(function (h) { return h.indexOf('phone') >= 0 || h.indexOf('email') >= 0; }),
      website:    g(function (h) { return h.indexOf('website') >= 0 || h.indexOf('url') >= 0 || h === 'web'; }),
      niche:      g(function (h) { return h.indexOf('niche') >= 0 || h.indexOf('benefit') >= 0; }),
      type:       g(function (h) { return h === 'type'; }),
      sweetSpot:  g(function (h) { return h.indexOf('sweet') >= 0; }),
      rate:       g(function (h) { return h.indexOf('rate') >= 0; }),
      origFee:    g(function (h) { return h.indexOf('orig') >= 0; }),
      minLoan:    g(function (h) { return h.indexOf('min loan') >= 0; }),
      maxLoan:    g(function (h) { return h.indexOf('max loan') >= 0; }),
      minFico:    g(function (h) { return h.indexOf('fico') >= 0; }),
      states:     g(function (h) { return h.indexOf('states') >= 0 || h.indexOf('notes') >= 0; }),
      foreign:    g(function (h) { return h.indexOf('foreign') >= 0; }),
      close:      g(function (h) { return h.indexOf('close') >= 0; }),
      confidence: g(function (h) { return h.indexOf('confidence') >= 0; }),
      updated:    g(function (h) { return h.indexOf('updated') >= 0; }),
      maxLtvByFico:   g(function (h) { return h.indexOf('ltv by fico') >= 0 || (h.indexOf('ltv') >= 0 && h.indexOf('fico') >= 0); }),
      appraisal:      g(function (h) { return h.indexOf('appraisal') >= 0; }),
      responsiveness: g(function (h) { return h.indexOf('responsive') >= 0; }),
      whiteLabel:     g(function (h) { return h.indexOf('white label') >= 0 || h.indexOf('white-label') >= 0 || h.indexOf('whitelabel') >= 0; })
    };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Save the editable fields back to the master list. Adds Website / Niche columns if missing. */
function pipeline_saveLenderProfile(name, fields) {
  try {
    fields = fields || {};
    var sh = _pl_lenderSheet_(); if (!sh) return { ok: false, error: "Lender tab not found." };
    var lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(_pl_normH_);
    function find(test) { return _pl_lcol_(H, test); }
    function ensure(label, test) { var c = find(test); if (c < 0) { lastCol++; sh.getRange(1, lastCol).setValue(label).setFontWeight('bold'); H.push(_pl_normH_(label)); c = H.length - 1; } return c; }
    var cName = find(function (h) { return h === 'lender'; });
    if (cName < 0) return { ok: false, error: "No 'Lender' column on the master list." };
    var cContact = find(function (h) { return h.indexOf('primary contact') >= 0; });
    if (cContact < 0) cContact = find(function (h) { return h.indexOf('contact') >= 0 && h.indexOf('last') < 0; });
    if (cContact < 0) cContact = ensure('Primary Contact', function (h) { return h.indexOf('primary contact') >= 0; });
    var cPhone = find(function (h) { return h.indexOf('phone') >= 0 || h.indexOf('email') >= 0; });
    if (cPhone < 0) cPhone = ensure('Phone / Email', function (h) { return h.indexOf('phone') >= 0 || h.indexOf('email') >= 0; });
    var cWeb   = ensure('Website',          function (h) { return h.indexOf('website') >= 0 || h.indexOf('url') >= 0; });
    var cNiche = ensure('Niche / Benefits', function (h) { return h.indexOf('niche') >= 0 || h.indexOf('benefit') >= 0; });
    var cLtvF  = ensure('Max LTV by FICO',  function (h) { return h.indexOf('ltv by fico') >= 0 || (h.indexOf('ltv') >= 0 && h.indexOf('fico') >= 0); });
    var cAppr  = ensure('Appraisal?',       function (h) { return h.indexOf('appraisal') >= 0; });
    var cResp  = ensure('Responsiveness',   function (h) { return h.indexOf('responsive') >= 0; });
    var cWL    = ensure('White Label?',     function (h) { return h.indexOf('white label') >= 0 || h.indexOf('white-label') >= 0 || h.indexOf('whitelabel') >= 0; });
    var vals = sh.getDataRange().getValues();
    var target = String(name || '').trim().toLowerCase(), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cName] || '').trim().toLowerCase() === target) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: '“' + name + '” is not on the master list.' };
    // prior values of the fields matchLenders actually reads (to decide if a re-sync is needed)
    var cMinL = find(function (h) { return h.indexOf('min loan') >= 0; });
    var cMaxL = find(function (h) { return h.indexOf('max loan') >= 0; });
    var cFico = find(function (h) { return h.indexOf('fico') >= 0; });
    var cSt   = find(function (h) { return h.indexOf('states') >= 0 || h.indexOf('notes') >= 0; });
    var cSw   = find(function (h) { return h.indexOf('sweet') >= 0; });
    var cConf = find(function (h) { return h.indexOf('confidence') >= 0; });
    function prior(c) { return c >= 0 ? String(vals[rowIdx][c] == null ? '' : vals[rowIdx][c]).trim() : ''; }
    var was = { minLoan: prior(cMinL), maxLoan: prior(cMaxL), minFico: prior(cFico), states: prior(cSt), sweetSpot: prior(cSw), confidence: prior(cConf),
                maxLtvByFico: prior(cLtvF), appraisal: prior(cAppr), responsiveness: prior(cResp), whiteLabel: prior(cWL) };
    function setCol(c, v) { if (c >= 0 && v != null) sh.getRange(rowIdx + 1, c + 1).setValue(v); }
    function setBy(v, test) { if (v != null) setCol(find(test), v); }
    if (fields.contact    != null) setCol(cContact, fields.contact);
    if (fields.phoneEmail != null) setCol(cPhone, fields.phoneEmail);
    setCol(cWeb, fields.website);
    setCol(cNiche, fields.niche);
    setCol(cLtvF, fields.maxLtvByFico);
    setCol(cAppr, fields.appraisal);
    setCol(cResp, fields.responsiveness);
    setCol(cWL,   fields.whiteLabel);
    setBy(fields.type,       function (h) { return h === 'type'; });
    setBy(fields.sweetSpot,  function (h) { return h.indexOf('sweet') >= 0; });
    setBy(fields.minLoan,    function (h) { return h.indexOf('min loan') >= 0; });
    setBy(fields.maxLoan,    function (h) { return h.indexOf('max loan') >= 0; });
    setBy(fields.rate,       function (h) { return h.indexOf('rate') >= 0; });
    setBy(fields.origFee,    function (h) { return h.indexOf('orig') >= 0; });
    setBy(fields.minFico,    function (h) { return h.indexOf('fico') >= 0; });
    setBy(fields.states,     function (h) { return h.indexOf('states') >= 0 || h.indexOf('notes') >= 0; });
    setBy(fields.foreign,    function (h) { return h.indexOf('foreign') >= 0; });
    setBy(fields.close,      function (h) { return h.indexOf('close') >= 0; });
    setBy(fields.confidence, function (h) { return h.indexOf('confidence') >= 0; });
    setBy(fields.updated,    function (h) { return h.indexOf('updated') >= 0; });
    // if a field the matcher reads actually changed, rebuild the clean Pipeline_Lenders tab via your own importer
    var boxChanged =
      (fields.minLoan    != null && String(fields.minLoan).trim()    !== was.minLoan) ||
      (fields.maxLoan    != null && String(fields.maxLoan).trim()    !== was.maxLoan) ||
      (fields.minFico    != null && String(fields.minFico).trim()    !== was.minFico) ||
      (fields.states     != null && String(fields.states).trim()     !== was.states) ||
      (fields.sweetSpot  != null && String(fields.sweetSpot).trim()  !== was.sweetSpot) ||
      (fields.confidence != null && String(fields.confidence).trim() !== was.confidence) ||
      (fields.maxLtvByFico   != null && String(fields.maxLtvByFico).trim()   !== was.maxLtvByFico) ||
      (fields.appraisal      != null && String(fields.appraisal).trim()      !== was.appraisal) ||
      (fields.responsiveness != null && String(fields.responsiveness).trim() !== was.responsiveness) ||
      (fields.whiteLabel     != null && String(fields.whiteLabel).trim()     !== was.whiteLabel);
    var resynced = false, syncError = '';
    if (boxChanged) { try { SpreadsheetApp.flush(); importLenders(); resynced = true; } catch (e) { syncError = String(e); } }
    return { ok: true, resynced: resynced, boxChanged: boxChanged, syncError: syncError };
  } catch (err) { return { ok: false, error: String(err) }; }
}
/* Editor sanity check — logs the first lender's profile. */
function pipeline_lenderProfileTest() {
  var sh = _pl_lenderSheet_(); if (!sh) { Logger.log("No tab '" + ASAP_CFG.RAW_LENDERS_TAB + "'."); return; }
  var vals = sh.getDataRange().getValues(); var H = vals[0].map(_pl_normH_);
  var cName = _pl_lcol_(H, function (h) { return h === 'lender'; });
  var nm = (cName >= 0 && vals[1]) ? String(vals[1][cName]).trim() : '';
  Logger.log('Profiling first lender: ' + nm);
  Logger.log(JSON.stringify(pipeline_getLenderProfile(nm)));
}

/* ---- one-time editor helpers ---- */
function pipeline_rentcastTest() { Logger.log(JSON.stringify(pipeline_estimateRent('1600 Amphitheatre Parkway, Mountain View, CA 94043'))); }
function pipeline_propertyTest() { Logger.log(JSON.stringify(pipeline_lookupProperty('5500 Grand Lake Dr, San Antonio, TX 78244'))); }
/* Run FIRST, once. No try/catch, so Google shows the "Authorization required" prompt. Approve, then run the tests. */
function pipeline_authorize() {
  var key = PropertiesService.getScriptProperties().getProperty('RENTCAST_KEY') || '';
  var resp = UrlFetchApp.fetch('https://api.rentcast.io/v1/avm/rent/long-term?address=' + encodeURIComponent('1 Market St, San Francisco, CA'), { muteHttpExceptions: true, headers: { 'X-Api-Key': key } });
  Logger.log('Authorized. HTTP ' + resp.getResponseCode());
}

/* Save call-sheet figures + notes (the editable Key-metrics fields) to the deal row. */
function pipeline_saveCallExtras(dealId, extras) {
  try {
    extras = extras || {};
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    ['CallNotes', 'TaxesActual', 'InsuranceActual', 'HOAActual', 'ExistingRent', 'MarketRent', 'CustomDocs'].forEach(function (name) {
      if (H.indexOf(name) < 0) { lastCol++; sh.getRange(1, lastCol).setValue(name).setFontWeight('bold'); H.push(name); }
    });
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    function set(header, v) { var c = H.indexOf(header); if (c < 0) return; sh.getRange(rowIdx + 1, c + 1).setValue(v == null ? '' : v); }
    set('CallNotes', extras.notes);
    set('TaxesActual', extras.taxes);
    set('InsuranceActual', extras.insurance);
    set('HOAActual', extras.hoa);
    set('ExistingRent', extras.existingRent);
    set('MarketRent', extras.marketRent);
    set('CustomDocs', extras.customDocs);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* =========================================================================
 * UPLOAD / DATE ADDED / ARCHIVE  — dashboard deal-list management.
 *   • pipeline_uploadDeals  — upload a WorkingMoni .xlsx → ADD new deals
 *     (skips any DealID already on the board, stamps DateAdded).
 *   • pipeline_archiveDeal   — remove a deal from the board but keep the row.
 *   • pipeline_getBoard      — dashboard reader: actionable + non-archived,
 *     with a DateAdded stamp. (Reuses your M2/M3 screening + compactDeal_.)
 * Reuses M1 helpers (normHeader_, dealColIndex_, val_, dealId_, etc.).
 * ========================================================================= */

function _pl_tz_()    { return Session.getScriptTimeZone() || 'America/Los_Angeles'; }
function _pl_today_() { return Utilities.formatDate(new Date(), _pl_tz_(), 'yyyy-MM-dd'); }

/* RUN ONCE from the editor (after turning on the Drive API service) to approve
 * Drive access — the published dashboard can't show the approval popup. */
function Pipeline_authDrive() {
  var id = DriveApp.getRootFolder().getId();   // triggers the Drive permission prompt
  Logger.log('Drive authorized OK. (root id ' + id + ') — you can redeploy now.');
}
function _pl_fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _pl_tz_(), 'MMM d');
  var s = String(v == null ? '' : v).trim(); if (!s) return '';
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Utilities.formatDate(new Date(+m[1], +m[2] - 1, +m[3]), _pl_tz_(), 'MMM d');
  return s;
}

/* Stamp today's date into a column (e.g. InvitedOn / PitchedOn) on the deal's
 * Pipeline_Deals row. Returns the formatted date, or '' if not found. */
function Pipeline_stampDealDate_(dealId, colName) {
  if (!dealId) return '';
  pipeline_ensureColumns_();
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return '';
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cId = H.indexOf('DealID'), cCol = H.indexOf(colName);
  if (cId < 0 || cCol < 0) return '';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][cId]) === String(dealId)) {
      var now = new Date();
      sh.getRange(r + 1, cCol + 1).setValue(now);
      return _pl_fmtDate_(now);
    }
  }
  return '';
}

/* Make sure Pipeline_Deals has DateAdded / Archived / ArchiveReason columns.
 * First time DateAdded is created, baseline-stamp existing rows with today. */
function pipeline_ensureColumns_() {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  if (!sh) return;
  var lastCol = sh.getLastColumn();
  var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var dateWasMissing = (H.indexOf('DateAdded') < 0);
  ['DateAdded', 'Archived', 'ArchiveReason', 'InviteToken', 'CallNotes', 'TaxesActual', 'InsuranceActual', 'HOAActual', 'ExistingRent', 'MarketRent', 'CustomDocs', 'PropData', 'AppraisedValue', 'CallState', 'QuestionsDraftedOn', 'QuestionsSentOn', 'PackageRequested', 'TrackerAdded', 'InvitedOn', 'PitchedOn'].forEach(function (name) {
    if (H.indexOf(name) < 0) { lastCol++; sh.getRange(1, lastCol).setValue(name).setFontWeight('bold'); H.push(name); }
  });
  if (dateWasMissing) {
    var cDate = H.indexOf('DateAdded'), n = sh.getLastRow() - 1;
    if (cDate >= 0 && n > 0) {
      var today = _pl_today_(), col = [];
      for (var i = 0; i < n; i++) col.push([today]);
      sh.getRange(2, cDate + 1, n, 1).setValues(col);
    }
  }
}

/* Convert an uploaded .xlsx blob into a temporary Google Sheet (needs the
 * Drive API advanced service turned on). Returns the temp file id. */
function _pl_xlsxToSheet_(blob, name) {
  if (typeof Drive === 'undefined' || !Drive.Files)
    throw new Error('Turn on the Drive API service first: in the editor click Services (＋) ▸ Drive API ▸ Add, then Save and try again.');
  if (Drive.Files.insert) return Drive.Files.insert({ title: name, mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true }).id;  // v2
  if (Drive.Files.create) return Drive.Files.create({ name: name, mimeType: MimeType.GOOGLE_SHEETS }, blob).id;                       // v3
  throw new Error('Drive API service is on but no insert/create method was found.');
}

/* Pick the sheet in the uploaded file that looks like the WorkingMoni deals. */
function _pl_bestDealSheet_(ss) {
  var sheets = ss.getSheets(), best = null, bestScore = -1;
  for (var s = 0; s < sheets.length; s++) {
    var v = sheets[s].getDataRange().getValues(); if (!v.length) continue;
    var h = v[0].map(normHeader_), score = 0;
    ['deal', 'dealhref', 'loanamount', 'loantype', 'propertytype'].forEach(function (k) { if (h.indexOf(k) >= 0) score++; });
    if (score > bestScore) { bestScore = score; best = sheets[s]; }
  }
  return (bestScore >= 2) ? best : (sheets[0] || null);
}

function pipeline_uploadDeals(base64, filename) {
  try {
    if (!base64) return { ok: false, error: 'No file received.' };
    pipeline_ensureColumns_();

    var bytes = Utilities.base64Decode(base64);
    var blob  = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename || 'upload.xlsx');
    var tempId = _pl_xlsxToSheet_(blob, 'WM_upload_' + Date.now());

    var imported = 0, updated = 0, skipped = 0, total = 0;
    try {
      var tmp = SpreadsheetApp.openById(tempId);
      var raw = findTab_(tmp, ASAP_CFG.RAW_DEALS_TAB) || _pl_bestDealSheet_(tmp);
      if (!raw) throw new Error('Could not find a "' + ASAP_CFG.RAW_DEALS_TAB + '" sheet in that file.');
      var vals = raw.getDataRange().getValues();
      if (vals.length < 2) throw new Error('That file has no deal rows.');
      var hdr = vals[0].map(normHeader_), c = dealColIndex_(hdr);

      var dsh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
      var dvals = dsh.getDataRange().getValues(), DH = dvals[0], cId = DH.indexOf('DealID');
      var cArchD = DH.indexOf('Archived'), cProv = DH.indexOf('Provenance'),
          cLType = DH.indexOf('LoanType'), cLPurp = DH.indexOf('LoanPurpose');

      // every DealID already on the board -> its row index in dvals (active AND archived)
      var rowOf = {};
      for (var r = 1; r < dvals.length; r++) { var id0 = String(dvals[r][cId]).trim(); if (id0 && rowOf[id0] === undefined) rowOf[id0] = r; }

      // the ONLY fields a re-upload may OVERWRITE on an existing deal (your short list).
      // everything else is fill-blanks-only; a blank scrape value never wipes existing data.
      var OVERWRITE = { LoanPurpose: 1, PropertySummary: 1, ExitPlan: 1, BorrowerDetails: 1 };
      var CANON = ['Purchase','Refinance','Cash-Out Refinance','Bridge','Fix & Flip','Ground-Up Construction','Rental / DSCR','Land'];
      function empty_(v){ return v === null || v === undefined || String(v).trim() === ''; }

      var today = _pl_today_(), newRows = [], seenNew = {}, didMerge = {};
      for (var i = 1; i < vals.length; i++) {
        var row = vals[i];
        var dealStr = String(val_(row, c.deal) || '').trim(), url = String(val_(row, c.href) || '').trim();
        if (!dealStr && !url) continue;
        total++;
        var id = dealId_(url, i);

        /* ---- EXISTING DEAL: merge in place (fill blanks + refresh the 4 fields) ---- */
        if (rowOf[id] !== undefined && rowOf[id] >= 0) {
          if (didMerge[id]) { skipped++; continue; }     // same deal twice in one file -> merge once
          didMerge[id] = true;
          var er = rowOf[id];

          if (cArchD >= 0 && String(dvals[er][cArchD]).trim() !== '') { skipped++; continue; }  // archived -> leave frozen

          var loc2 = parseCityStateZip_(dealStr), street2 = String(val_(row, c.street) || '').trim();
          var scr = {   // scrape-derived values for this row (same mapping a new import uses)
            SourceURL: url, City: loc2.city, State: loc2.state, Zip: loc2.zip, Street: street2,
            AssembledAddress: assemble_('', street2, loc2.city, loc2.state, loc2.zip),
            LoanAmount: val_(row, c.amount), LoanType: val_(row, c.loanType), MarketValue: val_(row, c.value),
            SecondValue: val_(row, c.second), LTV: val_(row, c.ltv), AnnualReturn: val_(row, c.areturn), AnnualIncome: val_(row, c.aincome),
            MonthlyRent: val_(row, c.rent), DesiredTerm: val_(row, c.term), LienPosition: val_(row, c.lien), BuildingSize: val_(row, c.bsize),
            LotSize: val_(row, c.lot), LotAcres: parseAcres_(val_(row, c.lot)), ZoningUse: val_(row, c.zoning), Occupancy: val_(row, c.occ),
            PropertyType: val_(row, c.ptype), FICO: val_(row, c.fico), LoanPurpose: val_(row, c.purpose), PropertySummary: val_(row, c.psummary),
            ExitPlan: val_(row, c.exit), BorrowerDetails: val_(row, c.bdetails), UploadBy: val_(row, c.uploadby)
          };

          // protect a hand-set loan type (borrower-confirmed, or you edited it) from being reverted by the raw scrape
          var prov = cProv >= 0 ? String(dvals[er][cProv] || '').toLowerCase() : '';
          var lt = cLType >= 0 ? String(dvals[er][cLType] || '').trim() : '';
          var lp = cLPurp >= 0 ? String(dvals[er][cLPurp] || '').trim() : '';
          var purposeLocked = (prov.indexOf('borrower') >= 0) || (lt !== '' && lt === lp && CANON.indexOf(lp) >= 0);

          var rowArr = dvals[er].slice(), changed = false;
          for (var k = 0; k < DH.length; k++) {
            var h = DH[k];
            if (!scr.hasOwnProperty(h)) continue;   // only scrape columns; your edits/RentCast/notes/dates are never touched
            var newv = scr[h];
            if (empty_(newv)) continue;             // never write a blank over existing data
            var cur = rowArr[k];
            if (OVERWRITE[h]) {
              if (h === 'LoanPurpose' && purposeLocked) continue;
              if (String(cur) !== String(newv)) { rowArr[k] = newv; changed = true; }
            } else if (empty_(cur)) {               // blanks-only for every other scrape field
              rowArr[k] = newv; changed = true;
            }
          }
          if (changed) { dsh.getRange(er + 1, 1, 1, DH.length).setValues([rowArr]); dvals[er] = rowArr; updated++; }
          else skipped++;
          continue;
        }

        /* ---- NEW DEAL: append (unchanged behavior) ---- */
        if (seenNew[id]) { skipped++; continue; }   // duplicate new row within this same file
        seenNew[id] = true;
        var loc = parseCityStateZip_(dealStr), street = String(val_(row, c.street) || '').trim();
        var base = {
          DealID: id, SourceURL: url, City: loc.city, State: loc.state, Zip: loc.zip, Street: street, HouseNum: '',
          AssembledAddress: assemble_('', street, loc.city, loc.state, loc.zip),
          LoanAmount: val_(row, c.amount), LoanType: val_(row, c.loanType), MarketValue: val_(row, c.value), ValueSource: 'listing',
          SecondValue: val_(row, c.second), LTV: val_(row, c.ltv), AnnualReturn: val_(row, c.areturn), AnnualIncome: val_(row, c.aincome),
          MonthlyRent: val_(row, c.rent), DesiredTerm: val_(row, c.term), LienPosition: val_(row, c.lien), BuildingSize: val_(row, c.bsize),
          LotSize: val_(row, c.lot), LotAcres: parseAcres_(val_(row, c.lot)), ZoningUse: val_(row, c.zoning), Occupancy: val_(row, c.occ),
          PropertyType: val_(row, c.ptype), FICO: val_(row, c.fico), LoanPurpose: val_(row, c.purpose), PropertySummary: val_(row, c.psummary),
          ExitPlan: val_(row, c.exit), BorrowerDetails: val_(row, c.bdetails), UploadBy: val_(row, c.uploadby),
          BorrowerName: '', BorrowerEmail: '', Grade: '', Status: '', Provenance: 'listing',
          DateAdded: today, Archived: '', ArchiveReason: ''
        };
        newRows.push(DH.map(function (h) { return base.hasOwnProperty(h) ? base[h] : ''; }));
        imported++;
      }
      if (newRows.length) dsh.getRange(dsh.getLastRow() + 1, 1, newRows.length, DH.length).setValues(newRows);
    } finally {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) {}   // clean up the temp file
    }
    return { ok: true, imported: imported, updated: updated, skipped: skipped, total: total };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function pipeline_archiveDeal(dealId, reason) {
  try {
    pipeline_ensureColumns_();
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cA = H.indexOf('Archived'), cR = H.indexOf('ArchiveReason'), cS = H.indexOf('Status');
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) {
        var when = _pl_today_();
        if (cA >= 0) sh.getRange(r + 1, cA + 1).setValue(when);
        if (cR >= 0) sh.getRange(r + 1, cR + 1).setValue(reason || 'Archived');
        if (cS >= 0) sh.getRange(r + 1, cS + 1).setValue('Archived — ' + (reason || '') + ' (' + when + ')');
        return { ok: true };
      }
    }
    return { ok: false, error: 'Deal ' + dealId + ' not found.' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* List archived deals (lightweight) for the dashboard "Archived" panel. */
function pipeline_getArchived() {
  try {
    pipeline_ensureColumns_();
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cArch = H.indexOf('Archived'), cReason = H.indexOf('ArchiveReason');
    var cType = H.indexOf('LoanType'), cCity = H.indexOf('City'), cState = H.indexOf('State'), cStreet = H.indexOf('Street');
    var out = [];
    for (var r = 1; r < vals.length; r++) {
      var a = cArch >= 0 ? String(vals[r][cArch]).trim() : '';
      if (!a) continue;
      var street = cStreet >= 0 ? vals[r][cStreet] : '', city = cCity >= 0 ? vals[r][cCity] : '', st = cState >= 0 ? vals[r][cState] : '';
      var addr = [street, city, st].filter(function (x) { return x !== '' && x != null; }).join(', ');
      out.push({
        id: String(vals[r][cId]),
        type: cType >= 0 ? String(vals[r][cType] || 'Deal') : 'Deal',
        addrShort: addr,
        reason: cReason >= 0 ? String(vals[r][cReason] || '') : '',
        archived: a
      });
    }
    out.sort(function (x, y) { return String(y.archived).localeCompare(String(x.archived)); });
    return { ok: true, deals: out };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Un-archive — clears Archived/ArchiveReason/Status so the deal returns to the board. */
function pipeline_unarchiveDeal(dealId) {
  try {
    pipeline_ensureColumns_();
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cA = H.indexOf('Archived'), cR = H.indexOf('ArchiveReason'), cS = H.indexOf('Status');
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) {
        if (cA >= 0) sh.getRange(r + 1, cA + 1).setValue('');
        if (cR >= 0) sh.getRange(r + 1, cR + 1).setValue('');
        if (cS >= 0) sh.getRange(r + 1, cS + 1).setValue('');
        return { ok: true };
      }
    }
    return { ok: false, error: 'Deal ' + dealId + ' not found.' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Dashboard reader — actionable, non-archived deals, each with a DateAdded
 * stamp. Calls your existing screenDeal / matchLenders / compactDeal_. */
/* =========================================================================
 * ADD A DEAL TO DK's LOAN TRACKER (manual, one click from a deal card)
 * Writes a fresh row into the "Loan Tracker" tab of the converted Google
 * Sheet. Leaves Expected Comp as DK's formula (points*loan + fee), fills the
 * columns we know from the deal, and marks the deal so it can't double-add.
 * ========================================================================= */
var PIPELINE_TRACKER = {
  ssId: '1M7tbNvwJxmksCgzRO6dRI-Yu4sonKpg0It4NHcB9F50',   // loan_tracker_google_sheets_MAIN_EDITABLE (Google Sheet)
  tab:  'Loan Tracker'
};

function _pl_colLetter_(n) {            // 1 -> A, 27 -> AA
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function _pl_trkLoanType_(d) {
  var cat = '';
  try { cat = categoryOf_(d); } catch (e) {}
  if (cat === 'dscr') return 'DSCR';
  return 'Hard Money';                  // every other pipeline product maps to Hard Money on his list
}
function _pl_trkPurpose_(d) {
  var cat = '';
  try { cat = categoryOf_(d); } catch (e) {}
  if (cat === 'refi')     return 'Refinance';
  if (cat === 'cashout')  return 'Cash-Out Refi';
  if (cat === 'bridge')   return 'Bridge';
  if (cat === 'groundup') return 'Construction';
  return 'Purchase';
}
function _pl_trkPropType_(d) {
  var p = String(d.PropertyType || '').toLowerCase();
  if (/mixed/.test(p))                          return 'Mixed-Use';
  if (/(5\+|multi)/.test(p))                    return 'Multifamily';
  if (/(2.?4 ?unit|2-4|duplex|triplex|fourplex)/.test(p)) return '2-4 Unit';
  if (/condo/.test(p))                          return 'Condo';
  if (/town/.test(p))                           return 'Townhome';
  if (/(commercial|industrial|special)/.test(p)) return 'Commercial';
  if (/land/.test(p))                           return 'Land Dev';
  if (/(sfr|single|res)/.test(p))               return 'SFR';
  return 'TBD';
}
function _pl_trkAddress_(d) {
  var a = String(d.AssembledAddress || '').trim();
  if (a) return a;
  try { return assemble_(d.HouseNum, d.Street, d.City, d.State, d.Zip); } catch (e) { return String(d.City || ''); }
}

function pipeline_addToTracker(dealId) {
  try {
    pipeline_ensureColumns_();
    var dsh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!dsh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var dv = dsh.getDataRange().getValues(), DH = dv[0];
    var cId = DH.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < dv.length; r++) { if (String(dv[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var d = {}; for (var i = 0; i < DH.length; i++) d[DH[i]] = dv[rowIdx][i];

    // note if it was added before, but DON'T block — always write (a stuck "already added"
    // flag was silently skipping the write). DK can delete a stray duplicate if needed.
    var cAdded = DH.indexOf('TrackerAdded');
    var wasAdded = (cAdded >= 0 && String(dv[rowIdx][cAdded]).trim() !== '');

    // open the tracker + the Loan Tracker tab
    var tss;
    try { tss = SpreadsheetApp.openById(PIPELINE_TRACKER.ssId); }
    catch (e) { return { ok: false, error: 'Could not open your Loan Tracker sheet (authorize it once, or check sharing). ' + e }; }
    var tsh = tss.getSheetByName(PIPELINE_TRACKER.tab);
    if (!tsh) return { ok: false, error: "Tab '" + PIPELINE_TRACKER.tab + "' not found in your tracker." };
    var tv = tsh.getDataRange().getValues();

    // locate the header row ("Borrower Name") and the summary row ("PIPELINE SUMMARY")
    var headerRow = -1, summaryRow = -1;
    for (var r = 0; r < tv.length; r++) {
      var low = tv[r].map(function (x) { return String(x || '').trim().toLowerCase(); });
      if (headerRow < 0 && low.indexOf('borrower name') >= 0) headerRow = r;
      if (summaryRow < 0 && low.indexOf('pipeline summary') >= 0) summaryRow = r;
    }
    if (headerRow < 0) return { ok: false, error: "Couldn't find the 'Borrower Name' header on the Loan Tracker tab." };
    if (summaryRow < 0) summaryRow = tv.length;

    var TH = tv[headerRow].map(function (x) { return String(x || '').trim().toLowerCase(); });
    function tcol(name) { return TH.indexOf(name); }
    var cBorr = tcol('borrower name'), cDeal = tcol('deal status'),
        cAddr = tcol('property address'), cLT = tcol('loan type'), cPur = tcol('purpose'),
        cAmt = tcol('loan amt'), cComp = tcol('expected comp'), cPts = tcol('points'),
        cFee = tcol('processing fee'), cPT = tcol('property type'), cLO = tcol('lo'), cLen = tcol('lender');

    // first empty data row (blank Borrower Name) above the summary; else insert one
    var writeRow = -1;
    for (var r = headerRow + 1; r < summaryRow; r++) {
      if (String(tv[r][cBorr >= 0 ? cBorr : 1] || '').trim() === '') { writeRow = r; break; }
    }
    if (writeRow < 0) { tsh.insertRowBefore(summaryRow + 1); writeRow = summaryRow; }
    var rowNum = writeRow + 1;   // 1-based

    function setV(c, v) { if (c >= 0 && v != null && v !== '') tsh.getRange(rowNum, c + 1).setValue(v); }
    setV(cDeal, 'Shopping');
    setV(cBorr, String(d.BorrowerName || '').trim());
    setV(cAddr, _pl_trkAddress_(d));
    setV(cLT,   _pl_trkLoanType_(d));
    setV(cPur,  _pl_trkPurpose_(d));
    var amt = money_(d.LoanAmount); if (amt && cAmt >= 0) tsh.getRange(rowNum, cAmt + 1).setValue(amt);
    setV(cPT,  _pl_trkPropType_(d));
    setV(cLO,  'DK');
    setV(cLen, 'TBD');
    // Expected Comp -> DK's formula (points * loan + processing fee), never a static number
    if (cComp >= 0 && cAmt >= 0 && cPts >= 0 && cFee >= 0) {
      tsh.getRange(rowNum, cComp + 1).setFormula(
        '=' + _pl_colLetter_(cAmt + 1) + rowNum + '*' + _pl_colLetter_(cPts + 1) + rowNum + '+' + _pl_colLetter_(cFee + 1) + rowNum);
    }

    if (cAdded >= 0) dsh.getRange(rowIdx + 1, cAdded + 1).setValue(new Date());
    return { ok: true, row: rowNum, dup: wasAdded, message: 'Added to Loan Tracker (row ' + rowNum + ').' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function pipeline_getBoard() {
  pipeline_ensureColumns_();
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  if (!sh) return [];
  var vals = sh.getDataRange().getValues(), H = vals[0];
  var cArch = H.indexOf('Archived'), cDate = H.indexOf('DateAdded');
  var out = [];
  var capMap = _pl_ltvCapMap_();
  for (var r = 1; r < vals.length; r++) {
    if (cArch >= 0 && String(vals[r][cArch]).trim() !== '') continue;   // skip archived
    var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i];
    var sr = screenDeal(d);
    if (sr.decision === 'FAIL') continue;                                // board shows actionable only
    var mm = matchLendersLTV_(d, sr, capMap), card;
    try { card = compactDeal_(d, sr, mm, r + 1); } catch (e) { continue; }
    card.dateAdded = (cDate >= 0) ? _pl_fmtDate_(vals[r][cDate]) : '';
    card.nearMisses = (mm && mm.nearMisses ? mm.nearMisses : []).slice(0, 6);   // "doesn't fit (and why)"
    card.state = String(d.State || '');
    card.city = String(d.City || '');
    card.street = String(d.Street || '');
    card.borrowerName = String(d.BorrowerName || '');
    card.borrowerEmail = String(d.BorrowerEmail || '');
    card.houseNum = String(d.HouseNum || '');
    card.purpose = Pipeline_mapLoanPurpose_(d).purpose;   // canonical loan type for filtering
    card.callNotes    = (H.indexOf('CallNotes')       >= 0) ? String(vals[r][H.indexOf('CallNotes')]       || '') : '';
    card.taxesActual  = (H.indexOf('TaxesActual')     >= 0) ? String(vals[r][H.indexOf('TaxesActual')]     || '') : '';
    card.insActual    = (H.indexOf('InsuranceActual') >= 0) ? String(vals[r][H.indexOf('InsuranceActual')] || '') : '';
    card.hoaActual    = (H.indexOf('HOAActual')       >= 0) ? String(vals[r][H.indexOf('HOAActual')]       || '') : '';
    card.existingRent = (H.indexOf('ExistingRent')    >= 0) ? String(vals[r][H.indexOf('ExistingRent')]    || '') : '';
    card.marketRent   = (H.indexOf('MarketRent')      >= 0) ? String(vals[r][H.indexOf('MarketRent')]      || '') : '';
    card.customDocs   = (H.indexOf('CustomDocs')       >= 0) ? String(vals[r][H.indexOf('CustomDocs')]       || '') : '';
    card.propData     = (H.indexOf('PropData')         >= 0) ? String(vals[r][H.indexOf('PropData')]         || '') : '';
    card.appraised    = (H.indexOf('AppraisedValue')   >= 0) ? String(vals[r][H.indexOf('AppraisedValue')]   || '') : '';
    card.callState    = (H.indexOf('CallState')        >= 0) ? String(vals[r][H.indexOf('CallState')]        || '') : '';
    card.outreachLog  = (H.indexOf('OutreachLog')      >= 0) ? String(vals[r][H.indexOf('OutreachLog')]      || '') : '';
    card.trackerAdded = (H.indexOf('TrackerAdded')     >= 0) ? (String(vals[r][H.indexOf('TrackerAdded')]    || '').trim() !== '') : false;
    card.packageRequested = (H.indexOf('PackageRequested') >= 0) ? _pl_fmtDate_(vals[r][H.indexOf('PackageRequested')]) : '';
    card.invitedOn    = (H.indexOf('InvitedOn')         >= 0) ? _pl_fmtDate_(vals[r][H.indexOf('InvitedOn')])    : '';
    card.pitchedOn    = (H.indexOf('PitchedOn')         >= 0) ? _pl_fmtDate_(vals[r][H.indexOf('PitchedOn')])    : '';
    card.sourceUrl    = String(d.SourceURL || '');
    card.laneOverride = (H.indexOf('LaneOverride') >= 0) ? String(vals[r][H.indexOf('LaneOverride')] || '').trim().toLowerCase() : '';
    card.viewedStatus = (H.indexOf('ViewedStatus') >= 0) ? String(vals[r][H.indexOf('ViewedStatus')] || '').trim().toLowerCase() : '';
    card.viewedNote = (H.indexOf('ViewedNote') >= 0) ? String(vals[r][H.indexOf('ViewedNote')] || '') : '';
    (function(){ var ci=H.indexOf('RecheckDate'); if(ci>=0){ var rv=vals[r][ci]; card.recheckDate=(rv instanceof Date)?Utilities.formatDate(rv,_pl_tz_(),'yyyy-MM-dd'):String(rv||'').trim(); } else { card.recheckDate=''; } })();
    out.push(card);
  }
  out.sort(function (a, b) { return (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || ((b.topScore || 0) - (a.topScore || 0)); });
  return out;
}

/* =========================================================================
 * MAPPING  — WorkingMoni deal row  →  your loan-app field names
 * ========================================================================= */
function Pipeline_mapDealToApp_(d) {
  var lp = Pipeline_mapLoanPurpose_(d);
  return {
    dealId:          String(d.DealID || ''),
    email:           String(d.BorrowerEmail || '').trim(),
    firstName:       Pipeline_firstName_(d.BorrowerName),
    loanPurpose:     lp.purpose,                                   // a DEAL_TYPES id
    propertyType:    Pipeline_mapPropertyType_(d.PropertyType),    // matches form: Single-family / Condo / Multifamily(5+) / Mixed-use / Commercial / Land / Other
    propertyAddress: String(d.AssembledAddress || '').trim(),
    loanAmount:      Pipeline_numStr_(d.LoanAmount),
    marketValue:     Pipeline_numStr_(d.MarketValue),
    occupancy:       Pipeline_mapOccupancy_(d.Occupancy),          // matches form: Vacant / Leased / Owner-occupied
    monthlyRent:     Pipeline_numStr_(d.MonthlyRent),
    creditBand:      Pipeline_mapFico_(d.FICO),                    // matches form bands exactly
    _flag:           lp.flag
  };
}

/* loan type → DEAL_TYPES id. Cash-out → Cash-Out Refinance.
 * Combined (1st & 2nd) / Mezzanine / Blanket → Bridge + flag (your call). */
function Pipeline_mapLoanPurpose_(d) {
  var lt = String(d.LoanType || '');
  // An explicit canonical pick (dashboard "Edit details" or borrower write-back) always wins.
  var CANON = ['Purchase','Refinance','Cash-Out Refinance','Bridge','Fix & Flip','Ground-Up Construction','Rental / DSCR','Land'];
  var exact = String(d.LoanPurpose || '').trim();
  if (CANON.indexOf(exact) >= 0) return { purpose: exact, flag: '' };
  var s  = (lt + ' ' + String(d.LoanPurpose || '') + ' ' + String(d.PropertySummary || '')).toLowerCase();

  if (/combined|2nd|second lien|mezzanine|mezz|blanket/.test(s))
    return { purpose: 'Bridge', flag: 'Lien/structure (' + (lt || 'combined/2nd') + ') \u2192 Bridge; confirm a 2nd/mezz-capable lender' };
  if (/ground.?up|construction/.test(s))   return { purpose: 'Ground-Up Construction', flag: '' };
  if (/fix|flip|rehab/.test(s))            return { purpose: 'Fix & Flip', flag: '' };
  if (/dscr|rental/.test(s))               return { purpose: 'Rental / DSCR', flag: '' };
  if (/cash.?out/.test(s))                 return { purpose: 'Cash-Out Refinance', flag: '' };
  if (/bailout|foreclosure/.test(s))       return { purpose: 'Bridge', flag: 'Foreclosure bailout \u2192 Bridge' };
  if (/refi|refinance/.test(s))            return { purpose: 'Refinance', flag: '' };
  if (/bridge/.test(s))                    return { purpose: 'Bridge', flag: '' };
  if (/\bland\b|vacant lot/.test(s) || /land/.test(String(d.PropertyType || '').toLowerCase()))
    return { purpose: 'Land', flag: '' };
  if (/purchase|acquisition|\bbuy\b/.test(s)) return { purpose: 'Purchase', flag: '' };
  return { purpose: 'Purchase', flag: 'Loan type unclear ("' + lt + '") \u2192 defaulted to Purchase; verify' };
}

/* property type → form option (EXACT, from your live dropdown):
 *   Single-family (1-4 units) / Condo / townhome / Multifamily (5+ units) /
 *   Mixed-use / Commercial / Land / Other.  (Option text IS the value.)
 * Note: 1-4 AND 2-4 unit deals both map to "Single-family (1-4 units)";
 * only 5+ is "Multifamily (5+ units)". */
function Pipeline_mapPropertyType_(pt) {
  var s = String(pt || '').toLowerCase();
  if (!s) return '';
  if (/mixed/.test(s))                                                                          return 'Mixed-use';
  if (/condo|town/.test(s))                                                                     return 'Condo / townhome';
  if (/\bland\b|vacant land|acreage|\bacre/.test(s))                                            return 'Land';
  if (/2\s*-\s*4|2\u20134|2 to 4|duplex|triplex|fourplex|1\s*-\s*4|1\u20134/.test(s))           return 'Single-family (1-4 units)';
  if (/5\s*\+|multifamily|multi.?family|apartment/.test(s))                                     return 'Multifamily (5+ units)';
  if (/commercial|industrial|special|office|retail|warehouse|storage/.test(s))                  return 'Commercial';
  if (/single|sfr|sfh|residential|res\.|fix.?and.?flip|fix.?flip|\bflip\b|house|home/.test(s))  return 'Single-family (1-4 units)';
  return 'Other';
}

/* occupancy → form option (exact): Vacant / Leased / Owner-occupied.
 * (Options have no value attribute, so the option text IS the value.) */
function Pipeline_mapOccupancy_(occ) {
  var s = String(occ || '').toLowerCase();
  if (!s) return '';
  if (/owner/.test(s) && !/non/.test(s))               return 'Owner-occupied';
  if (/vacant|empty/.test(s))                          return 'Vacant';
  if (/lease|tenant|rent|occupied|non.?owner/.test(s)) return 'Leased';
  return '';   // unrecognized → borrower picks
}

/* FICO → creditBand, matching the form's exact band strings (NOTE: en-dashes). */
function Pipeline_mapFico_(fico) {
  var s = String(fico || '').trim();
  if (!s) return '';
  var m = s.match(/\d{3}/);
  if (!m) return /below|under|poor/.test(s.toLowerCase()) ? 'Below 640' : '';
  var n = parseInt(m[0], 10);
  if (n >= 760) return '760+';
  if (n >= 720) return '720\u2013759';
  if (n >= 700) return '700\u2013719';
  if (n >= 680) return '680\u2013699';
  if (n >= 660) return '660\u2013679';
  if (n >= 640) return '640\u2013659';
  return 'Below 640';
}

/* borrower-friendly program word for the invite */
function Pipeline_friendlyProgram_(loanPurpose) {
  switch (String(loanPurpose || '')) {
    case 'Cash-Out Refinance':     return 'cash-out refi';
    case 'Refinance':              return 'refinance';
    case 'Purchase':               return 'purchase';
    case 'Fix & Flip':             return 'fix & flip';
    case 'Rental / DSCR':          return 'rental (DSCR)';
    case 'Ground-Up Construction': return 'construction';
    case 'Bridge':                 return 'bridge';
    case 'Land':                   return 'land';
    default:                       return 'loan';
  }
}

function Pipeline_firstName_(name) {
  var s = String(name || '').trim();
  return s ? s.split(/\s+/)[0] : '';
}
function Pipeline_numStr_(v) {
  if (v == null) return '';
  var n = String(v).replace(/[^0-9.]/g, '');
  return n || '';
}

/* =========================================================================
 * TEST RUNNER  — invite the borrower on INVITE_TEST_ROW (draft-only)
 * ========================================================================= */
function Pipeline_testInvite() {
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  var vals = sh.getDataRange().getValues(), H = vals[0];
  if (INVITE_TEST_ROW < 2 || INVITE_TEST_ROW > vals.length) { Logger.log('Set INVITE_TEST_ROW to a valid data row (2..%s).', vals.length); return; }
  var d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[INVITE_TEST_ROW - 1][i];

  Logger.log('Deal row %s: %s  (%s)', INVITE_TEST_ROW, d.DealID, d.AssembledAddress || d.City);
  var pf = Pipeline_mapDealToApp_(d);
  Logger.log('Mapped  purpose=%s | type=%s | occ=%s | fico=%s | loan=%s | value=%s | rent=%s | email=%s',
    pf.loanPurpose, pf.propertyType, pf.occupancy, pf.creditBand, pf.loanAmount, pf.marketValue, pf.monthlyRent, pf.email);
  if (pf._flag) Logger.log('FLAG: %s', pf._flag);
  if (!pf.email) { Logger.log('No BorrowerEmail on this row — put an email in that cell and re-run.'); return; }

  var res = Pipeline_inviteBorrower(pf);
  Logger.log('Result: %s', JSON.stringify(res));
  Logger.log('\u2192 Open Gmail \u25b8 Drafts to review the invite to %s. Nothing was sent.', pf.email);
}

/* =========================================================================
 * UTILITY — dump the form's <select> options (run once, paste me the log)
 * ========================================================================= */
function Pipeline_dumpFormOptions() {
  var raw = HtmlService.createTemplateFromFile('Index').getRawContent();
  ['propertyType','occupancy','creditBand'].forEach(function (field) {
    Logger.log('===== ' + field + ' =====');
    var m = raw.match(new RegExp('<select[^>]*(?:id|name)\\s*=\\s*["\\\']' + field + '["\\\'][\\s\\S]*?</select>', 'i'));
    if (!m) { Logger.log('  (no <select> named "' + field + '" — may be built by JS)'); return; }
    var opts = m[0].match(/<option[^>]*>[\s\S]*?<\/option>/gi) || [];
    if (!opts.length) Logger.log('  (select found, but options look JS-built)');
    opts.forEach(function (o) {
      var val = (o.match(/value\s*=\s*["\']([^"\']*)["\']/i) || ['',''])[1];
      Logger.log('  value="%s"  label="%s"', val, o.replace(/<[^>]+>/g, '').trim());
    });
  });
}


/* =========================================================================
 * EMAIL #2 — Deal-fit clarifying questions (hybrid: rules find the gaps,
 * Gemini writes the standout questions). Drafted for DK's review; never
 * auto-sends. Lives beside the loan-app invite; does NOT touch it.
 * Reads GEMINI_KEY (and optional GEMINI_MODEL) from Script Properties.
 * ========================================================================= */

function Pipeline_titleCase_(t) {
  return String(t || '').replace(/\w[^\s-]*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
}
function Pipeline_friendlyType_(loanType, cat) {
  var map = { cashout:'cash-out refinance', refi:'refinance', dscr:'DSCR rental loan',
    fixflip:'fix & flip', groundup:'ground-up construction loan', bridge:'bridge loan',
    purchase:'purchase loan', land:'land loan', commercial:'commercial loan',
    multifamily:'multifamily loan', mixeduse:'mixed-use loan' };
  return map[cat] || (String(loanType || '').trim() ? String(loanType).trim().toLowerCase() : 'loan');
}

/* Deterministic facts + data-gaps for this deal (also the safe fallback). */
function Pipeline_dealFactsForQuestions_(d, sr) {
  function S(v){ return (v == null) ? '' : String(v).trim(); }
  var cat = sr.cat;
  var listVal = money_(d.MarketValue), apprVal = money_(d.AppraisedValue);
  var loan = money_(d.LoanAmount), rent = money_(d.MonthlyRent) || money_(d.MarketRent);
  var pd = {}; try { pd = d.PropData ? JSON.parse(d.PropData) : {}; } catch (e) { pd = {}; }
  // What the user already captured on the call (CallState) — treat as KNOWN, don't re-ask.
  var call = {}; try { call = d.CallState ? JSON.parse(d.CallState) : {}; } catch (e) { call = {}; }
  function cm(v){ return money_(v) || null; }
  var callPurchase = cm(call.purchase), callRehab = cm(call.rehabBudget), callArv = cm(call.arv);
  var occ = S(d.Occupancy) || S(call.occupancy);
  rent = rent || cm(call.monthlyRent);
  var purpose = S(d.LoanPurpose), psum = S(d.PropertySummary), exitp = S(d.ExitPlan), bdet = S(d.BorrowerDetails);
  var zoning = S(d.ZoningUse), lotSize = S(d.LotSize), bldg = S(d.BuildingSize);
  var blob = [purpose, psum, exitp, bdet].filter(Boolean).join(' ');
  var acres = parseFloat(d.LotAcres);
  if (!(acres > 0)) { var am = (lotSize + ' ' + blob).match(/(\d+(?:\.\d+)?)\s*-?\s*acre/i); if (am) acres = parseFloat(am[1]); }
  var addr = S(d.AssembledAddress) || (S(d.City) + (S(d.State) ? ', ' + S(d.State) : ''));
  var facts = {
    address: addr || 'the subject property',
    loanType: S(d.LoanType) || cat, category: cat,
    requestedLoan: loan || null, listingValue: listVal || null, appraisedValue: apprVal || null,
    estLTV: (sr.ltv ? Math.round(sr.ltv * 100) + '%' : null), capLTV: Math.round(sr.cap * 100) + '%',
    estDSCR: (sr.dscr ? sr.dscr.toFixed(2) : null), monthlyRent: rent || null,
    propertyType: S(d.PropertyType) || null, occupancy: occ || null,
    zoningUse: zoning || null, buildingSize: bldg || null, lotSize: lotSize || null,
    beds: (pd.beds != null ? pd.beds : null), baths: (pd.baths != null ? pd.baths : null),
    sqft: (pd.sqft != null ? pd.sqft : null),
    lotAcres: (acres > 0 ? acres : null), state: S(d.State) || sr.state || null,
    // captured on the call (already known):
    purchasePrice: callPurchase, rehabBudget: callRehab, arv: callArv,
    creditBand: S(call.fico) || null, borrowerExperience: S(call.tier) || null,
    rehabScope: S(call.rehabType) || null, targetTimeline: S(call.timeline) || null
  };
  var gaps = [];
  if (cat !== 'fixflip' && cat !== 'groundup' && !facts.listingValue && !facts.appraisedValue) gaps.push('Current as-is market value, and what that figure is based on');
  if ((cat === 'dscr' || cat === 'refi' || cat === 'cashout') && !facts.monthlyRent) gaps.push('Current or market monthly rent (needed for DSCR)');
  if (cat === 'cashout') gaps.push('Current loan payoff / existing lien balance, and the purpose of the cash-out');
  else if (cat === 'refi') gaps.push('Current loan payoff / existing lien balance');
  if (cat === 'fixflip') {
    if (!(facts.purchasePrice && facts.rehabBudget)) gaps.push('Purchase price or current basis, and the total rehab budget');
    if (!facts.arv) gaps.push('After-repair value (ARV) and the comps it is based on');
  }
  if (cat === 'groundup') {
    if (!(facts.purchasePrice && facts.rehabBudget)) gaps.push('Total construction / build budget and land cost');
    if (!facts.arv) gaps.push('Projected completed value and the build timeline');
  }
  if (!facts.occupancy) gaps.push('Occupancy — owner-occupied, tenant-occupied, or vacant');
  if (facts.beds == null && facts.baths == null && facts.sqft == null) gaps.push('Beds, baths, square footage, and overall condition');
  var flags = (sr.watchouts || []).slice();
  if (facts.lotAcres && facts.lotAcres >= 8) flags.push('Large lot (' + facts.lotAcres + ' acres) — confirm usable vs. raw land, the land-vs-improvement value split, and any outbuildings');
  if (/rural|agricultur|farm|\bag\b/i.test(zoning + ' ' + blob)) flags.push('Rural / agricultural signals in the zoning or listing notes — confirm zoning and whether lenders will lend on it');
  if (cat !== 'dscr' && /tenant|rental income|on-site tenant/i.test(blob)) flags.push('Listing mentions rental / tenant income — confirm leases and whether it underwrites as a rental');
  var narrative = [purpose ? ('Loan Purpose: ' + purpose) : '', psum ? ('Property Summary: ' + psum) : '', exitp ? ('Exit Plan: ' + exitp) : '', bdet ? ('Borrower Details: ' + bdet) : ''].filter(Boolean).join('\n').slice(0, 1600);
  return { facts: facts, gaps: gaps, flags: flags, narrative: narrative, dealType: facts.loanType };
}

function Pipeline_questionsSys_() {
  return [
    'You are a senior underwriter at ASAP Funding, a U.S. hard-money / private-money mortgage broker.',
    'Daniel Kim (Director) is emailing a borrower to decide quickly whether a deal fits BEFORE pulling a full document package. Write the clarifying questions Daniel should ask.',
    '',
    'Rules:',
    '- Voice: Daniel is direct, professional, warm but businesslike. Plain English with natural industry terms (DSCR, LTV, ARV, as-is value, FICO). No filler, no fluff, no over-explaining. Keep each question to one sentence.',
    '- Purpose: ONLY what is needed to judge fit at this screening stage. Do NOT request a full document package — no ID, mortgage statement, paystubs, tax returns, bank statements, or application forms.',
    '- CRITICAL: Treat every non-null field in DEAL FACTS as ALREADY KNOWN (the loan officer captured it on the call or from records). NEVER ask the borrower for anything already present there — e.g., if purchasePrice, rehabBudget, arv, monthlyRent, occupancy, or creditBand is filled in, do not ask for it.',
    '- Cover (a) the listed DATA GAPS, and (b) anything that STANDS OUT about this specific deal that a national hard-money / private lender would need clarified before quoting (unusual property, large acreage, zoning, condition, occupancy, value basis, payoff, etc.).',
    '- The borrower-written LISTING NOTES often bury the real risk (large acreage, rural / agricultural zoning, mixed land use, multiple tenants, land-heavy value, unusual exit). Read them and ask about anything a lender would need to confirm.',
    '- Reference the actual numbers / acreage / property type from the facts. Merge overlapping items. 4 to 8 questions maximum.',
    '- Also suggest 0 to 4 light supporting documents that would help confirm fit fast (e.g., current lease or rent roll, payoff statement, contractor bid, recent appraisal if one exists) — NOT the full package.',
    'Return ONLY JSON in this exact shape: {"questions":["..."],"docs":["..."]}. No markdown, no commentary.'
  ].join('\n');
}
function Pipeline_questionsUser_(facts, gaps, flags, narrative) {
  return 'DEAL FACTS:\n' + JSON.stringify(facts) +
    '\n\nDATA GAPS (still needed for this loan type):\n' + (gaps.length ? '- ' + gaps.join('\n- ') : '(none)') +
    '\n\nSCREENER + STANDOUT FLAGS:\n' + (flags.length ? '- ' + flags.join('\n- ') : '(none)') +
    '\n\nLISTING NOTES (verbatim from WorkingMoni — read carefully for anything that stands out):\n' + (narrative || '(none provided)');
}

/* Gemini caller — returns {ok, questions[], docs[]} or {ok:false, error}. */
function Pipeline_geminiQuestions_(sysText, userText) {
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
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 900 }
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
      var p = null;
      try { p = JSON.parse(t); } catch (e) { try { p = JSON.parse(String(t).replace(/```json|```/g, '').trim()); } catch (e2) { p = null; } }
      if (!p) return { bad: true };
      return { ok: true, questions: (p.questions || []).map(function (x) { return String(x).trim(); }).filter(Boolean), docs: (p.docs || []).map(function (x) { return String(x).trim(); }).filter(Boolean) };
    }
    var lastErr = 'unknown';
    for (var mi = 0; mi < models.length; mi++) {
      var r = call_(models[mi]);
      if (r.code === 200) { var out = parse_(r.text); if (out.ok) { out.model = models[mi]; return out; } lastErr = out.empty ? 'empty' : 'parse'; break; }
      lastErr = 'api_' + r.code;
      if (r.code === 429) break;                                  // rate limited — stop, don't burn more quota
      if (r.code === 503 || r.code === 500) {                     // transient overload — brief backoff on the same model
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

/* Rules-only fallback if Gemini is unavailable — turns gaps + flags into questions. */
function Pipeline_questionsFallback_(fg) {
  var qs = fg.gaps.map(function (g) {
    if (/as-is market value/i.test(g)) return 'What is the current as-is value of the property, and what is that based on (recent appraisal, comps, broker opinion)?';
    if (/monthly rent/i.test(g)) return 'What is the current or expected market rent for the property?';
    if (/cash-out/i.test(g)) return 'What is the current payoff on any existing loan, and what will the cash-out proceeds be used for?';
    if (/lien balance/i.test(g)) return 'What is the current payoff on the existing loan?';
    if (/rehab budget/i.test(g)) return 'What is your purchase price (or current basis) and total rehab budget?';
    if (/ARV/i.test(g)) return 'What is the expected after-repair value (ARV), and what comps support it?';
    if (/construction budget/i.test(g)) return 'What is the total construction budget and the land cost?';
    if (/completed value/i.test(g)) return 'What is the projected completed value and the build timeline?';
    if (/Occupancy/i.test(g)) return 'Is the property owner-occupied, tenant-occupied, or vacant?';
    if (/Beds, baths/i.test(g)) return 'Can you confirm the beds, baths, square footage, and overall condition?';
    return g + '?';
  });
  var f = fg.facts;
  if (f.lotAcres && f.lotAcres >= 8) qs.push('The property sits on ' + f.lotAcres + ' acres — how much is usable vs. raw land, what is the split between land and improvement value, and are there any outbuildings?');
  if (/rural|agricultur|farm/i.test((f.zoningUse || '') + ' ' + (fg.narrative || ''))) qs.push('Is the property zoned residential or agricultural, and is any portion used for farming or income-producing land?');
  var docs = [];
  if (/dscr|cashout|refi/.test(fg.facts.category)) docs.push('Current lease or rent roll (if tenant-occupied)');
  if (/cashout|refi/.test(fg.facts.category)) docs.push('Most recent mortgage payoff statement');
  if (/fixflip|groundup/.test(fg.facts.category)) docs.push('Contractor bid or itemized rehab/build budget');
  return { questions: qs, docs: docs };
}

/* Assemble the email body in DK's voice (signature is added at draft time). */
function Pipeline_assembleQuestionsBody_(first, typeLabel, addr, questions, docs) {
  var lines = [];
  lines.push(first ? (first + ',') : 'Hello,');
  lines.push('');
  lines.push('Reviewing your ' + typeLabel + ' on ' + addr + '. Before we can confirm it fits our criteria, I need a few quick details from you:');
  lines.push('');
  for (var i = 0; i < questions.length; i++) lines.push((i + 1) + '. ' + questions[i]);
  if (docs && docs.length) {
    lines.push('');
    lines.push('If you have them handy, a few items would help us move fast:');
    for (var j = 0; j < docs.length; j++) lines.push('\u2022 ' + docs[j]);
  }
  lines.push('');
  lines.push('Let me know if you have any questions.');
  return lines.join('\n');
}

/* DASHBOARD: build the clarifying-questions email for preview (no send). */
function pipeline_buildDealQuestions(dealId) {
  try {
    if (!dealId) return { ok: false, error: 'Missing deal id.' };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID'), d = null;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) { d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i]; break; }
    }
    if (!d) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var pf = Pipeline_mapDealToApp_(d);
    var email = String(d.BorrowerEmail || pf.email || '').trim();
    if (!email) return { ok: false, error: 'No borrower email on this deal \u2014 add it in the card\u2019s checklist first.' };
    var first = (pf.firstName && String(pf.firstName).trim()) || Pipeline_firstName_(String(d.BorrowerName || '')) || '';
    var sr = screenDeal(d);
    var fg = Pipeline_dealFactsForQuestions_(d, sr);
    var g = Pipeline_geminiQuestions_(Pipeline_questionsSys_(), Pipeline_questionsUser_(fg.facts, fg.gaps, fg.flags, fg.narrative));
    var questions, docs, source;
    if (g.ok && g.questions.length) { questions = g.questions; docs = g.docs; source = 'gemini'; }
    else { var fb = Pipeline_questionsFallback_(fg); questions = fb.questions; docs = fb.docs; source = 'rules' + (g.error ? ' (' + g.error + ')' : ''); }
    var typeLabel = Pipeline_friendlyType_(fg.dealType, sr.cat);
    var street = String(fg.facts.address).split(',')[0];
    var subject = street + ' \u2014 Quick Questions on Your ' + Pipeline_titleCase_(typeLabel);
    var body = Pipeline_assembleQuestionsBody_(first, typeLabel, fg.facts.address, questions, docs);
    return { ok: true, email: email, name: first, subject: subject, body: body, source: source, count: questions.length };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* DASHBOARD: commit the (possibly edited) questions email — 'draft' or 'send'. */
function pipeline_commitDealQuestions(dealId, subject, body, mode, sender) {
  try {
    if (!dealId) return { ok: false, error: 'Missing deal id.' };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
    if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0], cId = H.indexOf('DealID'), d = null;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cId]) === String(dealId)) { d = {}; for (var i = 0; i < H.length; i++) d[H[i]] = vals[r][i]; break; }
    }
    if (!d) return { ok: false, error: 'Deal not found.' };
    var email = String(d.BorrowerEmail || '').trim();
    if (!email) return { ok: false, error: 'No borrower email on this deal.' };
    subject = String(subject || '').trim() || 'A Few Questions on Your Loan';
    body = String(body || '').trim();
    if (!body) return { ok: false, error: 'The message is empty.' };
    sender = sender || 'daniel';
    var sig = Pipeline_senderSig_(sender);
    function esc(x){ return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    var htmlBody = '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2230;font-size:14px;line-height:1.55;max-width:680px;">' +
      esc(body).replace(/\n/g, '<br>') + '<br><br>' + sig.html + '</div>';
    var plain = body + '\n\n' + sig.plain;
    var opts = { cc: NOTIFY_CC, htmlBody: htmlBody, replyTo: sig.replyTo, name: sig.fromName };
    if (sender === 'daniel') {
      try { opts.inlineImages = { danielphoto: Utilities.newBlob(Utilities.base64Decode(DK_PHOTO_B64), 'image/jpeg', 'dk.jpg') }; } catch (e) {}
    }
    if (mode === 'send') {
      GmailApp.sendEmail(email, subject, plain, opts);
      var sOn = ''; try { sOn = Pipeline_stampDealDate_(dealId, 'QuestionsSentOn'); } catch (e) {}
      return { ok: true, mode: 'send', email: email, sender: sig.fromName, sentOn: sOn };
    }
    var dr = GmailApp.createDraft(email, subject, plain, opts);
    var dOn = ''; try { dOn = Pipeline_stampDealDate_(dealId, 'QuestionsDraftedOn'); } catch (e) {}
    return { ok: true, mode: 'draft', email: email, sender: sig.fromName, draftId: dr.getId(), draftedOn: dOn };
  } catch (err) { return { ok: false, error: String(err) }; }
}


/* Toggle the "Requested Loan Package" status for a deal (date-stamp on, clear off).
   Pure status flag — does not touch grading or the Loan Tracker. */
function pipeline_setPackageRequested(dealId, on) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('PackageRequested') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('PackageRequested').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var cell = sh.getRange(rowIdx + 1, H.indexOf('PackageRequested') + 1);
    if (on) { var now = new Date(); cell.setValue(now); return { ok: true, on: true, date: _pl_fmtDate_(now) }; }
    cell.setValue(''); return { ok: true, on: false };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Manually set/clear a deal's board lane (priority / fit / need / specialty).
   '' or 'auto' clears the override so the deal grades automatically again. */
function pipeline_setViewedMeta(dealId, field, value) {
  try {
    var COLS = { status: 'ViewedStatus', note: 'ViewedNote', recheck: 'RecheckDate' };
    var col = COLS[String(field || '').toLowerCase()];
    if (!col) return { ok: false, error: 'Unknown field: ' + field };
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf(col) < 0) { lastCol++; sh.getRange(1, lastCol).setValue(col).setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var cell = sh.getRange(rowIdx + 1, H.indexOf(col) + 1);
    if (col === 'RecheckDate') { cell.setNumberFormat('@'); }   // keep YYYY-MM-DD as plain text
    cell.setValue(value == null ? '' : String(value));
    return { ok: true, field: field, value: String(value == null ? '' : value) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function pipeline_setLaneOverride(dealId, lane) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var lastCol = sh.getLastColumn(); var H = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (H.indexOf('LaneOverride') < 0) { lastCol++; sh.getRange(1, lastCol).setValue('LaneOverride').setFontWeight('bold'); }
    var vals = sh.getDataRange().getValues(); H = vals[0];
    var cId = H.indexOf('DealID'), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) { if (String(vals[r][cId]) === String(dealId)) { rowIdx = r; break; } }
    if (rowIdx < 0) return { ok: false, error: 'Deal ' + dealId + ' not found.' };
    var clean = String(lane == null ? '' : lane).trim().toLowerCase();
    if (clean === 'auto') clean = '';
    var allow = { '': 1, 'priority': 1, 'fit': 1, 'need': 1, 'specialty': 1 };
    if (!allow[clean]) return { ok: false, error: 'Unknown lane: ' + lane };
    sh.getRange(rowIdx + 1, H.indexOf('LaneOverride') + 1).setValue(clean);
    return { ok: true, lane: clean };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Resolve the calculator's dealKey ('id:<DealID>' or a SourceURL) to a DealID,
   then set the lane override — lets the calculator save the category directly. */
function pipeline_setLaneOverrideByKey(dealKey, lane) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cUrl = H.indexOf('SourceURL');
    var key = String(dealKey == null ? '' : dealKey).trim();
    var idGuess = (key.indexOf('id:') === 0) ? key.slice(3) : '';
    var tailHex = (key.match(/([0-9a-f]{12,})\/?$/i) || [])[1] || '';   // DealID at the end of a WorkingMoni URL
    function norm(u){ return String(u || '').trim().replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\//, ''); }
    var keyN = norm(key);
    for (var r = 1; r < vals.length; r++) {
      var did = String(vals[r][cId] || '').trim();
      var url = (cUrl >= 0) ? String(vals[r][cUrl] || '').trim() : '';
      if ((idGuess && did === idGuess) ||
          (tailHex && did === tailHex) ||
          (keyN && url && norm(url) === keyN) ||
          (tailHex && url && url.toLowerCase().indexOf(tailHex.toLowerCase()) >= 0)) {
        return pipeline_setLaneOverride(did, lane);
      }
    }
    return { ok: false, error: 'Deal not found for key.' };
  } catch (err) { return { ok: false, error: String(err) }; }
}

/* Save edited "Key deal facts" back to Pipeline_Deals (called directly by the calculator). */
function pipeline_saveDealFacts(dealKey, factsJson) {
  try {
    var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB); if (!sh) return { ok: false, error: 'Pipeline_Deals tab not found.' };
    var vals = sh.getDataRange().getValues(), H = vals[0];
    var cId = H.indexOf('DealID'), cUrl = H.indexOf('SourceURL');
    var key = String(dealKey == null ? '' : dealKey).trim();
    var idGuess = (key.indexOf('id:') === 0) ? key.slice(3) : '';
    var tailHex = (key.match(/([0-9a-f]{12,})\/?$/i) || [])[1] || '';
    function norm(u){ return String(u || '').trim().replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\//, ''); }
    var keyN = norm(key), rowIdx = -1;
    for (var r = 1; r < vals.length; r++) {
      var did = String(vals[r][cId] || '').trim();
      var url = (cUrl >= 0) ? String(vals[r][cUrl] || '').trim() : '';
      if ((idGuess && did === idGuess) || (tailHex && did === tailHex) || (keyN && url && norm(url) === keyN) || (tailHex && url && url.toLowerCase().indexOf(tailHex.toLowerCase()) >= 0)) { rowIdx = r; break; }
    }
    if (rowIdx < 0) return { ok: false, error: 'Deal not found for key.' };
    var facts = {}; try { facts = JSON.parse(factsJson || '{}'); } catch (e) { return { ok: false, error: 'bad facts json' }; }
    var allow = { LoanAmount:1, LoanType:1, MarketValue:1, LienPosition:1, MonthlyRent:1, PropertyType:1, FICO:1, Occupancy:1, BuildingSize:1, LotSize:1 };
    var saved = [];
    Object.keys(facts).forEach(function(col){
      if (!allow[col]) return;
      var ci = H.indexOf(col); if (ci < 0) return;
      sh.getRange(rowIdx + 1, ci + 1).setValue(facts[col]);
      saved.push(col);
    });
    return { ok: true, saved: saved };
  } catch (err) { return { ok: false, error: String(err) }; }
}


/* ONE-CLICK DIAGNOSTIC — run this in the editor, then View ▸ Execution log.
   Tells you if the Gemini key works, which models it can use, and the exact
   error if a call fails. No redeploy needed; takes effect on Run. */
function pipeline_testGemini() {
  var out = { keyPresent: false, keyLen: 0, model: '', listHTTP: 0, modelsWithGenerate: [], genHTTP: 0, genOK: false, genError: '', sample: '' };
  try {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('GEMINI_KEY');
    out.keyPresent = !!key; out.keyLen = key ? String(key).length : 0;
    out.model = props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
    if (!key) { Logger.log('GEMINI TEST -> No key found in Script Properties named GEMINI_KEY. Add it under Project Settings -> Script Properties.'); return out; }
    var lr = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models',
      { method: 'get', muteHttpExceptions: true, headers: { 'x-goog-api-key': key } });
    out.listHTTP = lr.getResponseCode();
    if (out.listHTTP === 200) {
      var ld = JSON.parse(lr.getContentText() || '{}');
      out.modelsWithGenerate = (ld.models || [])
        .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
        .map(function (m) { return String(m.name || '').replace('models/', ''); });
    } else { out.listError = String(lr.getContentText()).slice(0, 300); }
    var gr = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + out.model + ':generateContent',
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with just the word OK.' }] }] }) });
    out.genHTTP = gr.getResponseCode();
    if (out.genHTTP === 200) {
      out.genOK = true;
      try { var gd = JSON.parse(gr.getContentText() || '{}'); out.sample = gd.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim().slice(0, 60); } catch (e) {}
    } else { out.genError = String(gr.getContentText()).slice(0, 350); }
  } catch (err) { out.genError = String(err); }
  Logger.log('GEMINI TEST ->\n' + JSON.stringify(out, null, 2));
  return out;
}
/* --- AI test helpers (safe to delete once everything is confirmed working) --- */
function pipeline_testGeminiQ() {
  var sys = Pipeline_questionsSys_();
  var user = 'DEAL FACTS:\n{"address":"885 Sternberger Rd, Jackson, OH","loanType":"cash-out refinance","lotAcres":77,"zoningUse":"Rural / Residential","monthlyRent":10000,"requestedLoan":950000}\n\nDATA GAPS:\n- current payoff and cash-out purpose\n\nLISTING NOTES:\nSingle-family residence on 77 acres in Jackson OH, ~$10,000/month rent from three on-site tenants, recent appraisal $1.5M, strong land-value component, exit via DSCR refinance.';
  var res = Pipeline_geminiQuestions_(sys, user);
  Logger.log('GEMINI-Q TEST -> ' + JSON.stringify(res, null, 2));
}
function pipeline_geminiRaw() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  ['gemini-2.5-flash', 'gemini-2.5-flash-lite'].forEach(function (m) {
    var resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent',
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }] }) });
    Logger.log('=== ' + m + ' === HTTP ' + resp.getResponseCode());
    Logger.log(resp.getContentText().slice(0, 700));
  });
}

function pipeline_TEST_lane(){
  var key = 'https://workingmoni.com/investors/6977eb2a4fb33d6d75e6e90d';
  Logger.log('Testing key: ' + key);
  var r = pipeline_setLaneOverrideByKey(key, 'specialty');
  Logger.log('Result: ' + JSON.stringify(r));
}function pipeline_TEST_headers(){
  var sh = ss_().getSheetByName(ASAP_CFG.DEALS_TAB);
  Logger.log(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].join(' | '));
}