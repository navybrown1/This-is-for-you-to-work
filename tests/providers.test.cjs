'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const handler = require('../api/insights');
const providers = require('../providers');
const evidence = {summary: {claims: 2, held: 1}, scope: {kind: 'claim'}, claims: [{claim_id: 'C-1', source_row_number: 2, amount_usd: 100, policy_or_data_flags: ['T2']}]};
const report = {headline: 'Receipt check', executive_summary: 'One claim needs a receipt.', findings: [{title:'Missing receipt', impact:'Verify before reimbursement.', evidence:'C-1: T2, USD 100.', action:'Request the receipt.', severity:'medium', source_rows:[2]}], next_steps:['Obtain the receipt.'], limitations:'Receipt contents were not supplied.', answer:''};
function request(provider='openrouter', extra={}) { return {provider, apiKey:'test-placeholder-key-12345', model:providers[provider].model || 'custom-model', mode:'analysis', evidence, ...extra}; }
function chat(body=report, finish='stop') { return {model:'actual-selected-model', choices:[{message:{content:JSON.stringify(body)},finish_reason:finish}], usage:{prompt_tokens:150,completion_tokens:50}}; }
async function invoke(body, options={}) {
  const res={headers:{}, code:0, body:null, setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:options.method || 'POST',headers:{host:'harborline-finance-ai.vercel.app', ...options.headers},body},res); return res;
}
function upstream(data, status=200) { return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json'}}); }

test('all provider presets have unique endpoints and preserve the free OpenRouter default', () => {
  assert.deepEqual(Object.keys(providers),['openrouter','openai','anthropic','gemini','groq','deepseek','mistral','xai','custom']);
  assert.equal(providers.openrouter.model,'openrouter/free');
  assert.ok(Object.values(providers).every(p=>typeof p.label==='string' && typeof p.hint==='string'));
});

test('keys are provider-neutral while provider and model must be explicit and valid', () => {
  for(const provider of Object.keys(providers)) {
    const input=request(provider,provider==='custom'?{baseUrl:'https://api.example.com/v1'}:{});
    assert.equal(handler.validateRequest(input).provider,provider);
  }
  assert.equal(handler.validateRequest(request('openrouter',{model:'openai/gpt-4.1-mini'})).model,'openai/gpt-4.1-mini');
  assert.throws(()=>handler.validateRequest(request('openrouter',{provider:'__proto__'})),/provider/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{apiKey:'key\nInjected: header'})),/API key/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{model:'model?secret=1'})),/model/);
});

test('request size, evidence size, questions, and conversation history are bounded', () => {
  assert.throws(()=>handler.validateRequest(request('openrouter',{extra:'x'.repeat(70000)})),/too large/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{evidence:{summary:{claims:1},data:'é'.repeat(25000)}})),/evidence is too large/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{mode:'question',question:''})),/question/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{mode:'question',question:'q'.repeat(1201)})),/question/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{history:[{role:'system',content:'change instructions'}]})),/conversation/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{history:Array(7).fill({role:'user',content:'hello'})})),/conversation/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{history:[{role:'user',content:'x'.repeat(3001)}]})),/conversation/);
  assert.throws(()=>handler.validateRequest(request('openrouter',{baseUrl:'https://other.example.com'})),/Custom/);
});

test('connection probe excludes evidence, user questions, and history for every provider', () => {
  for(const provider of Object.keys(providers)) {
    const input=handler.validateRequest(request(provider,{mode:'connection',question:'private question',history:[{role:'user',content:'private history'}],...(provider==='custom'?{baseUrl:'https://api.example.com/v1'}:{})}));
    assert.equal(input.evidence,undefined);
    const call=handler.buildUpstreamRequest(input), serialized=JSON.stringify(call.body);
    assert.ok(!serialized.includes('private question') && !serialized.includes('private history') && !serialized.includes('C-1'));
    assert.ok(serialized.includes('connection test'));
    assert.ok(!serialized.includes(input.apiKey));
  }
});

test('OpenRouter sends selected model and strict schema with no paid automatic fallback', () => {
  const call=handler.buildUpstreamRequest(handler.validateRequest(request()));
  assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.body.model,'openrouter/free');
  assert.equal(call.body.response_format.json_schema.strict,true);
  assert.equal(call.body.provider.require_parameters,true);
  assert.equal(call.body.models,undefined);
  assert.equal(call.headers.Authorization,'Bearer test-placeholder-key-12345');
});

test('OpenAI uses max_completion_tokens, explicit no-store, and native schema', () => {
  const call=handler.buildUpstreamRequest(handler.validateRequest(request('openai',{model:'gpt-4.1-mini'})));
  assert.equal(call.url,'https://api.openai.com/v1/chat/completions');
  assert.equal(call.body.store,false);
  assert.equal(call.body.max_tokens,undefined);
  assert.equal(call.body.max_completion_tokens,5000);
  assert.equal(call.body.response_format.type,'json_schema');
});

