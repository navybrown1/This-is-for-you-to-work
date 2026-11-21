'use strict';
// DOM simulation of the actual shipped scripts. No browser, network, layout,
// screenshot, provider service, or successful real-key inference is exercised.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

function createApp(fetchImpl) {
  const errors = [], requests = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(String(error)));
  const dom = new JSDOM(html, {url:'https://harborline.example/', runScripts:'outside-only', virtualConsole});
  const window = dom.window, document = window.document;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollTo = function () {};
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.fetch = async (url, options) => {
    const captured = {url, options, body:JSON.parse(options.body)};
    requests.push(captured);
    if (!fetchImpl) throw Error('No provider response is configured in this DOM simulation.');
    return fetchImpl(captured, requests.length);
  };
  for (const script of document.querySelectorAll('script')) {
    const source = script.getAttribute('src') ? fs.readFileSync(path.join(root, script.getAttribute('src')), 'utf8') : script.textContent;
    window.eval(source);
  }
  const $ = id => document.getElementById(id);
  const input = (id, value, event='input') => { $(id).value=value; $(id).dispatchEvent(new window.Event(event,{bubbles:true})); };
  const click = id => $(id).click();
  const view = name => document.querySelector('nav [data-view="'+name+'"]').click();
  const preview = () => JSON.parse($('ai-payload-preview').textContent);
  const visibleByDOM = element => !element.closest('[hidden]');
  const load = () => {view('overview');click('demo');};
  const prepareAI = () => {load();view('ai');input('ai-key','test-local-placeholder');$('ai-consent').checked=true;};
  return {window,document,$,input,click,view,preview,load,prepareAI,visibleByDOM,requests,errors,close(){dom.window.close();}};
}
function reply(data, status=200) { return {ok:status>=200&&status<300,status,json:async()=>data}; }
function result(body, extra={}) {
  const row = body.evidence.claim_details[0] || body.evidence.example_priority_claims[0];
  return {provider:body.provider,model:'mock-model-for-DOM-tests',usage:{input_tokens:120,output_tokens:80},report:{
    headline:'Mock review result',executive_summary:'This test response describes the current evidence only.',
    findings:row?[{title:'Mock finding',impact:'Needs a human check.',evidence:'Source row '+row.source_row_number,action:'Inspect the original receipt.',severity:'medium',source_rows:[row.source_row_number]}]:[],
    next_steps:['Verify source evidence.'],limitations:'Synthetic provider response for DOM tests.',answer:body.question?'Mock answer: '+body.question:'Mock review conclusion.',...extra
  }};
}
async function withApp(fn, fetchImpl) {
  const app=createApp(fetchImpl);
  try {await fn(app);assert.deepEqual(app.errors,[],'Unexpected script errors in the DOM simulation.');}
  finally {app.close();}
}

test('DOM: production scripts boot all four sections and fall back safely from an unknown hash', async () => {
  await withApp(async app => {
    assert.equal(app.$('ai-provider').options.length,9);
    assert.equal(app.$('ai-provider').value,'openrouter');
    assert.equal(app.$('ai-model').value,'openrouter/free');
    assert.equal(app.$('run').disabled,true);
    for(const pane of ['overview','claims','ai','import']) {
      app.view(pane);
      assert.equal(app.document.querySelector('[data-pane="'+pane+'"]').hidden,false);
      assert.equal(app.document.querySelectorAll('[data-pane]:not([hidden])').length,1);
    }
    app.window.HarborlineUI.showView('__proto__');
    assert.equal(app.document.querySelector('[data-pane="overview"]').hidden,false);
    assert.equal(app.requests.length,0);
  });
});

test('DOM: the sample review populates actual totals, priorities and a claim queue', async () => {
  await withApp(async app => {
    app.load();
    assert.equal(app.$('kpi-claims').textContent,'10');
    assert.equal(app.$('kpi-held').textContent,'8');
    assert.equal(app.$('kpi-held-amount').textContent,'$2,644.00');
    assert.match(app.$('dataset-status').textContent,/SAMPLE DATA/);
    assert.equal(app.$('priority-queue').children.length,3);
    assert.equal(app.$('ai-local').querySelectorAll('.ai-priority-card').length,3);
    app.view('claims');assert.equal(app.$('queue-panel').hidden,false);
    assert.equal(app.$('claim-body').querySelectorAll('[data-row]').length,8);
    assert.equal(app.preview().evidence.summary.claims,10);
    assert.equal(app.requests.length,0);
  });
});

