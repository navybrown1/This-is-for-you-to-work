'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ai = require('../ai-insights.js');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script = html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)?.[0].replace(/<script>|<\/script>/g,'');
assert.ok(script, 'Finance checker script must be available');
const ctx={window:{},Intl,Date,console};vm.createContext(ctx);vm.runInContext(script,ctx);
const H=ctx.window.Harborline;
const employee=[{employee_id:'PRIVATE_EMPLOYEE_88',department:'Finance',office:'PRIVATE_OFFICE',level:'Director',cost_center:'PRIVATE_COST',name:'PRIVATE_PERSON_NAME'}];
const base={claim_id:'CLAIM-1',employee_id:'PRIVATE_EMPLOYEE_88',expense_date:'2026-09-01',submit_date:'2026-09-03',category:'Meals',merchant:'PRIVATE_MERCHANT_NAME',amount_usd:'49.50',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'PRIVATE_APPROVAL_TOKEN',attendees:'',description:'PRIVATE_RAW_DESCRIPTION'};
const sample=H.analyze([base,{...base,claim_id:'CLAIM-2'},{...base,claim_id:'REFUND-3',category:'Other',amount_usd:'-12.30'},{...base,claim_id:'INVALID-4',amount_usd:'INVALID_PRIVATE_AMOUNT',category:'UNRECOGNIZED_PRIVATE_CATEGORY',employee_id:'UNKNOWN_PRIVATE_EMPLOYEE',expense_date:'INVALID_PRIVATE_DATE',receipt_attached:'PRIVATE_RECEIPT_TOKEN',fare_class:'PRIVATE_FARE_TOKEN'}],employee,{});
const privateStrings=['PRIVATE_EMPLOYEE_88','PRIVATE_OFFICE','PRIVATE_COST','PRIVATE_PERSON_NAME','PRIVATE_MERCHANT_NAME','PRIVATE_APPROVAL_TOKEN','PRIVATE_RAW_DESCRIPTION','INVALID_PRIVATE_AMOUNT','UNRECOGNIZED_PRIVATE_CATEGORY','UNKNOWN_PRIVATE_EMPLOYEE','INVALID_PRIVATE_DATE','PRIVATE_RECEIPT_TOKEN','PRIVATE_FARE_TOKEN'];

test('every supported scope excludes raw private identities and unsupported fields',()=>{
 for (const options of [{},{mode:'patterns'},{scope:'claim',claimIndex:0,mode:'claim'},{scope:'claim',claimIndex:3,mode:'outreach'}]) {
  const evidence=ai.buildEvidence(sample,options),serialized=JSON.stringify(evidence);
  for(const secret of privateStrings)assert.ok(!serialized.includes(secret),'Leaked '+secret);
  for(const field of ['"employee_id"','"merchant"','"description"','"raw"','"preapproval_id"','"office"'])assert.ok(!serialized.includes(field),'Leaked field '+field);
 }
});

test('selected refunds and unflagged claims are available even outside priority examples',()=>{
 const evidence=ai.buildEvidence(sample,{scope:'claim',claimIndex:2,mode:'claim'});
 assert.equal(evidence.scope.selected_claim_id,'REFUND-3');assert.equal(evidence.claim_details[0].amount_usd,-12.3);
 assert.equal(evidence.claim_details[0].is_refund,true);assert.equal(evidence.claim_details[0].source_row_number,4);
 assert.equal(evidence.claim_details[0].facts.positive_spend_checks_apply,false);
 assert.equal(evidence.summary.claims,4);assert.equal(evidence.summary.net_submitted_usd,86.7);
 assert.ok(!evidence.example_priority_claims.some(row=>row.claim_id==='REFUND-3'));
 assert.equal(evidence.claim_details[0].facts.approval_reference_present,true);
});

test('invalid amounts stay null and do not turn into zero-dollar claims',()=>{
 const evidence=ai.buildEvidence(sample,{scope:'claim',claimIndex:3,mode:'claim'});
 assert.equal(evidence.claim_details[0].amount_usd,null);assert.equal(evidence.summary.invalid_amount_claims,1);
 assert.ok(evidence.claim_details[0].policy_or_data_flags.includes('R1'));
 assert.equal(evidence.claim_details[0].facts.expense_date_valid,false);
 assert.equal(evidence.claim_details[0].facts.receipt_status,'Unrecognized value');
});

