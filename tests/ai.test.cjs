'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ai = require('../ai-insights.js');
const handler = require('../api/insights.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const originalScript = html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)?.[0].replace(/<script>|<\/script>/g, '');
if (!originalScript) throw Error('Could not extract original finance checker');
const ctx={window:{},Intl,Date,console};vm.createContext(ctx);vm.runInContext(originalScript,ctx,{timeout:10000});
const H=ctx.window.Harborline;
const syntheticClaims=[
 {claim_id:'X-1',employee_id:'E1',expense_date:'2026-09-01',submit_date:'2026-09-03',category:'Meals',merchant:'Demo Food',amount_usd:'49.50',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'',attendees:'',description:'PRIVATE DESCRIPTION'},
 {claim_id:'X-2',employee_id:'E1',expense_date:'2026-09-01',submit_date:'2026-09-03',category:'Meals',merchant:'Demo Food',amount_usd:'49.50',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'',attendees:'',description:'DO NOT TRANSMIT'}
];
const employees=[{employee_id:'E1',department:'Finance',office:'NYC',level:'Director',cost_center:'F20',name:'PRIVATE NAME'}];
const report=H.analyze(syntheticClaims,employees,{});

test('the finance policy checks remain functional',()=>{ assert.equal(report.summary.claims,2);assert.equal(report.summary.held,2);assert.equal(report.summary.heldPositiveCents,9900);assert.equal(report.ruleCounts.T3,2);assert.equal(report.ruleCounts.T8,2); });
test('data minimization excludes employee identifiers, names, merchant and raw descriptions',()=>{
 const evidence=ai.buildEvidence(report);const serialized=JSON.stringify(evidence);
 assert.equal(evidence.summary.positive_value_on_hold_usd,99);
 assert.equal(evidence.summary.claims,2);
 for(const secret of ['PRIVATE NAME','PRIVATE DESCRIPTION','DO NOT TRANSMIT','Demo Food','"employee_id"','"description"','"raw"','"merchant"'])assert.ok(!serialized.includes(secret),secret);
 assert.equal(evidence.example_priority_claims.length,2);
 assert.equal(ai.localPriorities(report).ranked.length,2);
});
test('legacy HTML retains local policy runner and security declaration',()=>{
 assert.match(html,/document.dispatchEvent\(new CustomEvent\('harborline:completed'/);
 assert.match(html,/id="ai-consent"/);
 assert.match(html,/connect-src 'self'/);
 assert.doesNotMatch(html,/sk-proj-[A-Za-z0-9_-]{20,}/);
});
function response() {
 return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
}
const safeRequest = {method:'POST',headers:{origin:'https://example.vercel.app',host:'example.vercel.app'},body:{apiKey:'sk-or-v1-test-do-not-use-this-key',model:'openrouter/free',mode:'analysis',question:'',evidence:ai.buildEvidence(report)}};
test('API rejects non-POST, cross-origin and malformed / missing keys',async()=>{
 let r=response();await handler({method:'GET',headers:{}},r);assert.equal(r.statusCode,405);
 r=response();await handler({...safeRequest,headers:{origin:'https://evil.com',host:'example.vercel.app'}},r);assert.equal(r.statusCode,403);
 r=response();await handler({...safeRequest,body:{...safeRequest.body,apiKey:''}},r);assert.equal(r.statusCode,400);
 r=response();await handler({...safeRequest,body:{...safeRequest.body,model:'unsupported'}},r);assert.equal(r.statusCode,400);
 r=response();await handler({...safeRequest,body:{...safeRequest.body,mode:'question',question:''}},r);assert.equal(r.statusCode,400);
});
test('API proxy uses OpenRouter free router, forwards only reduced evidence, and validates structured output',async()=>{
 let forwarded;const old=global.fetch;
 const mockReport={headline:'Review',executive_summary:'Two duplicate claims require review.',findings:[{title:'Potential duplicate',impact:'$99 held across two claims.',evidence:'X-1 and X-2, both T8',action:'Check original receipts.',severity:'high'}],next_steps:['Review duplicate receipts','Confirm expenses','Record decision'],limitations:'Not fraud evidence.',answer:''};
 global.fetch=async(url,options)=>{forwarded={url,options};return {ok:true,status:200,json:async()=>({
   model:'google/gemma-4-26b-a4b-it:free',
   choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(mockReport)}}],
   usage:{prompt_tokens:135,completion_tokens:140}
 })};};
 try {
   const r=response();await handler(safeRequest,r);
   assert.equal(r.statusCode,200);
   assert.equal(r.body.report.findings[0].evidence,'X-1 and X-2, both T8');
   assert.equal(r.body.model,'google/gemma-4-26b-a4b-it:free');
   assert.equal(r.body.usage.input_tokens,135);
   assert.equal(forwarded.url,'https://openrouter.ai/api/v1/chat/completions');
   assert.equal(forwarded.options.headers.Authorization,'Bearer sk-or-v1-test-do-not-use-this-key');
   const b=JSON.parse(forwarded.options.body);
   assert.equal(b.model,'openrouter/free');
   assert.ok(b.response_format.json_schema.strict);
   assert.equal(b.provider.require_parameters,true);
   assert.ok(b.messages.find(item=>item.role==='user').content.includes('X-1'));
   assert.ok(!JSON.stringify(r.body).includes('sk-or-v1-test'));
   assert.ok(!JSON.stringify(b).includes('PRIVATE DESCRIPTION'));
 }finally{global.fetch=old;}
});
test('API returns safe messages for invalid keys and quota errors',async()=>{
 const old=global.fetch;try {for(const [code,pattern]of [[401,/key/i],[429,/quota/i]]){global.fetch=async()=>({ok:false,status:code});const r=response();await handler(safeRequest,r);assert.equal(r.statusCode,code);assert.match(r.body.error,pattern);}}finally{global.fetch=old;}
});