test('DOM: a queue claim opens its source modal and the same scoped AI investigation, including refunds', async () => {
  await withApp(async app => {
    app.load();app.view('claims');
    const source = app.$('claim-body').querySelector('[data-row]'), id=source.textContent;
    source.click();assert.equal(app.$('claim-dialog').open,true);assert.equal(app.$('dialog-title').textContent,id);
    app.click('claim-investigate');assert.equal(app.$('claim-dialog').open,false);
    assert.equal(app.document.querySelector('[data-pane="ai"]').hidden,false);
    assert.equal(app.$('ai-scope').value,'claim');assert.equal(app.preview().evidence.scope.selected_claim_id,id);
    app.click('ai-open-source');assert.equal(app.$('dialog-title').textContent,id);app.click('close-dialog');
    app.input('ai-claim-select','7','change');
    assert.equal(app.preview().evidence.scope.selected_claim_id,'DEMO-008');
    assert.equal(app.preview().evidence.claim_details[0].amount_usd,-12);
    assert.equal(app.preview().evidence.claim_details[0].is_refund,true);
    assert.deepEqual(app.preview().evidence.example_priority_claims,[]);
  });
});

test('DOM: selecting another provider clears its predecessor key and permits custom model/base settings', async () => {
  await withApp(async app => {
    app.view('ai');app.click('ai-connect-open');
    app.input('ai-key','test-local-placeholder');
    app.input('ai-provider','anthropic','change');
    assert.equal(app.$('ai-key').value,'');assert.equal(app.$('ai-provider-badge').textContent,'Anthropic Claude');
    app.input('ai-model','my-account-model');assert.equal(app.$('ai-model').value,'my-account-model');
    app.input('ai-provider','custom','change');assert.equal(app.$('ai-base-wrap').hidden,false);
    app.input('ai-base-url','https://api.example.com/v1');app.input('ai-model','custom-model');
    assert.match(app.$('ai-consent-text').textContent,/api\.example\.com/);
    app.input('ai-provider','openrouter','change');assert.equal(app.$('ai-model').value,'openrouter/free');
    assert.equal(app.$('ai-base-wrap').hidden,true);assert.equal(app.requests.length,0);
    assert.equal(app.window.localStorage.length,0);assert.equal(app.window.sessionStorage.length,0);
  });
});

test('DOM: missing-key and consent errors are visible and block requests', async () => {
  await withApp(async app => {
    app.load();app.view('ai');app.click('ai-run');
    assert.equal(app.$('ai-connection').open,true);
    assert.equal(app.$('ai-status').hidden,false);assert.equal(app.$('ai-status').getAttribute('role'),'alert');
    assert.match(app.$('ai-status').textContent,/Enter the API key/);
    app.input('ai-key','test-local-placeholder');app.click('ai-run');
    assert.match(app.$('ai-status').textContent,/allow data sharing/);
    assert.equal(app.requests.length,0);
  });
});

test('DOM: connection testing before import sends no financial evidence and can be canceled visibly', async () => {
  let resolve;
  await withApp(async app => {
    app.view('ai');app.click('ai-connect-open');app.input('ai-key','test-local-placeholder');
    app.click('ai-test-connection');
    assert.equal(app.requests.length,1);const sent=app.requests[0];
    assert.equal(sent.body.mode,'connection');
    for(const name of ['evidence','history','question'])assert.equal(sent.body[name],undefined);
    assert.equal(app.visibleByDOM(app.$('ai-cancel')),true);
    app.click('ai-cancel');assert.equal(sent.options.signal.aborted,true);
    resolve(reply({connected:true,provider:'openrouter',model:'late-mock'}));await flush();
    assert.match(app.$('ai-status').textContent,/canceled/);
    assert.ok(!app.$('ai-connection-state').textContent.includes('late-mock'));
    assert.equal(app.$('ai-output').hidden,true);
  },()=>new Promise(done=>{resolve=done;}));
});

test('DOM: consented responses render text safely and source-row citations open original evidence', async () => {
  await withApp(async app => {
    app.prepareAI();app.click('ai-run');await flush();
    assert.equal(app.requests.length,1);
    const sent=app.requests[0], evidence=sent.body.evidence;
    assert.equal(sent.url,'/api/insights');assert.equal(sent.body.model,'openrouter/free');
    assert.equal(evidence.summary.positive_value_on_hold_usd,2644);
    assert.ok(!JSON.stringify(evidence).includes('Demo Airline'));
    assert.equal(app.$('ai-output').hidden,false);assert.equal(app.$('ai-export').disabled,false);
    assert.match(app.$('ai-output').textContent,/<img src=x onerror=/);
    assert.equal(app.$('ai-output').querySelector('img'),null);
    assert.equal(app.$('ai-output').querySelector('script'),null);
    const cited=app.$('ai-output').querySelectorAll('.ai-source-link');
    assert.equal(cited.length,1,'Unknown source references should not become links.');
    cited[0].click();assert.equal(app.$('dialog-title').textContent,evidence.claim_details[0].claim_id);
    assert.equal(app.$('claim-dialog').open,true);
    assert.match(app.$('ai-output').textContent,/mock-model-for-DOM-tests/);
  },({body})=>{const data=result(body,{headline:'<img src=x onerror=alert(1)>'});data.report.findings[0].source_rows.push(99999);return reply(data);});
});