test('a selected duplicate claim includes related rows and safe group comparison facts',()=>{
 const evidence=ai.buildEvidence(sample,{scope:'claim',claimIndex:0,mode:'claim'});
 assert.deepEqual(evidence.claim_details.map(row=>row.source_row_number),[2,3]);
 assert.equal(evidence.evidence_coverage.related_claims_total,1);assert.equal(evidence.evidence_coverage.related_claims_included,1);
 const duplicate=evidence.pattern_details.find(group=>group.rule==='T8');assert.ok(duplicate);
 assert.equal(duplicate.total_usd,99);assert.equal(duplicate.total_claims,2);
 assert.deepEqual(Array.from(duplicate.members,row=>row.source_row_number),[2,3]);
 assert.match(duplicate.match_basis,/not proof/i);
});

test('rule facts contain computable hotel and deadline evidence without raw source reasons',()=>{
 const report=H.analyze([{...base,category:'Hotel',amount_usd:'750.00',nights:'2',submit_date:'2026-11-04',receipt_attached:'N'}],employee,{});
 const evidence=ai.buildEvidence(report,{scope:'claim',claimIndex:0,mode:'claim'}),facts=evidence.claim_details[0].facts;
 assert.equal(facts.hotel_nights,2);assert.equal(facts.nightly_amount_usd_rounded,375);assert.equal(facts.days_to_submit,64);
 assert.equal(facts.receipt_status,'Marked not attached');assert.equal(evidence.policy_thresholds.hotel_nightly_limit_usd,300);
 assert.ok(evidence.claim_details[0].flag_definitions.find(rule=>rule.code==='T4'));
 assert.equal(facts.approval_reference_present,true);
});

test('large groups disclose their truncated membership and keep selected claim details',()=>{
 const rows=Array.from({length:120},(_,i)=>({...base,claim_id:'CLAIM-'+i}));
 const report=H.analyze(rows,employee,{}),evidence=ai.buildEvidence(report,{scope:'claim',claimIndex:119,mode:'patterns'});
 assert.equal(evidence.claim_details[0].claim_id,'CLAIM-119');assert.equal(evidence.evidence_coverage.related_claims_total,119);
 assert.equal(evidence.claim_details.length,25);assert.equal(evidence.evidence_coverage.related_claims_included,24);
 assert.ok(evidence.pattern_details.every(group=>group.total_claims===120 && group.members_omitted===104));
 assert.equal(evidence.summary.claims,120);assert.ok(ai.byteLength(evidence)<=46000);
});

test('multi-byte labels and many groups stay within provider evidence limits',()=>{
 const long='漢'.repeat(90),employees=Array.from({length:20},(_,i)=>({...employee[0],employee_id:'E'+i,department:long+i}));
 const rows=Array.from({length:120},(_,i)=>({...base,claim_id:long+i,employee_id:'E'+Math.floor(i/6),amount_usd:'49.50'}));
 const report=H.analyze(rows,employees,{}),evidence=ai.buildEvidence(report,{mode:'patterns'});
 assert.ok(ai.byteLength(evidence)<=46000);
 assert.equal(evidence.evidence_coverage.claim_details_included,evidence.claim_details.length);
 assert.equal(evidence.evidence_coverage.pattern_groups_included,evidence.pattern_details.length);
 assert.equal(evidence.evidence_coverage.example_claims_included,evidence.example_priority_claims.length);
 assert.equal(evidence.summary.claims,120);
});

test('history trims oldest complete exchanges before total request size becomes unsafe',()=>{
 const evidence={description:'漢'.repeat(14000)};
 const history=Array.from({length:6},(_,i)=>({role:i%2?'assistant':'user',content:'語'.repeat(3000)}));
 const bounded=ai.boundedHistory(evidence,history,'問'.repeat(1200));
 assert.ok(bounded.length<6);assert.equal(bounded.length%2,0);assert.ok(ai.byteLength({evidence,history:bounded,question:'問'.repeat(1200)})<=65000);
 assert.equal(bounded.at(-1).role,'assistant');assert.equal(history.length,6);
});