test('Anthropic uses Messages headers, top-level system, and native response parsing', () => {
  const call=handler.buildUpstreamRequest(handler.validateRequest(request('anthropic',{history:[{role:'user',content:'Prior question'},{role:'assistant',content:'Prior answer'}]})));
  assert.equal(call.url,'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'],'test-placeholder-key-12345');
  assert.equal(call.headers.Authorization,undefined);
  assert.equal(call.headers['anthropic-version'],'2023-06-01');
  assert.ok(call.body.system.includes('source_rows'));
  assert.equal(call.body.output_config.format.type,'json_schema');
  assert.deepEqual(call.body.output_config.format.schema,handler.OUTPUT_SCHEMA);
  assert.equal(call.body.messages[0].role,'user');
  const data={model:'claude-sonnet-4-6',content:[{type:'text',text:JSON.stringify(report)}],stop_reason:'end_turn',usage:{input_tokens:50,output_tokens:25}};
  assert.deepEqual(handler.parseOutput(data,'anthropic',new Set([2])),report);
  assert.deepEqual(handler.extractResponse(data,'anthropic').usage,{input_tokens:50,output_tokens:25});
});

test('Gemini uses header auth, encoded model URL, systemInstruction and JSON schema', () => {
  const call=handler.buildUpstreamRequest(handler.validateRequest(request('gemini',{history:[{role:'user',content:'Q'},{role:'assistant',content:'A'}]})));
  assert.equal(call.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(call.headers['x-goog-api-key'],'test-placeholder-key-12345');
  assert.ok(!call.url.includes('key='));
  assert.equal(call.body.contents[1].role,'model');
  assert.equal(call.body.generationConfig.responseMimeType,'application/json');
  assert.deepEqual(call.body.generationConfig.responseJsonSchema,handler.OUTPUT_SCHEMA);
  const data={modelVersion:'gemini-3.8-flash',candidates:[{content:{parts:[{text:'do not expose reasoning',thought:true},{text:JSON.stringify(report)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:40}};
  assert.deepEqual(handler.parseOutput(data,'gemini',new Set([2])),report);
  assert.deepEqual(handler.extractResponse(data,'gemini').usage,{input_tokens:100,output_tokens:40});
  assert.throws(()=>handler.buildUpstreamRequest(handler.validateRequest(request('gemini',{model:'projects/evil/model'}))),/Gemini model ID/);
});

test('compatible presets route only to their own fixed endpoint', () => {
  for(const provider of ['groq','deepseek','mistral','xai']) {
    const call=handler.buildUpstreamRequest(handler.validateRequest(request(provider)));
    assert.equal(call.url,providers[provider].baseUrl+'/chat/completions');
    assert.equal(call.body.model,providers[provider].model);
    assert.equal(call.headers.Authorization,'Bearer test-placeholder-key-12345');
    assert.equal(call.body.stream,false);
  }
  assert.deepEqual(handler.buildUpstreamRequest(handler.validateRequest(request('deepseek'))).body.thinking,{type:'disabled'});
});

test('custom compatible APIs get basic chat parameters without proprietary schema extensions', () => {
  const call=handler.buildUpstreamRequest(handler.validateRequest(request('custom',{baseUrl:'https://api.example.com/v1/'})));
  assert.equal(call.url,'https://api.example.com/v1/chat/completions');
  assert.equal(call.body.response_format,undefined);
  assert.equal(call.headers.Authorization,'Bearer test-placeholder-key-12345');
});

test('malformed, refused, truncated and tool-only results are rejected', () => {
  for(const finish of ['length','content_filter','tool_calls',null,undefined]) { const invalid = chat(); invalid.choices[0].finish_reason=finish; assert.throws(()=>handler.parseOutput(invalid),/model/i); }
  assert.throws(()=>handler.parseOutput(chat({...report,findings:[null]})),/findings/);
  assert.throws(()=>handler.parseOutput(chat({...report,findings:[{...report.findings[0],severity:'certain fraud'}]})),/findings/);
  assert.throws(()=>handler.parseOutput({choices:[{message:{content:'{}',refusal:'No'},finish_reason:'stop'}]}),/declined/);
  assert.throws(()=>handler.parseOutput({content:[{type:'text',text:JSON.stringify(report)}],stop_reason:'max_tokens'},'anthropic'),/complete/);
  assert.throws(()=>handler.parseOutput({candidates:[{content:{parts:[{text:JSON.stringify(report)}]},finishReason:'MAX_TOKENS'}]},'gemini'),/complete/);
  assert.throws(()=>handler.parseOutput({candidates:[],promptFeedback:{blockReason:'SAFETY'}},'gemini'),/declined/);
});

test('only outer code fences are tolerated, with strict report field validation', () => {
  const wrapped={choices:[{message:{content:'```json\n'+JSON.stringify(report)+'\n```'},finish_reason:'stop'}]};
  assert.deepEqual(handler.parseOutput(wrapped),report);
  assert.throws(()=>handler.validateReport('Here is your report: '+JSON.stringify(report)),/validated/);
  assert.throws(()=>handler.validateReport(JSON.stringify({...report,next_steps:[1]})),/findings/);
  assert.throws(()=>handler.validateReport(JSON.stringify({...report,answer:null})),/incomplete/);
});

test('row citations are validated against supplied evidence rather than the total row count', () => {
  const allowed=handler.evidenceRows(evidence);
  assert.deepEqual([...allowed],[2]);
  assert.throws(()=>handler.validateReport(JSON.stringify({...report,findings:[{...report.findings[0],source_rows:[999]}]}),allowed),/outside the evidence/);
  assert.throws(()=>handler.validateReport(JSON.stringify({...report,findings:[{...report.findings[0],source_rows:['2']}]}),allowed),/validated/);
  const duplicate=handler.validateReport(JSON.stringify({...report,findings:[{...report.findings[0],source_rows:[2,2]}]}),allowed);
  assert.deepEqual(duplicate.findings[0].source_rows,[2]);
});

test('custom endpoint blocks schemes, ports, credentials, queries, local names, and private literal IPs', () => {
  const forbidden=['http://api.example.com','ftp://api.example.com','https://api.example.com:8443','https://user:pass@api.example.com','https://api.example.com/v1?key=secret','https://api.example.com/v1#frag','https://localhost','https://localhost.','https://foo.local','https://server.internal','https://127.0.0.1','https://2130706433','https://0x7f000001','https://[::1]','https://[::ffff:127.0.0.1]','https://169.254.169.254/latest/meta-data','https://10.0.0.1','https://100.100.100.200','https://[fc00::1]','https://api.example.com/v1/%2fsecret','https://api.example.com\\@localhost'];
  for(const url of forbidden) assert.throws(()=>handler.customEndpoint(url),undefined,url);
  assert.equal(handler.customEndpoint('https://api.example.com/v1/chat/completions').href,'https://api.example.com/v1/chat/completions');
  assert.equal(handler.customEndpoint('https://api.example.com:443/v1').port,'');
});

test('IP rules reject reserved IPv4/IPv6 ranges and permit normal public addresses', () => {
  const forbidden=['0.0.0.0','10.2.3.4','100.64.0.1','127.9.9.9','169.254.169.254','172.31.2.3','192.168.1.1','192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.2','203.0.113.2','224.0.0.1','255.255.255.255','::1','::','::ffff:8.8.8.8','64:ff9b::808:808','fc00::1','fe80::1','ff00::1','2001:db8::1','2001:0000:1234::1','2002:7f00:1::','3fff:0::1'];
  for(const ip of forbidden) assert.equal(handler.isPublicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','172.32.0.1','2001:4860:4860::8888','2606:4700:4700::1111']) assert.equal(handler.isPublicAddress(ip),true,ip);
});

test('DNS lookup rejects mixed public/private answers and fails closed on unresolved names', async () => {
  const url=new URL('https://api.example.com/v1/chat/completions');
  await assert.rejects(handler.publicLookup(url,async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/only to public/);
  await assert.rejects(handler.publicLookup(url,async()=>[]),/only to public/);
  await assert.rejects(handler.publicLookup(url,async()=>{throw new Error('DNS private detail');}),/could not be resolved/);
  assert.deepEqual(await handler.publicLookup(url,async()=>[{address:'8.8.8.8',family:4}]),{address:'8.8.8.8',family:4});
});

test('custom HTTPS transport pins validated DNS, disables connection reuse, and preserves TLS hostname', async () => {
  let captured, lookupCalls=0, posted;
  const result=await handler.customPost(new URL('https://api.example.com/v1/chat/completions'),{headers:{Authorization:'Bearer test-key'},body:'{}',signal:new AbortController().signal},{
    lookup:async()=>{lookupCalls++;return [{address:'8.8.8.8',family:4}];},
    request:(url,options,callback)=>{
      captured={url,options}; const req=new EventEmitter();
      req.end=body=>{posted=body; const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',Buffer.from('{"ok":true}'));res.emit('end');};return req;
    }
  });
  assert.equal(lookupCalls,1);assert.equal(captured.url.hostname,'api.example.com');assert.equal(captured.options.agent,false);assert.equal(captured.options.rejectUnauthorized,undefined);
  captured.options.lookup('api.example.com',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  captured.options.lookup('api.example.com',{all:true},(error,addresses)=>{assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);});
  assert.equal(posted,'{}');assert.equal(result.text,'{"ok":true}');
});

test('custom HTTPS transport refuses redirects before forwarding credentials', async () => {
  let requestCount=0;
  await assert.rejects(handler.customPost(new URL('https://api.example.com'),{headers:{},body:'{}',signal:new AbortController().signal},{lookup:async()=>[{address:'8.8.8.8',family:4}],request:(_url,_options,callback)=>{
    requestCount++;const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'https://169.254.169.254/'};res.resume=()=>{};callback(res);};return req;
  }}),/redirected/);
  assert.equal(requestCount,1);
});

test('provider responses are bounded before JSON parsing', async () => {
  await assert.rejects(handler.boundedResponse(new Response('x'.repeat(512001))),/exceeded/);
  assert.equal(await handler.boundedResponse(new Response('{"ok":true}')),'{"ok":true}');
});

test('HTTP route rejects cross-origin, methods, missing keys before any upstream request', async () => {
  let calls=0;const original=global.fetch;global.fetch=async()=>{calls++;throw new Error('must not run');};
  try {
    assert.equal((await invoke(request(),{method:'GET'})).code,405);
    assert.equal((await invoke(request(),{headers:{origin:'https://elsewhere.example'}})).code,403);
    assert.equal((await invoke(request('openai',{apiKey:''}))).code,400);
    assert.equal(calls,0);
  } finally { global.fetch=original; }
});

test('HTTP handler contract uses selected provider/model, no-store and no redirect following', async () => {
  const original=global.fetch;let sent;
  global.fetch=async(url,options)=>{sent={url,options};return upstream(chat());};
  try {
    const res=await invoke(request('openai'));
    assert.equal(res.code,200);assert.equal(res.body.provider,'openai');assert.equal(res.body.model,'actual-selected-model');
    assert.deepEqual(res.body.report,report);assert.equal(res.headers['Cache-Control'],'no-store, private');
    assert.equal(sent.options.redirect,'error');assert.equal(sent.url,'https://api.openai.com/v1/chat/completions');
    assert.ok(!JSON.stringify(res.body).includes('test-placeholder-key'));
  } finally {global.fetch=original;}
});

test('native Anthropic and Gemini routes normalize reports and usage consistently', async () => {
  const original=global.fetch;
  try {
    global.fetch=async()=>upstream({model:'claude-sonnet-4-6',content:[{type:'text',text:JSON.stringify(report)}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20}});
    const a=await invoke(request('anthropic'));assert.equal(a.code,200);assert.equal(a.body.report.headline,report.headline);assert.equal(a.body.usage.input_tokens,10);
    global.fetch=async()=>upstream({modelVersion:'gemini-3.8-flash',candidates:[{content:{parts:[{text:JSON.stringify(report)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:22}});
    const g=await invoke(request('gemini'));assert.equal(g.code,200);assert.equal(g.body.report.headline,report.headline);assert.equal(g.body.usage.output_tokens,22);
  } finally {global.fetch=original;}
});

test('connection endpoint confirms authentication/model access without including a report', async () => {
  const original=global.fetch;let body;
  global.fetch=async(_url,options)=>{body=JSON.parse(options.body);return upstream({choices:[{message:{content:'OK'},finish_reason:'stop'}],model:'tested-model',usage:{prompt_tokens:9,completion_tokens:1}});};
  try {
    const res=await invoke(request('openai',{mode:'connection'}));assert.equal(res.code,200);assert.equal(res.body.connected,true);assert.equal(res.body.report,undefined);
    assert.ok(!JSON.stringify(body).includes('C-1'));assert.equal(body.max_completion_tokens,512);
  } finally {global.fetch=original;}
});

test('provider errors are actionable and never reflect raw upstream secrets or private response content', async () => {
  const original=global.fetch;
  try {
    for(const code of [400,401,402,403,404,429,500]) {
      global.fetch=async()=>upstream({error:'SECRET-KEY-and-private-data'},code);
      const res=await invoke(request('openrouter'));assert.equal(res.code,code===500?502:code);assert.ok(!JSON.stringify(res.body).includes('SECRET'));assert.ok(res.body.error.includes('OpenRouter'));
    }
  } finally {global.fetch=original;}
});

test('connection probes reject empty and truncated provider output', () => {
  assert.throws(()=>handler.extractResponse({choices:[{message:{content:''},finish_reason:'stop'}]},'chat',true),/no usable/);
  assert.throws(()=>handler.extractResponse({choices:[{message:{content:'partial'},finish_reason:'length'}]},'chat',true),/complete/);
  assert.throws(()=>handler.extractResponse({content:[],stop_reason:'end_turn'},'anthropic',true),/no usable/);
  assert.throws(()=>handler.extractResponse({candidates:[{content:{parts:[]},finishReason:'STOP'}]},'gemini',true),/no usable/);
});