test('DOM: conversation retains at most three complete exchanges and the preview matches outgoing context', async () => {
  await withApp(async app => {
    app.prepareAI();
    for(const question of ['Question one','Question two','Question three','Question four']) {
      app.input('ai-question',question);const shown=app.preview();app.click('ai-ask');await flush();
      const sent=app.requests.at(-1).body;
      assert.equal(sent.mode,'question');assert.equal(sent.question,question);
      assert.deepEqual(sent.history,shown.history);
      assert.deepEqual(sent.evidence,shown.evidence);
    }
    const preview=app.preview();assert.equal(preview.history.length,6);
    assert.equal(preview.history[0].content,'Question two');assert.equal(preview.history[4].content,'Question four');
    assert.equal(app.$('ai-thread').children.length,3);
    app.click('ai-new-thread');assert.equal(app.preview().history.length,0);
    assert.equal(app.$('ai-thread').children.length,0);assert.equal(app.$('ai-output').hidden,true);
  },({body})=>reply(result(body)));
});

test('DOM: provider, model, and scope edits reject an already pending response', async () => {
  for(const change of ['provider','model','scope']) {
    let resolve;
    await withApp(async app => {
      app.prepareAI();app.click('ai-run');const sent=app.requests[0];
      if(change==='provider')app.input('ai-provider','openai','change');
      if(change==='model')app.input('ai-model','another-model');
      if(change==='scope')app.input('ai-scope','claim','change');
      assert.equal(sent.options.signal.aborted,true,change);
      assert.equal(app.$('ai-consent').checked,false);
      resolve(reply(result(sent.body)));await flush();
      assert.equal(app.$('ai-output').hidden,true,change);
      assert.equal(app.$('ai-export').disabled,true,change);
      assert.equal(app.$('ai-run').disabled,false,change);
    },()=>new Promise(done=>{resolve=done;}));
  }
});

test('DOM: a provider error preserves the completed result and shows an actionable failure', async () => {
  await withApp(async app => {
    app.prepareAI();app.click('ai-run');await flush();
    const complete=app.$('ai-output').textContent;
    app.input('ai-question','Another question');app.click('ai-ask');await flush();
    assert.equal(app.$('ai-output').textContent,complete);
    assert.equal(app.$('ai-export').disabled,false);
    assert.equal(app.$('ai-status').getAttribute('role'),'alert');
    assert.match(app.$('ai-status').textContent,/quota reached/);
    assert.equal(app.$('ai-run').disabled,false);
  },({body},attempt)=>attempt===1?reply(result(body)):reply({error:'Test provider quota reached. Retry after checking the account.'},429));
});

test('DOM: local policy scenario is isolated from the active review and AI evidence', async () => {
  await withApp(async app => {
    app.load();const report=app.window.HarborlineUI.getReport();const evidence=app.preview().evidence;
    app.view('import');app.input('scenario-receipt','100');app.input('scenario-meal','100');app.input('scenario-hotel','350');app.click('scenario-run');
    assert.equal(app.$('scenario-output').hidden,false);
    assert.match(app.$('scenario-output').textContent,/5 claims would have no flags/);
    assert.match(app.$('scenario-output').textContent,/not savings/);
    assert.equal(app.window.HarborlineUI.getReport(),report);
    assert.equal(report.summary.held,8);assert.deepEqual(app.preview().evidence,evidence);
    app.view('overview');assert.equal(app.$('kpi-held').textContent,'8');assert.equal(app.requests.length,0);
  });
});

test('DOM: clearing a dataset invalidates pending AI and removes questions and evidence', async () => {
  let resolve;
  await withApp(async app => {
    app.prepareAI();app.input('ai-question','A question about this dataset');app.click('ai-ask');const sent=app.requests[0];
    app.view('import');app.click('reset');
    assert.equal(app.window.HarborlineUI.getReport(),null);assert.equal(sent.options.signal.aborted,true);
    assert.equal(app.$('ai-question').value,'');assert.equal(app.$('ai-consent').checked,false);
    assert.equal(app.$('ai-review-tools').hidden,true);assert.equal(app.$('run').disabled,true);
    assert.equal(app.$('ai-output').hidden,true);assert.match(app.$('ai-payload-preview').textContent,/Run a local review/);
    resolve(reply(result(sent.body)));await flush();assert.equal(app.$('ai-output').hidden,true);
  },()=>new Promise(done=>{resolve=done;}));
});

test('DOM: leaving the page clears the key, masks it, resets consent, and aborts pending requests', async () => {
  let resolve;
  await withApp(async app => {
    app.prepareAI();app.click('ai-show-key');assert.equal(app.$('ai-key').type,'text');
    app.click('ai-run');const sent=app.requests[0];
    app.window.dispatchEvent(new app.window.Event('pagehide'));
    assert.equal(app.$('ai-key').value,'');assert.equal(app.$('ai-key').type,'password');assert.equal(app.$('ai-consent').checked,false);
    assert.equal(sent.options.signal.aborted,true);assert.equal(app.preview().history.length,0);
    assert.equal(app.window.localStorage.length,0);assert.equal(app.window.sessionStorage.length,0);
    resolve(reply(result(sent.body)));await flush();assert.equal(app.$('ai-output').hidden,true);
  },()=>new Promise(done=>{resolve=done;}));
});