test('citation allowlist consists only of supplied source row references',()=>{
 const evidence=ai.buildEvidence(sample,{scope:'claim',claimIndex:0});const refs=ai.evidenceRows(evidence);
 assert.ok(refs.has(2));assert.ok(refs.has(3));assert.ok(!refs.has(999));assert.ok(!refs.has(4));
});

test('invalid selection fails explicitly instead of silently falling back to another claim',()=>{
 assert.throws(()=>ai.buildEvidence(sample,{scope:'claim',claimIndex:999}),/Select a claim/);
 assert.throws(()=>ai.buildEvidence(null),/valid local review/);
});

test('exported brief includes model, task, source evidence, limits and an explicit AI label',()=>{
 const evidence=ai.buildEvidence(sample,{scope:'claim',claimIndex:0});
 const data={provider:'anthropic',model:'test-model',report:{headline:'Check the receipts',executive_summary:'Two claims match.',answer:'Please supply the original receipts.',findings:[{title:'Possible duplicate',impact:'$99 is held.',evidence:'Rows 2 and 3 share local duplicate flags.',action:'Compare receipts.',severity:'high',source_rows:[2,3]}],next_steps:['Review original receipts.'],limitations:'Matching rows do not prove fraud.'}};
 const output=ai.reportMarkdown(data,{mode:'outreach',scope:'CLAIM-1 · row 2',provider:'anthropic',generatedAt:'2026-11-21T00:00:00Z',evidence});
 for(const expected of ['Provider: anthropic','Model: test\\-model','Workflow: Follow\\-up draft','## Follow-up draft','Source CSV rows: 2, 3','AI generated this interpretation','Matching rows do not prove fraud'])assert.ok(output.includes(expected),expected);
 for(const secret of privateStrings)assert.ok(!output.includes(secret));
});

const fixtureDir=process.env.HARBORLINE_FIXTURE_DIR || path.resolve(__dirname,'../../session2/delivery/Data');
const claimsPath=path.join(fixtureDir,'expense_claims_sep.csv'),employeesPath=path.join(fixtureDir,'employees.csv');
test('September fixture: all 675 rows remain covered and every selectable claim can enter AI evidence',{skip:!fs.existsSync(claimsPath)||!fs.existsSync(employeesPath)},()=>{
 const report=H.analyze(H.parseCSV(fs.readFileSync(claimsPath,'utf8')),H.parseCSV(fs.readFileSync(employeesPath,'utf8')),{});
 assert.equal(report.summary.claims,675);assert.equal(report.summary.held,127);
 const evidence=ai.buildEvidence(report,{mode:'patterns'});assert.equal(evidence.summary.positive_value_on_hold_usd,33970.16);
 assert.equal(evidence.summary.net_submitted_usd,141741.97);assert.equal(evidence.evidence_coverage.all_claims_in_aggregates,true);
 assert.ok(ai.byteLength(evidence)<=46000);
 for(const row of report.rows){const one=ai.buildEvidence(report,{scope:'claim',claimIndex:row.index,mode:'claim'});assert.equal(one.claim_details[0].source_row_number,row.rowNumber);assert.equal(one.scope.selected_claim_id,row.claimId);assert.ok(ai.byteLength(one)<=46000);}
});

test('hotel penny-over-cap cases preserve exact total evidence despite a rounded nightly average',()=>{
 const report=H.analyze([{...base,category:'Hotel',amount_usd:'900.01',nights:'3'}],employee,{});
 const details=ai.buildEvidence(report,{scope:'claim',claimIndex:0}).claim_details[0];
 assert.ok(details.policy_or_data_flags.includes('T4'));assert.equal(details.facts.nightly_amount_usd_rounded,300);
 assert.equal(details.facts.hotel_total_policy_limit_usd,900);assert.equal(details.facts.hotel_total_over_policy_limit_usd,0.01);
 assert.match(details.facts.hotel_comparison_basis,/rounded/);
});

test('missing-field requests can distinguish merchant, claim ID, and HR reference problems without identities',()=>{
 const report=H.analyze([{...base,claim_id:'',merchant:'',employee_id:'PRIVATE_UNMATCHED'}],employee,{});
 const details=ai.buildEvidence(report,{scope:'claim',claimIndex:0}).claim_details[0];
 assert.equal(details.facts.claim_identifier_present,false);assert.equal(details.facts.merchant_present,false);
 assert.equal(details.facts.employee_reference_status,'Unmatched employee reference');
 assert.ok(!JSON.stringify(details).includes('PRIVATE_UNMATCHED'));
});