test('evidence describes data holds and discloses sampling coverage',()=>{
 const withDataHold=H.analyze([{...syntheticClaims[0],employee_id:'missing',category:'Hotel',amount_usd:'100.00',nights:''}],employees,{});
 const evidence=ai.buildEvidence(withDataHold);
 assert.ok(evidence.data_rules.some(r=>r.code==='R3'&&r.claims===1));
 assert.ok(evidence.data_rules.some(r=>r.code==='R6'&&r.claims===1));
 assert.equal(evidence.data_quality.positive_hotel_claims_missing_nights,1);
 assert.equal(evidence.policy_thresholds.split_minimum_claims,withDataHold.settings.splitMinClaims);
 assert.ok(evidence.evidence_coverage);
 assert.ok(evidence.example_priority_claims[0].source_row_number>=2);
 assert.ok(!JSON.stringify(evidence).includes('PRIVATE DESCRIPTION'));
});

test('malformed structured findings, refusals and truncated content fail safely',()=>{
 const wrap=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
 assert.throws(()=>handler.parseOutput(wrap(null)),/incomplete report/);
 const base={headline:'Review',executive_summary:'Summary',findings:[null],next_steps:['Check'],limitations:'Limited',answer:''};
 assert.throws(()=>handler.parseOutput(wrap(base)),/could not be validated/);
 assert.throws(()=>handler.parseOutput({choices:[{finish_reason:'stop',message:{refusal:'not possible'}}]}),/declined this request/);
 assert.throws(()=>handler.parseOutput({choices:[{finish_reason:'length',message:{content:'{}'}}]}),/before finishing/);
});

test('an exhausted model budget does not render partial findings',async()=>{
 const old=global.fetch;
 try {
   global.fetch=async()=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})});
   const r=response();await handler(safeRequest,r);
   assert.equal(r.statusCode,502);assert.match(r.body.error,/stopped before finishing/);assert.equal(r.body.report,undefined);
 }finally{global.fetch=old;}
});
test('OpenAI keys and paid routing models are rejected before contacting upstream',async()=>{
 const old=global.fetch;global.fetch=async()=>{throw Error('Upstream must not be called');};
 try {
  let r=response();await handler({...safeRequest,body:{...safeRequest.body,apiKey:'sk-proj-invalid-openai-key-for-test'}},r);
  assert.equal(r.statusCode,400);assert.match(r.body.error,/OpenRouter/);
  r=response();await handler({...safeRequest,body:{...safeRequest.body,model:'openrouter/auto'}},r);
  assert.equal(r.statusCode,400);assert.match(r.body.error,/Auto Free/);
 }finally{global.fetch=old;}
});
