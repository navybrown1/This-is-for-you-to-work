'use strict';
(function (root) {
  const USD = cents => cents == null ? null : Number((cents / 100).toFixed(2));
  const fmt = cents => cents == null ? 'Invalid amount' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const num = value => Number(value || 0).toLocaleString('en-US');
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '0%';
  const RULES = Object.freeze({T1:'Submitted after the deadline',T2:'Required receipt not confirmed',T3:'Meals over the daily limit',T4:'Hotel over the nightly limit',T5:'Airfare approval missing',T6:'Entertainment details or approval missing',T7:'Possible split purchase',T8:'Possible duplicate expense'});
  const DATA_RULES = Object.freeze({R1:'Amount needs correction',R2:'Category needs review',R3:'Employee reference needs review',R4:'Date needs correction',R5:'Dates are reversed',R6:'Hotel nights need correction',R7:'Fare class needs review',R8:'Receipt value needs review',R9:'Claim identifier or merchant missing',R10:'Claim ID repeated'});
  const JOBS = Object.freeze({analysis:{label:'Review brief',button:'Create review brief',prompt:'Create a prioritized review brief, with the most useful next checks.'},claim:{label:'Claim investigation',button:'Investigate selected claim',prompt:'Investigate this claim, explain each flag, and distinguish missing evidence from a confirmed violation.'},patterns:{label:'Pattern review',button:'Analyze claim patterns',prompt:'Compare the supplied duplicate, split-purchase, and meal groups. Explain plausible alternatives and targeted checks.'},outreach:{label:'Follow-up draft',button:'Draft evidence request',prompt:'Draft a respectful follow-up requesting only the documents or corrections needed for this claim. Use placeholders for recipients. Do not send the draft.'},question:{label:'Follow-up question'}});
  const text = (value, max = 100) => String(value == null ? '' : value).slice(0, max);
  const validNumber = value => Number.isFinite(value) ? value : null;
  function priorityRows(report) {
    return report.rows.filter(row => row.held && row.cents > 0).map(row => {
      const codes = [...new Set(row.flags.map(flag => flag.code))];
      const score = Math.log1p(row.cents / 100) * 6 + codes.length * 3 + (codes.includes('T8') ? 9 : 0) + (codes.includes('T5') ? 8 : 0) + (codes.includes('T6') ? 6 : 0) + (codes.includes('R3') ? 4 : 0);
      return { row, codes, score };
    }).sort((a,b) => b.score - a.score || b.row.cents - a.row.cents || a.row.index - b.row.index);
  }
  function safeClaim(row, settings = {}) {
    const codes = [...new Set(row.flags.map(flag => flag.code))];
    const fare = text(row.fareClass).trim().toLowerCase();
    const hotelCap = row.category === 'Hotel' && row.nights && Number.isFinite(settings.hotelNightLimit) ? Math.round(settings.hotelNightLimit * 100) * row.nights : null;
    const exactHotelCap = Number.isSafeInteger(hotelCap) ? hotelCap : null;
    const referenceFlag = row.flags.find(flag => flag.code === 'R3');
    const referenceLabels = {'Employee not in HR snapshot':'Unmatched employee reference','Conflicting employee records':'Conflicting HR records','Department missing':'Matched employee has no department'};
    return {
      claim_id: text(row.claimId, 60), source_row_number: row.rowNumber,
      category: text(row.category, 60), department: text(row.department, 70),
      amount_usd: USD(row.cents), status: row.held ? 'Hold for review' : 'No configured flags',
      is_refund: row.credit === true,
      policy_or_data_flags: codes,
      flag_definitions: codes.map(code => ({ code, label: RULES[code] || DATA_RULES[code] || 'Unrecognized check' })),
      facts: {
        positive_spend_checks_apply: row.cents != null && row.cents > 0,
        days_to_submit: validNumber(row.daysToSubmit),
        expense_date_valid: Boolean(row.expenseDate), submission_date_valid: Boolean(row.submitDate),
        receipt_status: row.receipt === 'Y' ? 'Marked attached, contents not verified' : row.receipt === 'N' ? 'Marked not attached' : row.receipt ? 'Unrecognized value' : 'Unknown (blank)',
        hotel_nights: validNumber(row.nights),
        nightly_amount_usd_rounded: row.category === 'Hotel' && row.nights && row.cents != null ? Number((row.cents / row.nights / 100).toFixed(2)) : null,
        hotel_total_policy_limit_usd: USD(exactHotelCap),
        hotel_total_over_policy_limit_usd: exactHotelCap != null && row.cents != null ? USD(Math.max(0,row.cents - exactHotelCap)) : null,
        hotel_comparison_basis: 'The local check compares total cents against nights × nightly cap. The displayed nightly average is rounded and must not override the total comparison.',
        attendee_count: validNumber(row.attendees),
        fare_class: ['economy','premium economy','business','first'].includes(fare) ? fare : 'Not supplied or unrecognized',
        approval_reference_present: Boolean(row.preapproval),
        employee_reference_has_hold: codes.includes('R3'),
        employee_reference_status: referenceFlag ? referenceLabels[referenceFlag.label] || 'Employee reference needs review' : 'Matched reference without an R3 hold',
        claim_identifier_present: Boolean(String(row.raw?.claim_id || '').trim()),
        merchant_present: Boolean(row.merchantKey)
      }
    };
  }
  function patternEvidence(report, selectedIndex, limit = 12) {
    const types = [ ['duplicates','T8','Same employee, date, normalized merchant, and signed amount. A match is not proof of duplicate reimbursement.'], ['splits','T7','Same employee, date, and normalized merchant; each positive claim is below the receipt threshold and the group reaches that threshold.'], ['meals','T3','Same employee and expense date; positive meal claims exceed the daily limit.'] ];
    const candidates = types.flatMap(([kind, code, basis]) => (report.groups[kind] || []).map((group, i) => ({ kind, code, basis, group, id:code+'-'+(i+1) })))
      .filter(item => selectedIndex == null || item.group.rowIndexes.includes(selectedIndex))
      .sort((a,b) => Math.abs(b.group.totalCents) - Math.abs(a.group.totalCents) || a.id.localeCompare(b.id));
    return { total:candidates.length, groups:candidates.slice(0, limit).map(item => ({
      group_id:item.id, rule:item.code, match_basis:item.basis, total_usd:USD(item.group.totalCents),
      total_claims:item.group.rowIndexes.length,
      members:item.group.rowIndexes.slice(0, 16).map(index => report.rows[index]).filter(Boolean).map(row => ({claim_id:text(row.claimId,60),source_row_number:row.rowNumber,amount_usd:USD(row.cents)})),
      members_omitted:Math.max(0,item.group.rowIndexes.length - 16)
    })) };
  }
  function byteLength(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(serialized).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(serialized, 'utf8');
    return unescape(encodeURIComponent(serialized)).length;
  }
  function buildEvidence(report, options = {}) {
    if (!report || !report.summary || !Array.isArray(report.rows)) throw new Error('Run a valid local review first.');
    const s = report.summary, ranked = priorityRows(report);
    const selectedDepartments = report.departments.slice(0, 16);
    const selectedIndex = options.scope === 'claim' && Number.isInteger(options.claimIndex) ? options.claimIndex : null;
    const selectedRow = selectedIndex == null ? null : report.rows.find(row => row.index === selectedIndex);
    if (options.scope === 'claim' && !selectedRow) throw new Error('Select a claim from the current review.');
    const selectedClaims = selectedRow ? [] : ranked.slice(0, 18);
    const dataRuleMap = new Map();
    report.rows.forEach(row => {
      [...new Set(row.flags.map(flag => flag.code))].filter(code => /^R(?:[1-9]|10)$/.test(code)).forEach(code => {
        dataRuleMap.set(code, (dataRuleMap.get(code) || 0) + 1);
      });
    });
    const patterns = patternEvidence(report, selectedIndex, options.mode === 'patterns' ? 16 : 8);
    const relatedIndexes = selectedRow ? [...new Set(selectedRow.flags.flatMap(flag => flag.relatedRows || []))].filter(index => index !== selectedRow.index) : [];
    const detailRows = selectedRow ? [selectedRow, ...relatedIndexes.slice(0, 24).map(index => report.rows[index]).filter(Boolean)] : selectedClaims.map(item => item.row);
    const evidence = {
      source:'Local deterministic policy checker; only the currently loaded files and settings',currency:'USD',
      scope:{type:selectedRow ? 'claim' : 'review',task:options.mode || 'analysis',selected_claim_id:selectedRow ? text(selectedRow.claimId,60) : null,selected_source_row_number:selectedRow ? selectedRow.rowNumber : null},
      policy_thresholds:{receipt_required_from_usd:report.settings.receiptLimit,meal_daily_limit_usd:report.settings.mealLimit,hotel_nightly_limit_usd:report.settings.hotelNightLimit,submit_within_days:report.settings.daysLimit,entertainment_approval_over_usd:report.settings.entertainmentLimit,split_minimum_claims:report.settings.splitMinClaims,duplicate_minimum_claims:report.settings.duplicateMinClaims},
      summary:{claims:s.claims,held:s.held,unflagged:s.noFlags,positive_claims:s.positiveClaims,refunds:s.credits,positive_submitted_usd:USD(s.positiveCents),refunds_usd:USD(s.creditCents),net_submitted_usd:USD(s.netCents),positive_value_on_hold_usd:USD(s.heldPositiveCents),held_share_percent:Number((100*s.held/Math.max(1,s.claims)).toFixed(1)),data_quality_hold_claims:s.dataHeld,policy_hold_claims:s.policyHeld,invalid_amount_claims:s.invalidAmounts},
      rules:Object.entries(report.ruleCounts).map(([code,count]) => ({code,label:RULES[code] || code,claims:count})),
      data_rules:[...dataRuleMap].sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true})).map(([code,claims]) => ({code,labels:[DATA_RULES[code]],claims})),
      evidence_coverage:{all_claims_in_aggregates:true,departments_total:report.departments.length,departments_included:selectedDepartments.length,departments_selection:'Up to 16 departments by positive held value. All departments remain included in review totals.',positive_held_claims_total:ranked.length,example_claims_included:selectedClaims.length,example_selection:selectedRow ? 'No unrelated priority examples are included in a selected-claim scope.' : 'Up to 18 positive held claims ordered by an amount-and-flag review heuristic, not a fraud score or a representative sample.',claim_details_included:detailRows.length,related_claims_total:relatedIndexes.length,related_claims_included:selectedRow ? detailRows.length-1 : 0,pattern_groups_in_scope:patterns.total,pattern_groups_included:patterns.groups.length,claim_detail_selection:selectedRow ? 'Selected claim plus up to 24 related claims identified by local rule matches. Selected claim is always included.' : 'Detailed policy facts for the selected priority examples only. Other claims are covered in aggregates; choose a claim to investigate it directly.'},
      departments:selectedDepartments.map(d => ({department:text(d.department,70),claims:d.claims,held:d.held,held_share_percent:Number((100*d.held/Math.max(1,d.claims)).toFixed(1)),positive_on_hold_usd:USD(d.heldPositiveCents),net_submitted_usd:USD(d.netCents)})),
      pattern_groups:{possible_duplicate_groups:report.groups.duplicates.length,possible_split_groups:report.groups.splits.length,meal_limit_groups:report.groups.meals.length},
      pattern_details:patterns.groups,
      data_quality:{blank_receipt_fields:report.quality.blankReceipts,required_receipts_blank:report.quality.blankReceiptsRequired,unmatched_employees:report.quality.unmatchedEmployees,unknown_categories:report.quality.unknownCategories,invalid_or_missing_dates:report.quality.invalidDates,reversed_dates:report.quality.reversedDates,positive_hotel_claims_missing_nights:report.quality.missingNights,positive_airfare_claims_missing_or_unrecognized_class:report.quality.missingFare,duplicate_claim_id_rows:report.quality.duplicateClaimIds,invalid_amounts:report.quality.invalidAmounts},
      example_priority_claims:selectedClaims.map(item => ({claim_id:text(item.row.claimId,60),source_row_number:item.row.rowNumber,category:text(item.row.category,60),department:text(item.row.department,70),amount_usd:USD(item.row.cents),policy_or_data_flags:item.codes})),
      claim_details:detailRows.map(row => safeClaim(row,report.settings)),
      boundaries:['Review summary totals always describe the full current review, even when a single claim is selected.','All dollar amounts are locally computed from supplied files, not independent verification.','Positive held value counts each flagged claim once. It is not loss, fraud, or the amount ultimately recoverable.','Rule counts and pattern groups overlap. Do not add them to estimate unique claims or lost money.','Refunds remain negative in totals. Positive-spend receipt, meal, hotel, airfare, entertainment, and split checks exclude refunds and zero-dollar claims. Applicable date, identity, category, and duplicate checks still run.','A receipt or approval reference being present does not verify its contents or validity.','Source identities, merchant names, raw descriptions, approval IDs, and full source files are not included.','Only source_row_number references present in this evidence may be cited. No automatic approval, denial, or communication is authorized.']
    };
    // Keep a guaranteed bounded payload without dropping the selected claim or full-review totals.
    while (byteLength(evidence) > 46000 && evidence.pattern_details.length) evidence.pattern_details.pop();
    while (byteLength(evidence) > 46000 && evidence.claim_details.length > 1) evidence.claim_details.pop();
    while (byteLength(evidence) > 46000 && evidence.example_priority_claims.length) evidence.example_priority_claims.pop();
    evidence.evidence_coverage.pattern_groups_included = evidence.pattern_details.length;
    evidence.evidence_coverage.claim_details_included = evidence.claim_details.length;
    evidence.evidence_coverage.example_claims_included = evidence.example_priority_claims.length;
    evidence.evidence_coverage.related_claims_included = selectedRow ? evidence.claim_details.length - 1 : 0;
    return evidence;
  }
  function localPriorities(report) {
    const s = report.summary, ranked = priorityRows(report).slice(0,3), leader = report.departments.find(d => d.heldPositiveCents > 0);
    const biggest = Object.entries(report.ruleCounts).sort((a,b) => b[1]-a[1]).find(([,count]) => count > 0);
    return {heldShare:pct(s.held,s.claims),heldValue:fmt(s.heldPositiveCents),dept:leader?.department || 'No held spend',deptValue:leader ? fmt(leader.heldPositiveCents) : '$0.00',deptShare:leader ? pct(leader.heldPositiveCents,s.heldPositiveCents) : '0%',signal:biggest ? biggest[0]+' · '+num(biggest[1])+' claims' : 'None identified',ranked:ranked.map(item => ({id:item.row.claimId,index:item.row.index,cents:item.row.cents,codes:item.codes}))};
  }
  function evidenceRows(evidence) {
    const refs = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (Number.isInteger(value.source_row_number)) refs.add(value.source_row_number);
      Object.values(value).forEach(item => { if (item && typeof item === 'object') { if (Array.isArray(item)) item.forEach(visit); else visit(item); } });
    }
    visit(evidence); return refs;
  }
  function boundedHistory(evidence, history, question = '') {
    const kept = history.slice(-6).map(item => ({role:item.role,content:String(item.content).slice(0,3000)}));
    // Leave room for the provider/model/key envelope and multi-byte text.
    while (kept.length && byteLength({evidence,history:kept,question}) > 65000) kept.splice(0,2);
    return kept;
  }
  function compactHistoryResponse(report) {
    const clip = (value, limit) => String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').slice(0,limit);
    // Keep the actual answer first. Truncating raw report JSON can omit it entirely.
    const compact = {
      answer:clip(report.answer,1600),
      headline:clip(report.headline,100),
      summary:clip(report.executive_summary,360),
      findings:(report.findings || []).slice(0,3).map(finding=>({
        title:clip(finding.title,80),
        action:clip(finding.action,140),
        evidence:clip(finding.evidence,160),
        source_rows:(finding.source_rows || []).filter(Number.isInteger).slice(0,8)
      })),
      next_steps:(report.next_steps || []).slice(0,3).map(step=>clip(step,100)),
      limitations:clip(report.limitations,180),
      context_note:'Shortened conversation record. Wording, findings, or source references may be omitted. Consult the full response and current evidence.'
    };
    let serialized = JSON.stringify(compact);
    while(serialized.length > 3000 && compact.findings.length > 1){compact.findings.pop();serialized=JSON.stringify(compact);}
    while(serialized.length > 3000 && compact.next_steps.length > 1){compact.next_steps.pop();serialized=JSON.stringify(compact);}
    if(serialized.length > 3000){
      compact.summary=clip(compact.summary,160);compact.headline=clip(compact.headline,60);compact.limitations=clip(compact.limitations,80);
      compact.findings.forEach(finding=>{finding.title=clip(finding.title,60);finding.action=clip(finding.action,90);finding.evidence=clip(finding.evidence,80);});
      serialized=JSON.stringify(compact);
    }
    // JSON escaping can expand quoted text. Reduce the answer last, keeping valid JSON.
    while(serialized.length > 3000 && compact.answer.length){
      compact.answer=clip(compact.answer,Math.max(0,compact.answer.length-Math.max(100,Math.ceil((serialized.length-3000)/2))));
      serialized=JSON.stringify(compact);
    }
    if(serialized.length > 3000){
      // Even unusual lone-surrogate text expands to at most six JSON characters per code unit.
      compact.answer=clip(report.answer,400);compact.headline='';compact.summary='';compact.findings=[];compact.next_steps=[];compact.limitations='';
      serialized=JSON.stringify(compact);
    }
    return serialized;
  }
  function reportMarkdown(data, meta) {
    const r = data.report;
    const safe = value => text(value,20000).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|:@\-]/g,'\\$&');
    const lines = ['# '+safe(r.headline),'','Generated: '+meta.generatedAt,'Provider: '+safe(data.provider || meta.provider),'Model: '+safe(data.model),'Workflow: '+safe(JOBS[meta.mode]?.label || meta.mode),'Scope: '+safe(meta.scope),'','## Review summary','',safe(r.executive_summary),''];
    if (r.answer) lines.push('## '+(meta.mode === 'outreach' ? 'Follow-up draft' : 'Answer'),'',safe(r.answer),'');
    r.findings.forEach((finding,i) => { lines.push('## '+(i+1)+'. '+safe(finding.title),'','Priority: '+safe(finding.severity),'',safe(finding.impact),'','Evidence: '+safe(finding.evidence),'','Next check: '+safe(finding.action)); if(finding.source_rows?.length) lines.push('Source CSV rows: '+finding.source_rows.join(', ')); lines.push(''); });
    lines.push('## Next steps','',...r.next_steps.map((step,i) => (i+1)+'. '+safe(step)),'','## Limits and provenance','',safe(r.limitations),'','AI generated this interpretation. Policy flags and amounts were calculated locally. A reviewer must verify recommendations against original evidence. Holds are not fraud findings or payment decisions.','','## Evidence coverage','', '```json',JSON.stringify(meta.evidence.evidence_coverage,null,2),'```','');
    return lines.join('\n');
  }
  const exports = {buildEvidence,localPriorities,priorityRows,safeClaim,patternEvidence,evidenceRows,boundedHistory,compactHistoryResponse,reportMarkdown,byteLength};
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  root.HarborlineAI = exports;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  if (!$('ai-provider')) return;
  const providers = root.HarborlineProviders || {};
  const state = {report:null,evidence:null,serial:0,controller:null,busy:false,history:[],result:null,connected:false,previewMode:'analysis'};
  function node(tag, content, className) { const element=document.createElement(tag); if(content!=null)element.textContent=String(content);if(className)element.className=className;return element; }
  function setStatus(message, error=false) { const element=$('ai-status');element.textContent=message;element.hidden=!message;element.className=error?'ai-feedback error':'ai-feedback';element.setAttribute('role',error?'alert':'status');if(error)element.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  function provider() { return providers[$('ai-provider').value] || {}; }
  function destination() { if($('ai-provider').value!=='custom')return provider().label || 'selected provider';try{return new URL($('ai-base-url').value).hostname;}catch{return 'your custom endpoint';} }
  function scopeLabel() { if(!state.evidence)return 'No reviewed data';const scope=state.evidence.scope;return scope.type==='claim' ? scope.selected_claim_id+' · source row '+scope.selected_source_row_number : 'Current review · '+num(state.report.summary.claims)+' claims'; }
  function setBusy(busy) { state.busy=busy;['ai-run','ai-ask','ai-test-connection'].forEach(id=>$(id).disabled=busy);$('ai-cancel').hidden=!busy;$('ai-panel').setAttribute('aria-busy',String(busy)); }
  function stopRequest() { state.serial++;if(state.controller)state.controller.abort();state.controller=null;setBusy(false); }
  function clearResult() { state.result=null;$('ai-output').replaceChildren();$('ai-output').hidden=true;$('ai-answer-empty').hidden=false;$('ai-export').disabled=true; }
  function clearConversation() { state.history=[];$('ai-thread').replaceChildren(); }
  function resetContext(message) { stopRequest();clearResult();clearConversation();$('ai-consent').checked=false;updateEvidence();if(message)setStatus(message); }
  function openConnection() { root.HarborlineUI?.showView?.('ai');$('ai-connection').open=true;$('ai-provider').focus(); }
  function priceNote() {
    const isFree=$('ai-provider').value==='openrouter' && ($('ai-model').value.trim()==='openrouter/free' || $('ai-model').value.trim().endsWith(':free'));
    $('ai-model-cost').textContent=isFree?'Free-model routing selected. Free-tier availability and limits still apply.':'This model may incur charges on your provider account. Check its pricing before sending.';
  }
  function updateProvider(clearKey=true) {
    if(clearKey){$('ai-key').value='';$('ai-key').type='password';$('ai-show-key').textContent='Show';$('ai-show-key').setAttribute('aria-pressed','false');}
    const p=provider();$('ai-model').value=p.model || '';$('ai-base-url').value=p.baseUrl || '';$('ai-base-wrap').hidden=$('ai-provider').value!=='custom';
    $('ai-provider-hint').textContent=p.hint || 'Enter the exact model ID supported by your API service.';$('ai-provider-badge').textContent=p.label || 'Custom';
    $('ai-key-link').hidden=!p.keyUrl;if(p.keyUrl){$('ai-key-link').href=p.keyUrl;$('ai-key-link').textContent='Get a '+p.label+' API key';}
    $('ai-key').placeholder='Paste your '+(p.label || 'provider')+' API key';state.connected=false;$('ai-connection-state').textContent='Not tested';priceNote();resetContext(clearKey?'Provider changed. Enter the matching key and review the new data destination.':'');
  }
  function populateClaims(preserve=true) {
    const existing=$('ai-claim-select').value, query=$('ai-claim-search').value.trim().toLowerCase();
    const rows=(state.report?.rows || []).filter(row=>[row.claimId,row.department,row.category].some(value=>String(value).toLowerCase().includes(query)));
    const select=$('ai-claim-select');select.replaceChildren();
    rows.forEach(row=>{const option=node('option',row.claimId+' · row '+row.rowNumber+' · '+fmt(row.cents)+' · '+row.department);option.value=String(row.index);select.append(option);});
    if(preserve && rows.some(row=>String(row.index)===existing))select.value=existing;
    else if(!query){const first=priorityRows(state.report || {rows:[]})[0]?.row;if(first)select.value=String(first.index);}
    select.disabled=!rows.length;$('ai-open-source').disabled=!rows.length;
    if(!rows.length){const option=node('option','No matching claims');option.value='';select.append(option);}
  }
  function updatePreview(mode=state.previewMode) {
    if(!state.evidence){$('ai-payload-preview').textContent='Run a local review to see the evidence.';return;}
    const question=mode==='question'?$('ai-question').value.trim():'';
    const preview={provider:$('ai-provider').value,model:$('ai-model').value.trim(),mode,question,evidence:state.evidence,history:boundedHistory(state.evidence,state.history,question)};
    if($('ai-provider').value==='custom')preview.baseUrl=$('ai-base-url').value.trim();
    $('ai-payload-preview').textContent=JSON.stringify(preview,null,2);
  }
  function updateEvidence() {
    const scope=$('ai-scope').value, mode=$('ai-mode').value;
    $('ai-claim-controls').hidden=scope!=='claim';
    $('ai-consent-text').textContent='Send the evidence shown below, my question, and up to 3 prior exchanges through this application to '+destination()+'. The evidence includes claim IDs, departments, amounts, policy facts, and source-row references. I have reviewed the preview and understand my API service may retain this data.';
    if(!state.report){state.evidence=null;$('ai-scope-summary').textContent='';updatePreview();return;}
    try{state.evidence=buildEvidence(state.report,{scope,claimIndex:$('ai-claim-select').value===''?null:Number($('ai-claim-select').value),mode});}
    catch(error){state.evidence=null;$('ai-scope-summary').textContent=error.message;updatePreview();return;}
    const e=state.evidence,c=e.evidence_coverage;
    $('ai-scope-summary').textContent=scopeLabel()+'. '+c.claim_details_included+' claim detail'+(c.claim_details_included===1?'':'s')+' and '+c.pattern_groups_included+' pattern groups included. Full-review totals cover every loaded claim.';
    updatePreview();
  }
  function selectMode(mode) {
    if(!JOBS[mode] || mode==='question')return;
    $('ai-mode').value=mode;state.previewMode=mode;$('ai-run').textContent=JOBS[mode].button;
    document.querySelectorAll('[data-ai-task]').forEach(button=>{const active=button.dataset.aiTask===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $('ai-scope').value=['claim','outreach'].includes(mode)?'claim':'review';
    resetContext('Ready for '+JOBS[mode].label.toLowerCase()+'. Review the evidence and allow sharing to continue.');
  }
  function investigate(index) {
    if(!state.report?.rows.some(row=>row.index===index))return;
    root.HarborlineUI?.showView?.('ai');$('ai-claim-search').value='';populateClaims(false);$('ai-claim-select').value=String(index);selectMode('claim');
    $('ai-scope-summary').scrollIntoView({block:'center',behavior:'smooth'});
  }
  function renderLocal(report) {
    const element=$('ai-local');element.replaceChildren();const priorities=localPriorities(report);
    const label=node('div',null,'ai-local-label');label.append(node('span','Start here','eyebrow'),node('strong','Calculated priorities'),node('small','Amount + flag heuristic. This is not AI or a fraud score.'));element.append(label);
    priorities.ranked.forEach((item,index)=>{const button=node('button',null,'ai-priority-card');button.type='button';button.append(node('span',String(index+1).padStart(2,'0'),'ai-priority-number'),node('strong',item.id),node('span',fmt(item.cents),'ai-priority-amount'),node('small',item.codes.join(' · ')+' · Investigate ↗'));button.addEventListener('click',()=>investigate(item.index));element.append(button);});
    if(!priorities.ranked.length)element.append(node('p','No positive claims currently held. You can still investigate any loaded claim.','muted'));
  }
  function invalidate() {
    stopRequest();state.report=null;state.evidence=null;clearResult();clearConversation();$('ai-question').value='';$('ai-local').replaceChildren();$('ai-consent').checked=false;$('ai-review-tools').hidden=true;$('ai-no-data').hidden=false;populateClaims(false);updateEvidence();setStatus('');
  }
  function reportReady(report) {
    stopRequest();state.report=report;clearResult();clearConversation();$('ai-question').value='';$('ai-consent').checked=false;$('ai-claim-search').value='';populateClaims(false);$('ai-review-tools').hidden=false;$('ai-no-data').hidden=true;renderLocal(report);updateEvidence();setStatus('Evidence is ready. Choose the job, review what will be shared, and allow sharing when you are ready.');
  }
  function addParagraph(parent,content,className) {if(content)parent.append(node('p',content,className));}
  function displayAI(data,meta) {
    const out=$('ai-output');out.replaceChildren();const r=data.report;
    const top=node('div',null,'ai-result-title');top.append(node('span','AI interpretation','eyebrow'),node('h3',r.headline));out.append(top);
    addParagraph(out,r.executive_summary,'ai-executive-summary');
    if(r.answer){out.append(node('h4',meta.mode==='outreach'?'Draft for your review':'Answer'));addParagraph(out,r.answer,'ai-answer-text');}
    const allowed=evidenceRows(meta.evidence),rowsBySource=new Map(state.report.rows.map(row=>[row.rowNumber,row]));
    if(r.findings.length){out.append(node('h4','Evidence and next checks'));const findings=node('div',null,'ai-findings');r.findings.forEach(finding=>{
      const card=node('article',null,'ai-finding');const head=node('div',null,'ai-find-header');head.append(node('strong',finding.title),node('span',finding.severity,'ai-severity '+(['high','medium','low'].includes(finding.severity)?finding.severity:'medium')));card.append(head);
      addParagraph(card,finding.impact);addParagraph(card,'Evidence: '+finding.evidence,'ai-finding-evidence');addParagraph(card,'Next check: '+finding.action,'ai-finding-action');
      const refs=node('div',null,'ai-source-links');[...new Set(finding.source_rows || [])].filter(source=>allowed.has(source)&&rowsBySource.has(source)).forEach(source=>{const row=rowsBySource.get(source);const button=node('button',row.claimId+' · row '+source,'ai-source-link');button.type='button';button.addEventListener('click',()=>root.HarborlineUI?.showClaim?.(row.index));refs.append(button);});if(refs.childElementCount)card.append(refs);findings.append(card);
    });out.append(findings);}
    if(r.next_steps.length){out.append(node('h4','Next steps'));const list=node('ol',null,'ai-next-steps');r.next_steps.forEach(step=>list.append(node('li',step)));out.append(list);}
    addParagraph(out,r.limitations,'ai-caveat');addParagraph(out,'Generated by '+(providers[data.provider]?.label || data.provider || provider().label)+' · '+data.model+' · '+scopeLabel()+'. Verify judgments against the source claims.','ai-meta');
    if(data.usage)addParagraph(out,num(data.usage.input_tokens)+' input tokens · '+num(data.usage.output_tokens)+' output tokens. Charges and limits follow the selected provider and model.','ai-meta');
    out.hidden=false;$('ai-answer-empty').hidden=true;$('ai-export').disabled=false;state.result={data,meta};
  }
  function recordExchange(prompt,data,mode) {
    const response=compactHistoryResponse(data.report);state.history.push({role:'user',content:prompt.slice(0,1200)},{role:'assistant',content:response});state.history=state.history.slice(-6);
    if(mode==='question'){const turn=node('article',null,'ai-turn');turn.append(node('span','You','eyebrow'),node('p',prompt),node('span','AI response','eyebrow'),node('p',data.report.answer || data.report.executive_summary));$('ai-thread').append(turn);while($('ai-thread').childElementCount>3)$('ai-thread').firstElementChild.remove();}
    updatePreview();
  }
  async function requestAI(mode) {
    if(state.busy)return;
    const connection=mode==='connection';const key=$('ai-key').value.trim();
    if(!key){$('ai-connection').open=true;$('ai-key').focus();setStatus('Enter the API key issued by '+destination()+'.',true);return;}
    const model=$('ai-model').value.trim();if(!model){$('ai-connection').open=true;$('ai-model').focus();setStatus('Enter a model ID supported by your selected provider.',true);return;}
    const question=mode==='question'?$('ai-question').value.trim():'';
    if(!connection && !state.evidence){setStatus('Load and review both CSV files, then select valid evidence for this request.',true);return;}
    if(mode==='question'&&!question){$('ai-question').focus();setStatus('Enter a question about the selected evidence.',true);return;}
    if(!connection&&!$('ai-consent').checked){$('ai-consent').focus();setStatus('Review the evidence preview and allow data sharing with '+destination()+' before sending.',true);return;}
    if(location.protocol==='file:'){setStatus('Open the deployed Harborline app to make AI requests.',true);return;}
    const payload={provider:$('ai-provider').value,apiKey:key,model,mode};if(payload.provider==='custom')payload.baseUrl=$('ai-base-url').value.trim();
    if(!connection){payload.question=question;payload.evidence=state.evidence;payload.history=boundedHistory(state.evidence,state.history,question);state.previewMode=mode;updatePreview(mode);}
    stopRequest();const requestId=state.serial,controller=new AbortController();state.controller=controller;setBusy(true);
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},65000);
    setStatus(connection?'Testing the selected provider and model. No claim data is included.':'Working on '+(JOBS[mode]?.label || 'your request').toLowerCase()+'. You can cancel this request.');
    try{
      const response=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',signal:controller.signal,body:JSON.stringify(payload)});
      let data;try{data=await response.json();}catch{throw new Error('The AI service returned an unreadable response. Try again or check your provider configuration.');}
      if(requestId!==state.serial)return;if(!response.ok)throw new Error(data.error || 'The AI request could not be completed.');
      if(connection){if(data.connected!==true)throw new Error('The connection could not be verified.');state.connected=true;$('ai-connection-state').textContent='Connected · '+data.model;setStatus('Connection verified with '+destination()+' using '+data.model+'. No claims data was sent.');}
      else{
        if(!data.report || !Array.isArray(data.report.findings) || !Array.isArray(data.report.next_steps))throw new Error('The AI response was incomplete. No result was accepted.');
        const meta={mode,scope:scopeLabel(),provider:payload.provider,generatedAt:new Date().toISOString(),evidence:payload.evidence};displayAI(data,meta);recordExchange(mode==='question'?question:JOBS[mode].prompt+' Scope: '+meta.scope,data,mode);setStatus('Analysis complete. Open the cited source claims and verify the proposed next steps.');
      }
    }catch(error){if(requestId===state.serial){if(timedOut)setStatus('The request timed out. Your previous completed result is still available. Try again when your provider is ready.',true);else if(error.name!=='AbortError')setStatus(error.message || 'AI analysis could not be completed.',true);}}
    finally{clearTimeout(timeout);if(requestId===state.serial){state.controller=null;setBusy(false);}}
  }
  Object.entries(providers).forEach(([id,p])=>{const option=node('option',p.label);option.value=id;$('ai-provider').append(option);});$('ai-provider').value='openrouter';
  $('ai-provider').addEventListener('change',()=>updateProvider(true));
  ['ai-model','ai-base-url'].forEach(id=>$(id).addEventListener('input',()=>{state.connected=false;$('ai-connection-state').textContent='Not tested';priceNote();resetContext('Connection settings changed. Review the destination and allow sharing again.');}));
  $('ai-key').addEventListener('input',()=>{state.connected=false;$('ai-connection-state').textContent='Not tested';stopRequest();clearConversation();$('ai-consent').checked=false;updatePreview();setStatus('API key changed. Any pending request was canceled. Test this connection or review the data-sharing consent before continuing.');});
  $('ai-connect-open').addEventListener('click',openConnection);$('ai-import-open').addEventListener('click',()=>root.HarborlineUI?.showView?.('import'));
  $('ai-show-key').addEventListener('click',()=>{const visible=$('ai-key').type==='password';$('ai-key').type=visible?'text':'password';$('ai-show-key').textContent=visible?'Hide':'Show';$('ai-show-key').setAttribute('aria-pressed',String(visible));});
  $('ai-clear-key').addEventListener('click',()=>{$('ai-key').value='';$('ai-key').type='password';$('ai-show-key').textContent='Show';$('ai-show-key').setAttribute('aria-pressed','false');state.connected=false;$('ai-connection-state').textContent='Key cleared';resetContext('API key cleared from this page.');});
  $('ai-test-connection').addEventListener('click',()=>requestAI('connection'));$('ai-run').addEventListener('click',()=>requestAI($('ai-mode').value));$('ai-ask').addEventListener('click',()=>requestAI('question'));
  $('ai-cancel').addEventListener('click',()=>{stopRequest();setStatus('Request canceled. No new result was accepted. Your provider may already have processed part of the request.');});
  $('ai-question').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();requestAI('question');}});$('ai-question').addEventListener('input',()=>updatePreview('question'));
  $('ai-scope').addEventListener('change',()=>{if($('ai-scope').value==='review'&&['claim','outreach'].includes($('ai-mode').value))selectMode('analysis');else resetContext('Evidence scope changed. Review and allow sharing of the updated evidence.');});
  $('ai-claim-search').addEventListener('input',()=>{const previous=$('ai-claim-select').value;populateClaims(true);if(previous!==$('ai-claim-select').value)resetContext('Selected claim changed. Review its evidence before sending.');});
  $('ai-claim-select').addEventListener('change',()=>resetContext('Selected claim changed. Review its evidence before sending.'));
  $('ai-open-source').addEventListener('click',()=>{if($('ai-claim-select').value!=='')root.HarborlineUI?.showClaim?.(Number($('ai-claim-select').value));});
  document.querySelectorAll('[data-ai-task]').forEach(button=>button.addEventListener('click',()=>selectMode(button.dataset.aiTask)));
  document.querySelectorAll('[data-ai-prompt]').forEach(button=>button.addEventListener('click',()=>{$('ai-question').value=button.dataset.aiPrompt;$('ai-question').focus();updatePreview('question');}));
  $('ai-new-thread').addEventListener('click',()=>{stopRequest();clearConversation();clearResult();updatePreview();setStatus('Conversation cleared. The current evidence scope is unchanged.');});
  $('ai-export').addEventListener('click',()=>{if(!state.result)return;const result=state.result;const blob=new Blob([reportMarkdown(result.data,result.meta)],{type:'text/markdown;charset=utf-8'});const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download='Harborline_'+result.meta.mode+'_'+result.meta.generatedAt.slice(0,10)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  document.addEventListener('harborline:invalidated',invalidate);document.addEventListener('harborline:completed',event=>reportReady(event.detail.report));document.addEventListener('harborline:investigate',event=>investigate(event.detail.index));
  root.addEventListener('pagehide',()=>{
    stopRequest();$('ai-key').value='';$('ai-key').type='password';$('ai-show-key').textContent='Show';$('ai-show-key').setAttribute('aria-pressed','false');
    state.connected=false;$('ai-connection-state').textContent='Key cleared';$('ai-consent').checked=false;clearConversation();updatePreview();
    setStatus('The API key was cleared when you left this page. Reconnect before requesting AI.');
  });
  root.HarborlineAI={...exports,openConnection,investigate};updateProvider(false);updateEvidence();
})(typeof window !== 'undefined' ? window : globalThis);
