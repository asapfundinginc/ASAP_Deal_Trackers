/**
 * ASAP Funding — Import-time Deal Screener  (Pipeline_Screen.gs)
 * Grades every scraped WorkingMoni deal into ONE of four board columns —
 * Priority / Fit / Needs-data / Specialty-Hold — using FREE analysis only:
 * structured fields + the scenario-library hard-stops + a Gemini metrics read.
 * NO RentCast. Anchored to Easy Street (EasyFix / EasyRent) guidelines.
 *
 * APPROVE-EVERYTHING MODE (2026-06): per DK, EVERY property type, location, and
 * loan type is approved. Hard-stops are disabled and the screener NEVER routes
 * to "Specialty-Hold". Deals now land only in Priority / Fit / Needs-data, so
 * nothing is blocked on acreage/rural, unusual property type, lien position,
 * loan type, or a core number being outside the easy box. The grading below is
 * kept only as helpful triage (which lane / what is still missing) — it no
 * longer rejects or holds anything.
 *
 * NOTE: this screener runs AFTER a deal is imported, to grade it. If a deal is
 * being rejected at UPLOAD time (never reaching the board), that knockout lives
 * in the upload handler (pipeline_uploadDeals), not here.
 *
 * ENTRY POINT:  pipeline_screenDeal(d [, opts])  ->  routing object:
 *   { column, confidence, chaseScore, oneLine, killers[], missing[], metrics{} }
 *
 * WIRING (one place): wherever the import currently sets d.decision, add:
 *   var s = pipeline_screenDeal(d);
 *   d.column = s.column; d.chaseScore = s.chaseScore; d.screen = s;
 * and have the board read d.column / d.chaseScore.
 *
 * COST: the COLUMN is decided deterministically (free). Gemini is only called
 * to write the plain-English one-line and catch extra nuance. Pass {ai:false}
 * to skip Gemini entirely.
 *
 * Gemini key: Script Properties -> GEMINI_KEY (same one the rest of the app uses).
 */

// ===== LOCKED THRESHOLDS (Easy Street) — single source of truth =====
var SCREEN_CFG = {
  ltcGreen: 93, ltcAmber: 95,            // fix & flip loan-to-cost (%)
  arvGreen: 70, arvAmber: 75,            // LTARV (%)
  dscrGreen: 1.00, dscrFloor: 0.75,      // >=green green; floor..green amber; <floor red
  ltvPurchGreen: 80, ltvCashoutGreen: 75,// DSCR LTV caps (%)
  ltvCommGreen: 70, ltvCommAmber: 75,    // commercial / MF (5+) / mixed-use LTV cap (%)
  dscrCommGreen: 1.20, dscrCommFloor: 1.00, // commercial / MF DSCR comfort (income property)
  ficoGreen: 620, ficoFloor: 600,        // >=green standard; floor..green credit-light; <floor exception
  loanFloor: 75000,                      // Easy Street minimum loan
  acresHard: 10,                         // acres above this -> (formerly Specialty-Hold; now approved)
  tol: { fico: 15, ltv: 3, dscr: 0.05, loanPct: 0.10 } // your library's near-miss bands
};