test('single-claim scope omits unrelated priority examples while preserving complete aggregate totals',()=>{
 const report=H.analyze([{...base,claim_id:'SINGLE',amount_usd:'100.00',receipt_attached:'N'}, {...base,claim_id:'UNRELATED',expense_date:'2026-09-09',amount_usd:'200.00',receipt_attached:'N'}],employee,{});
 const evidence=ai.buildEvidence(report,{scope:'claim',claimIndex:0});
 assert.equal(evidence.summary.held,2);assert.equal(evidence.summary.positive_value_on_hold_usd,300);
 assert.equal(evidence.example_priority_claims.length,0);assert.equal(evidence.claim_details.length,1);
 assert.ok(!JSON.stringify(evidence).includes('UNRELATED'));assert.ok(!ai.evidenceRows(evidence).has(3));
});

test('export escapes model-authored markdown links and images as literal text',()=>{
 const evidence=ai.buildEvidence(sample);
 const data={provider:'openrouter',model:'test',report:{headline:'[open me](https://attacker.invalid)',executive_summary:'![image](https://attacker.invalid/pixel)',answer:'<script>alert(1)</script>',findings:[],next_steps:[],limitations:'Unknown'}};
 const output=ai.reportMarkdown(data,{mode:'analysis',scope:'Review',provider:'openrouter',generatedAt:'2026-11-21',evidence});
 assert.ok(!output.includes('[open me]('));assert.ok(!output.includes('![image]('));assert.ok(!output.includes('<script>'));
 assert.ok(output.includes('\\[open me\\]'));
});

test('conversation summaries retain the actual answer before long findings and disclose shortening',()=>{
 const answer='Please provide the original hotel receipt and confirm the three-night stay. The total exceeds the configured limit by $0.01.';
 const report={headline:'Hotel follow-up',executive_summary:'Summary '.repeat(100),findings:Array.from({length:5},(_,i)=>({title:'Finding '+i,impact:'Impact '.repeat(100),evidence:'Evidence '.repeat(200),action:'Request the original receipt. '.repeat(50),source_rows:[2+i,10+i]})),next_steps:['Get the receipt.','Confirm the dates.','Record the decision.'],limitations:'This is a draft for a human reviewer.',answer};
 const result=ai.compactHistoryResponse(report),parsed=JSON.parse(result);
 assert.ok(result.length<=3000);assert.equal(Object.keys(parsed)[0],'answer');assert.equal(parsed.answer,answer);
 assert.match(parsed.context_note,/Shortened conversation record/);assert.match(parsed.context_note,/may be omitted/);
 assert.ok(parsed.findings.length>0);assert.ok(parsed.findings[0].action.includes('Request the original receipt'));
 assert.deepEqual(parsed.findings[0].source_rows,[2,10]);
});

test('conversation summaries remain complete JSON within the limit even with escaping-heavy content',()=>{
 const repeated='\\"\n\t'.repeat(3000);
 const report={answer:'DIRECT ANSWER: '+repeated,headline:repeated,executive_summary:repeated,findings:Array.from({length:5},()=>({title:repeated,action:repeated,evidence:repeated,source_rows:[2,3,4]})),next_steps:[repeated,repeated,repeated],limitations:repeated};
 const result=ai.compactHistoryResponse(report),parsed=JSON.parse(result);
 assert.ok(result.length<=3000);assert.match(parsed.answer,/^DIRECT ANSWER:/);assert.ok(parsed.context_note.includes('Shortened'));
 assert.deepEqual(parsed.findings[0].source_rows,[2,3,4]);
});

test('history has a hard bound for lone-surrogate strings that JSON escapes sixfold',()=>{
 const unusual='\ud800'.repeat(5000);
 const report={answer:'Answer: '+unusual,headline:unusual,executive_summary:unusual,findings:[{title:unusual,action:unusual,evidence:unusual,source_rows:[2]}],next_steps:[unusual],limitations:unusual};
 const result=ai.compactHistoryResponse(report);assert.ok(result.length<=3000);assert.match(JSON.parse(result).answer,/^Answer:/);
});
