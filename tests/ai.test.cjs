'use strict';
// Integration tests across the real policy engine, reduced evidence, and HTTP handler.
// Provider transport is mocked. These tests do not perform paid or free inference.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ai = require('../ai-insights.js');
const handler = require('../api/insights.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)?.[0].replace(/<script>|<\/script>/g, '');
assert.ok(script, 'The finance engine must be loaded from production source.');
const context = {window:{}, Intl, Date, console};
vm.createContext(context); vm.runInContext(script, context, {timeout:10000});
const H = context.window.Harborline;
const rows = [
  {claim_id:'X-1',employee_id:'PRIVATE_E1',expense_date:'2026-09-01',submit_date:'2026-09-03',category:'Meals',merchant:'PRIVATE_MERCHANT',amount_usd:'49.50',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'',attendees:'',description:'PRIVATE_DESCRIPTION'},
  {claim_id:'X-2',employee_id:'PRIVATE_E1',expense_date:'2026-09-01',submit_date:'2026-09-03',category:'Meals',merchant:'PRIVATE_MERCHANT',amount_usd:'49.50',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'',attendees:'',description:'PRIVATE_DESCRIPTION'},
  {claim_id:'X-3',employee_id:'PRIVATE_E1',expense_date:'2026-09-02',submit_date:'2026-09-03',category:'Other',merchant:'PRIVATE_OTHER_MERCHANT',amount_usd:'10.00',receipt_attached:'Y',nights:'',fare_class:'',preapproval_id:'',attendees:'',description:'PRIVATE_OTHER_DESCRIPTION'}
];
const employees = [{employee_id:'PRIVATE_E1',department:'Finance',office:'PRIVATE_OFFICE',level:'Director',cost_center:'PRIVATE_COST',name:'PRIVATE_NAME'}];
const review = H.analyze(rows, employees, {});
const generated = {headline:'Inspect the matched claims',executive_summary:'Two claims totaling $99 share local duplicate flags.',findings:[{title:'Possible duplicate',impact:'$99 is held for review.',evidence:'Source rows 2 and 3 share T8 flags.',action:'Compare the original receipts.',severity:'high',source_rows:[2,3]}],next_steps:['Compare original receipts.'],limitations:'Matching claims do not prove fraud.',answer:'Review the receipts for X-1 and X-2.'};
function response() { return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}}; }
function request(mode='claim', extra={}) {
  return {method:'POST',headers:{origin:'https://example.vercel.app',host:'example.vercel.app'},body:{provider:'openrouter',apiKey:'synthetic-test-key-not-valid',model:'openrouter/free',mode,question:mode==='question'?'What evidence should I request?':'',evidence:ai.buildEvidence(review,{scope:'claim',claimIndex:0,mode}),...extra}};
}
function providerResponse(report=generated) { return new Response(JSON.stringify({model:'test-returned-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(report)}}],usage:{prompt_tokens:400,completion_tokens:200}}),{status:200,headers:{'Content-Type':'application/json'}}); }

test('policy facts flow through the actual evidence and handler while private source fields stay local', async () => {
  const original = global.fetch; let sent;
  global.fetch = async (url, options) => {sent={url,options};return providerResponse();};
  try {
    const res=response(); await handler(request(),res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.report.findings[0].evidence,generated.findings[0].evidence);
    assert.deepEqual(res.body.report.findings[0].source_rows,[2,3]);
    assert.equal(res.body.model,'test-returned-model');
    const upstream=JSON.parse(sent.options.body), user=JSON.parse(upstream.messages.at(-1).content);
    assert.equal(user.evidence.summary.claims,3);
    assert.equal(user.evidence.summary.positive_value_on_hold_usd,99);
    assert.equal(user.evidence.scope.selected_claim_id,'X-1');
    for(const secret of ['PRIVATE_E1','PRIVATE_MERCHANT','PRIVATE_DESCRIPTION','PRIVATE_NAME','PRIVATE_OFFICE','PRIVATE_COST','synthetic-test-key-not-valid']) assert.ok(!sent.options.body.includes(secret),'Unexpected private data in prompt: '+secret);
    assert.equal(sent.options.headers.Authorization,'Bearer synthetic-test-key-not-valid');
    assert.ok(!JSON.stringify(res.body).includes('synthetic-test-key-not-valid'));
    assert.equal(res.headers['Cache-Control'],'no-store, private');
  } finally {global.fetch=original;}
});

test('every review workflow retains its explicit task and scope through the API contract', async () => {
  const original=global.fetch;let payload;
  global.fetch=async (_url,options)=>{payload=JSON.parse(options.body);return providerResponse();};
  try {
    for(const mode of ['analysis','claim','patterns','outreach','question']) {
      const input=request(mode);const res=response();await handler(input,res);
      assert.equal(res.statusCode,200,mode);
      const user=JSON.parse(payload.messages.at(-1).content);
      assert.equal(user.mode,mode);assert.equal(user.evidence.scope.task,mode);
      assert.equal(user.evidence.scope.selected_source_row_number,2);
      assert.equal(user.question,mode==='question'?'What evidence should I request?':'');
    }
  } finally {global.fetch=original;}
});

test('a model cannot cite an unseen claim even when that claim exists in the full review', async () => {
  const original=global.fetch;
  const wrong={...generated,findings:[{...generated.findings[0],source_rows:[4]}]};
  global.fetch=async()=>providerResponse(wrong);
  try {
    const input=request();assert.ok(!ai.evidenceRows(input.body.evidence).has(4));
    const res=response();await handler(input,res);
    assert.equal(res.statusCode,502);assert.match(res.body.error,/outside the evidence/);
    assert.equal(res.body.report,undefined);
  } finally {global.fetch=original;}
});

test('OpenAI and paid OpenRouter model choices are accepted explicitly without changing the free default', async () => {
  const original=global.fetch;const sent=[];
  global.fetch=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return providerResponse();};
  try {
    for(const extra of [{provider:'openai',model:'gpt-4.1-mini'},{provider:'openrouter',model:'openai/gpt-4.1-mini'}]) {
      const res=response();await handler(request('analysis',extra),res);assert.equal(res.statusCode,200);
    }
    assert.equal(sent[0].url,'https://api.openai.com/v1/chat/completions');
    assert.equal(sent[0].body.model,'gpt-4.1-mini');
    assert.equal(sent[1].url,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(sent[1].body.model,'openai/gpt-4.1-mini');
    assert.equal(require('../providers.js').openrouter.model,'openrouter/free');
  } finally {global.fetch=original;}
});