// ---------- small helpers ----------
function _num(v){ if(v==null) return null; var n=parseFloat(String(v).replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; }
function _has(v){ return _num(v)!=null; }
function _type(d){
  var s=String(d.type||d.cat||d.purpose||'').toLowerCase();
  var pc=String(d.propClass||'').toLowerCase();
  var both=s+' '+pc;
  // income-property classes (commercial / multifamily 5+ / mixed-use) underwrite on their own box
  if(/commercial|office|retail|industrial|self.?storage|warehouse/.test(both)) return 'commercial';
  if(/multi.?family|apartment|\b5\s*\+/.test(both)) return 'commercial';
  if(/mixed.?use|\bmixed\b/.test(both)) return 'commercial';
  if(/dscr|rent/.test(s)) return 'dscr';
  if(/refi|cash.?out/.test(s)) return 'refi';
  if(/purchase|flip|bridge|fix|rehab/.test(s)) return 'purchase';
  return 'unknown';
}
function _isCashout(d){ return /cash.?out/.test(String(d.purpose||d.type||'').toLowerCase()); }
function _union(a,b){ var out=[], seen={}; (a||[]).concat(b||[]).forEach(function(x){ var k=String(x).toLowerCase().replace(/\s+/g,' ').trim(); if(k&&!seen[k]){ seen[k]=1; out.push(String(x).trim()); } }); return out; }

// ---------- structurally-detectable hard-stops ----------
// DISABLED (2026-06): every property type, location, and lien position is
// approved per DK. No hard-stops are raised, so no deal is sent to
// Specialty-Hold on the basis of acreage/rural, unusual/hard-to-comp property
// type, or 2nd/3rd lien. The original checks are commented out below — restore
// them only if hard-stops are ever wanted again.
function Screen_hardStops_(d){
  return [];
  /* ---- former hard-stops (kept for reference; intentionally not run) ----
  var k=[];
  var lien=_num(d.lien);
  if((lien!=null && lien>=2) || /2nd|second|junior|3rd|third/.test(String(d.lien||'').toLowerCase()))
    k.push('2nd/3rd-lien / combined position (needs a CLTV lender)');
  var ac=_num(d.acres);
  if(ac!=null && ac>SCREEN_CFG.acresHard)
    k.push('Large acreage / rural (' + ac + ' ac) — beyond standard DSCR');
  var pc=String(d.propClass||'').toLowerCase();
  if(/\bland\b|mobile|cabin|fractional|co-?op|\btic\b|leasehold|ground.?lease|barndomin/.test(pc))
    k.push('Unusual / hard-to-comp property type (' + (d.propClass||'?') + ')');
  return k;
  ------------------------------------------------------------------------- */
}

// ---------- deterministic metric checks vs Easy Street box ----------
function Screen_metrics_(d){
  var t=_type(d), m={}, miss=[], amber=0, red=0;
  var loan=_num(d.loan), val=_num(d.value), arv=_num(d.appraised), fico=_num(d.fico);

  if(loan==null){ miss.push('loan amount'); }
  else if(loan < SCREEN_CFG.loanFloor*(1-SCREEN_CFG.tol.loanPct)){ m.loan='red'; red++; }
  else if(loan < SCREEN_CFG.loanFloor){ m.loan='amber'; amber++; }
  else m.loan='green';

  if(fico==null){ if(t!=='commercial') miss.push('FICO'); m.fico='unknown'; }   // commercial = asset/NOI-led, FICO not a gating blank
  else if(fico>=SCREEN_CFG.ficoGreen) m.fico='green';
  else { m.fico='amber'; amber++; }   // credit-light / asset-based — never a hard stop

  if(t==='dscr'){
    var dscr=_num(d.dscr), rent=_num(d.rent)||_num(d.marketRent), ltv=_num(d.ltv);
    if(dscr==null && rent==null){ miss.push('rent / DSCR'); m.dscr='unknown'; }
    else if(dscr!=null){
      if(dscr>=SCREEN_CFG.dscrGreen) m.dscr='green';
      else if(dscr>=SCREEN_CFG.dscrFloor-SCREEN_CFG.tol.dscr){ m.dscr='amber'; amber++; }
      else { m.dscr='red'; red++; }
    } else { miss.push('DSCR (have rent, need the payment)'); m.dscr='unknown'; }
    var cap=_isCashout(d)?SCREEN_CFG.ltvCashoutGreen:SCREEN_CFG.ltvPurchGreen;
    if(ltv==null){ if(val==null||loan==null) miss.push('value / LTV'); }
    else if(ltv<=cap) m.ltv='green';
    else if(ltv<=cap+SCREEN_CFG.tol.ltv){ m.ltv='amber'; amber++; }
    else { m.ltv='red'; red++; }
  } else if(t==='purchase'){
    if(!_has(d.rehab)) miss.push('rehab budget');           // rarely scraped -> flag, don't assume zero
    if(arv==null){ miss.push('ARV (after-repair value)'); }
    else if(loan!=null){
      var ltarv=loan/arv*100;
      if(ltarv<=SCREEN_CFG.arvGreen) m.arv='green';
      else if(ltarv<=SCREEN_CFG.arvAmber){ m.arv='amber'; amber++; }
      else { m.arv='red'; red++; }
    }
  } else if(t==='refi'){
    var rltv=_num(d.ltv), rcap=_isCashout(d)?SCREEN_CFG.ltvCashoutGreen:SCREEN_CFG.ltvPurchGreen;
    if(rltv==null){ if(val==null||loan==null) miss.push('value / LTV'); }
    else if(rltv<=rcap) m.ltv='green';
    else if(rltv<=rcap+SCREEN_CFG.tol.ltv){ m.ltv='amber'; amber++; }
    else { m.ltv='red'; red++; }
    if(_isCashout(d) && !_has(d.seasoning)) miss.push('seasoning (months owned)');
  } else if(t==='commercial'){
    // commercial / multifamily 5+ / mixed-use: own LTV cap (70%) + income (NOI/DSCR)
    var cltv=_num(d.ltv), cdscr=_num(d.dscr);
    if(cltv==null){ if(val==null||loan==null) miss.push('value / LTV'); }
    else if(cltv<=SCREEN_CFG.ltvCommGreen) m.ltv='green';
    else if(cltv<=SCREEN_CFG.ltvCommAmber){ m.ltv='amber'; amber++; }
    else { m.ltv='red'; red++; }
    if(cdscr!=null){
      if(cdscr>=SCREEN_CFG.dscrCommGreen) m.dscr='green';
      else if(cdscr>=SCREEN_CFG.dscrCommFloor){ m.dscr='amber'; amber++; }
      else { m.dscr='red'; red++; }
    } else {
      miss.push('NOI / rent roll (for commercial DSCR)');
    }
  } else {
    miss.push('loan type unclear');
  }
  m._amber=amber; m._red=red; m._type=t;
  return { metrics:m, missing:miss };
}

// ---------- column routing (approve everything; never Specialty-Hold) ----------
function Screen_route_(killers, mx){
  // Approve everything. Hard-stops are ignored, and no deal is ever routed to
  // Specialty-Hold. A deal missing a deciding field lands in Needs-data (still
  // shown, just flagged for follow-up); any other concern (higher-leverage
  // amber, or a core number outside the easy box) lands in Fit; a clean,
  // complete deal lands in Priority. Nothing is blocked on property, location,
  // lien, or loan type.
  if(mx.missing.length>0) return 'Needs-data';
  if(mx.metrics._amber>0 || mx.metrics._red>0) return 'Fit';
  return 'Priority';
}
function Screen_conf_(missing){ return missing.length===0?'High':(missing.length===1?'Medium':'Low'); }

// ---------- chase score (free, structured-data only): higher = work first ----------
function Screen_chaseScore_(d, mx){
  var s=100;
  (mx.missing||[]).forEach(function(f){
    if(/fico|season/i.test(f)) s-=8;                 // cheap to fill
    else if(/rehab|arv|value|rent|dscr/i.test(f)) s-=18; // expensive / multi-step
    else s-=12;
  });
  s -= (mx.metrics._amber||0)*6;
  var ltv=_num(d.ltv);
  if(ltv!=null){ if(ltv<=60) s+=10; else if(ltv<=70) s+=4; else if(ltv>80) s-=6; }
  var pc=String(d.propClass||'').toLowerCase();
  if(/sfr|single|1-4|duplex|triplex|fourplex|townhome|condo/.test(pc)) s+=6;
  else if(/5-10|multi|mixed|commercial/.test(pc)) s-=8;
  if(d.experience!=null && _num(d.experience)>=2) s+=6;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// ---------- the Gemini metrics-screen prompt ----------
var SCREEN_PROMPT = [
'You are a senior hard-money loan screener for ASAP Funding. You receive the structured fields for ONE deal scraped from WorkingMoni, an automated scenario-library scan, and the screener\'s own deterministic findings. There are NO borrower notes and NO title report at this stage — judge ONLY the metrics given, and treat every missing field explicitly.',
'',
'IMPORTANT POLICY: ASAP currently approves EVERY property type, location, and loan type. Do NOT mark anything "Specialty-Hold" and do NOT treat acreage/rural, unusual property type, lien position, or loan type as a reason to hold or decline. Choose only among "Priority", "Fit", and "Needs-data".',
'',
'Goal: decide which board column this deal belongs in, for an operation that funds the EASY deals first and simply needs to know what is still missing on the rest.',
'',
'Lender box (Easy Street EasyFix / EasyRent — the house standard, used for triage only):',
'- Fix & flip: LTC up to 93% (100% rehab). LTARV green <=70%, amber 70-75%.',
'- DSCR / rental: DSCR green >=1.00, amber 0.75-0.99, lower <0.75. LTV <=80% purchase / <=75% cash-out.',
'- FICO: >=620 standard; 600-619 credit-light/asset-based; below = exception (NOT a decline — these are asset-based loans).',
'- Commercial / multifamily (5+) / mixed-use: LTV <=70% (amber 70-75%); income-led, DSCR green >=1.20, amber 1.00-1.19; if NOI / rent roll is not given, treat it as a Needs-data item.',
'- Loan floor about $75,000 (informational only — do not hold a deal for being under it).',
'',
'Rules:',
'1. Never invent a missing number. If a value needed to judge the deal is blank, name it in missing_to_confirm and state the assumption you were forced to make in one_line. Missing data lowers confidence and CAPS the column at "Needs-data".',
'2. Never output "Specialty-Hold". Every property type, location, lien, and loan type is approved. Leave killers an empty array.',
'3. A core number that is outside the easy box at standard leverage simply lands in "Fit" (still approved), not held.',
'4. Column meanings: "Priority" = clean math, key fields present (fund first). "Fit" = approved and complete but leaning higher-leverage / amber, or a core number outside the easy box. "Needs-data" = missing a field that controls the call.',
'5. When unsure between Priority and Fit, choose Fit; when a deciding field is missing, choose Needs-data.',
'',
'Return ONLY this JSON (no markdown, no commentary):',
'{"column":"Priority|Fit|Needs-data","confidence":"High|Medium|Low","one_line":"<short plain-English reason, naming any assumption made>","killers":[],"missing_to_confirm":["<each blank field that affects the decision>"],"metrics_check":{"ltc":"<value or unknown>","ltarv_or_ltv":"<value or unknown>","dscr":"<value or unknown>","credit":"<band or not provided>","loan_size_ok":true}}'
].join('\n');

// ---------- Gemini call (mirrors Pipeline_QEmail.gs pattern) ----------
function Screen_gemini_(d, det){
  try{
    var props=PropertiesService.getScriptProperties();
    var key=props.getProperty('GEMINI_KEY');
    if(!key) return { ok:false, error:'no_key' };
    var primary=props.getProperty('GEMINI_MODEL')||'gemini-2.5-flash';
    var models=[primary]; ['gemini-flash-latest','gemini-2.5-flash-lite'].forEach(function(m){ if(models.indexOf(m)<0) models.push(m); });

    var userText=JSON.stringify({
      deal_fields:{
        loanType:d.type||d.cat||d.purpose||null, purpose:d.purpose||null,
        loanAmount:d.loan||null, asIsValue:d.value||null, arv:d.appraised||null,
        ltv:d.ltv||null, dscr:d.dscr||null, rent:(d.rent||d.marketRent||null),
        fico:d.fico||null, lien:d.lien||null, acres:d.acres||null,
        propertyClass:d.propClass||null, state:d.state||null, address:d.addrShort||null
      },
      scenario_flags:(d.nearMisses||d.flags||[]),
      deterministic_findings:{ killers:det.killers, missing:det.missing, metrics:det.metrics }
    });

    var payload=JSON.stringify({
      system_instruction:{ parts:[{ text:SCREEN_PROMPT }] },
      contents:[{ parts:[{ text:userText }] }],
      generationConfig:{ responseMimeType:'application/json', temperature:0.2, maxOutputTokens:1024, thinkingConfig:{ thinkingBudget:0 } }
    });

    function call_(model){
      var resp=UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',
        { method:'post', contentType:'application/json', muteHttpExceptions:true, headers:{ 'x-goog-api-key':key }, payload:payload });
      return { code:resp.getResponseCode(), text:resp.getContentText() };
    }
    function parse_(text){
      var data; try{ data=JSON.parse(text||'{}'); }catch(e){ return { bad:true }; }
      var t=''; try{ t=data.candidates[0].content.parts.map(function(p){ return p.text||''; }).join(''); }catch(e){ t=''; }
      if(!t) return { empty:true };
      var p=null, ts=String(t);
      try{ p=JSON.parse(ts); }
      catch(e){ try{ p=JSON.parse(ts.replace(/```json|```/g,'').trim()); }
        catch(e2){ try{ var a=ts.indexOf('{'), b=ts.lastIndexOf('}'); p=(a>=0&&b>a)?JSON.parse(ts.slice(a,b+1)):null; }catch(e3){ p=null; } } }
      if(!p) return { bad:true };
      return { ok:true, data:p };
    }

    var lastErr='unknown';
    for(var i=0;i<models.length;i++){
      var r=call_(models[i]);
      if(r.code===200){ var o=parse_(r.text); if(o.ok) return { ok:true, data:o.data }; lastErr=o.empty?'empty':'parse'; break; }
      lastErr='api_'+r.code;
      if(r.code===429) break;
      if(r.code===503||r.code===500){
        for(var a=1;a<=2;a++){
          Utilities.sleep(900*a);
          r=call_(models[i]);
          if(r.code===200){ var o2=parse_(r.text); if(o2.ok) return { ok:true, data:o2.data }; lastErr=o2.empty?'empty':'parse'; break; }
          lastErr='api_'+r.code;
          if(r.code!==503&&r.code!==500) break;
        }
        if(r.code===429) break;
      }
    }
    return { ok:false, error:lastErr };
  }catch(err){ return { ok:false, error:String(err) }; }
}

function Screen_fallbackLine_(col, killers, missing, mx){
  if(col==='Needs-data') return 'Approved — confirm: '+missing.join(', ')+'.';
  if(col==='Priority') return 'Clean and complete — fund-first.';
  return 'Approved and complete — amber on '+(mx.metrics._amber||0)+' metric(s).';
}

// ===== MAIN ENTRY =====
function pipeline_screenDeal(d, opts){
  d=d||{}; opts=opts||{};
  var killers=Screen_hardStops_(d);                 // disabled -> always []
  var mx=Screen_metrics_(d);
  var detColumn=Screen_route_(killers, { metrics:mx.metrics, missing:mx.missing });

  var useAI=(opts.ai!==false);                      // never skip on Specialty (none exist now)
  var oneLine='', aiMissing=[], aiConf=null, metricsOut=mx.metrics;
  if(useAI){
    var ai=Screen_gemini_(d, { killers:killers, missing:mx.missing, metrics:mx.metrics });
    if(ai.ok && ai.data){
      oneLine=String(ai.data.one_line||'').trim();
      if(Array.isArray(ai.data.missing_to_confirm)) aiMissing=ai.data.missing_to_confirm.filter(function(x){ return x; });
      if(ai.data.confidence) aiConf=ai.data.confidence;
      if(ai.data.metrics_check) metricsOut=ai.data.metrics_check;
    }
  }

  var allKillers=[];                                 // hard-stops disabled — every property/location/lien/loan type is approved
  var allMissing=_union(mx.missing, aiMissing);
  var column=Screen_route_(allKillers, { metrics:mx.metrics, missing:allMissing });
  var confidence=aiConf || Screen_conf_(allMissing);
  if(!oneLine) oneLine=Screen_fallbackLine_(column, allKillers, allMissing, mx);

  return {
    column: column,
    confidence: confidence,
    chaseScore: Screen_chaseScore_(d, { metrics:mx.metrics, missing:allMissing }),
    oneLine: oneLine,
    killers: allKillers,
    missing: allMissing,
    metrics: metricsOut
  };
}

// ===== one-click editor test (runs deterministically without a key) =====
function pipeline_testScreen(){
  var samples=[
    { id:'A easy DSCR',     type:'DSCR',           purpose:'Purchase',      loan:240000, value:320000, ltv:75, dscr:1.18, fico:712, propClass:'SFR',  acres:0.2, lien:1, state:'TX', addrShort:'123 Main St' },
    { id:'B F&F no rehab',  type:'Fix & Flip',     purpose:'Purchase',      loan:180000, value:150000, appraised:280000,      fico:690, propClass:'SFR',  lien:1 },
    { id:'C 2nd lien',      type:'DSCR',           purpose:'Cash-Out Refi', loan:300000, value:500000, ltv:60, dscr:1.05, fico:705, propClass:'SFR',  lien:2 },
    { id:'D 77-ac land',    type:'DSCR',           purpose:'Purchase',      loan:600000, value:900000, ltv:67, dscr:1.10, fico:720, propClass:'Land', acres:77, lien:1 },
    { id:'E sub-1 + no FICO',type:'DSCR',          purpose:'Purchase',      loan:240000, value:320000, ltv:75, dscr:0.92,            propClass:'SFR',  lien:1 }
  ];
  samples.forEach(function(d){
    var s=pipeline_screenDeal(d, { ai:false }); // ai:false so the test never needs the network
    Logger.log(d.id+'  ->  '+s.column+'  ('+s.confidence+', chase '+s.chaseScore+')  '+s.oneLine
      + (s.killers.length?('  KILLERS: '+s.killers.join(' | ')):'')
      + (s.missing.length?('  MISSING: '+s.missing.join(' | ')):''));
  });
}