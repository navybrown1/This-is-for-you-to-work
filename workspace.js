'use strict';
(function(root){
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id);
  const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
  const count=value=>Number(value||0).toLocaleString('en-US');
  const pages={
    overview:{label:'Overview',eyebrow:'Expense intelligence',title:'A clearer view of every claim.',subtitle:'Less time untangling expenses. More confidence in the next decision.'},
    claims:{label:'Claim queue',eyebrow:'The review desk',title:'Follow the facts.',subtitle:'Every source row, every flag, and the evidence behind it.'},
    ai:{label:'AI workbench',eyebrow:'Intelligence, on your terms',title:'Your data. Your AI. Better questions.',subtitle:'Bring the provider you trust. Keep the evidence close.'},
    import:{label:'Data & policy',eyebrow:'Set the foundation',title:'Good reviews start here.',subtitle:'Bring in the source files, confirm your policy, and check every row.'}
  };
  let activeView='overview',report=null;
  function el(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(className)node.className=className;return node;}
  function showView(view,options={}){
    if(!Object.hasOwn(pages,view))view='overview';activeView=view;
    document.querySelectorAll('[data-pane]').forEach(pane=>{pane.hidden=pane.dataset.pane!==view;});
    document.querySelectorAll('.sidebar nav [data-view]').forEach(link=>{if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    const page=pages[view];$('breadcrumb-current').textContent=page.label;$('page-eyebrow').textContent=page.eyebrow;$('page-title').textContent=page.title;$('page-subtitle').textContent=page.subtitle;
    document.title='Harborline | '+page.label;
    if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);
    if(options.focus){$('main').focus({preventScroll:true});root.scrollTo({top:0,behavior:'auto'});}
  }
  root.HarborlineUI.showView=showView;
  document.querySelectorAll('[data-view]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();showView(link.dataset.view,{focus:true});}));
  document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.go,{focus:true})));
  root.addEventListener('hashchange',()=>{const target=location.hash.slice(1);if(Object.hasOwn(pages,target))showView(target,{focus:true});});
  $('header-import').addEventListener('click',()=>showView('import',{focus:true}));
  $('sidebar-connect').addEventListener('click',()=>{showView('ai',{focus:true});root.HarborlineAI.openConnection();});
  $('overview-ai').addEventListener('click',()=>{showView('ai',{focus:true});$('ai-title').scrollIntoView({block:'start',behavior:'smooth'});});
  function updateDataset(){
    const badge=$('dataset-status');badge.replaceChildren(el('span'));
    if(!report){badge.append(document.createTextNode('No reviewed data'));badge.className='dataset-status';$('nav-claim-count').textContent='0';return;}
    const names=root.HarborlineUI.getSourceNames();const demo=/^Synthetic demo/.test(names.claims);
    badge.className='dataset-status loaded'+(demo?' demo':'');
    badge.append(document.createTextNode((demo?'SAMPLE DATA · ':'')+count(report.summary.claims)+' claims reviewed'));
    $('nav-claim-count').textContent=count(report.summary.held);
  }
  function renderPriorities(){
    const container=$('priority-queue');container.replaceChildren();
    const items=root.HarborlineAI.priorityRows(report).slice(0,3);
    if(!items.length){container.append(el('p','No positive claims are on hold. Review the data quality notes and any refunds before a payment decision.','priority-empty'));return;}
    items.forEach(({row,codes},index)=>{
      const button=el('button',null,'priority-row');button.type='button';
      button.setAttribute('aria-label','Open '+row.claimId+', '+money(row.cents)+', '+codes.join(', '));
      const copy=el('span');copy.append(el('strong',row.claimId,'priority-id'),el('span',row.department+' · '+row.category,'priority-context'));
      const amount=el('span',money(row.cents),'priority-amount');amount.append(el('small',codes.join(' · ')));
      button.append(el('span',String(index+1).padStart(2,'0'),'priority-order'),copy,amount);
      button.addEventListener('click',()=>root.HarborlineUI.showClaim(row.index));container.append(button);
    });
  }
  function renderComposition(){
    const percent=report.summary.claims?100*report.summary.held/report.summary.claims:0;
    $('review-share').textContent=percent.toFixed(1)+'%';$('legend-held').textContent=count(report.summary.held);$('legend-clear').textContent=count(report.summary.noFlags);
    $('review-donut').style.background='conic-gradient(#c8763f 0deg '+(percent*3.6)+'deg,#dce8ca '+(percent*3.6)+'deg 360deg)';
    $('review-donut').setAttribute('role','img');$('review-donut').setAttribute('aria-label',count(report.summary.held)+' of '+count(report.summary.claims)+' claims require review, '+percent.toFixed(1)+' percent.');
  }
  function connectOverviewFilters(){
    [...$('department-body').rows].forEach((tr,index)=>{
      const department=report.departments[index];if(!department)return;const td=tr.cells[0];const bar=td.querySelector('.bar');
      const button=el('button',department.department,'department-link');button.type='button';
      button.addEventListener('click',()=>{root.HarborlineUI.filterClaims({'department-filter':department.department,'status-filter':'all','rule-filter':'','search':''});showView('claims',{focus:true});});
      td.replaceChildren(button);if(bar){bar.title=(100*department.held/department.claims).toFixed(1)+'% of department claims require review';td.append(bar);}
    });
    document.querySelectorAll('#rule-list .rule-item').forEach(row=>{
      const code=row.querySelector('.rule-code').textContent;
      row.classList.add('is-clickable');row.setAttribute('role','button');row.tabIndex=0;
      row.setAttribute('aria-label','Review '+code+' claims: '+root.Harborline.ruleNames[code]);
      const open=()=>{root.HarborlineUI.filterClaims({'rule-filter':code,'department-filter':'','status-filter':'all','search':''});showView('claims',{focus:true});};
      row.addEventListener('click',open);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}});
    });
  }
  function reportReady(next){
    report=next;$('queue-panel').hidden=false;$('queue-empty').hidden=true;$('quality-panel').hidden=false;$('scenario-panel').hidden=false;
    $('scenario-receipt').value=report.settings.receiptLimit;$('scenario-meal').value=report.settings.mealLimit;$('scenario-hotel').value=report.settings.hotelNightLimit;
    $('scenario-output').hidden=true;$('scenario-output').replaceChildren();updateDataset();renderPriorities();renderComposition();connectOverviewFilters();
    showView('overview',{focus:true});
  }
  function invalidated(){
    report=null;$('queue-panel').hidden=true;$('queue-empty').hidden=false;$('quality-panel').hidden=true;$('scenario-panel').hidden=true;
    $('scenario-output').hidden=true;$('priority-queue').replaceChildren();updateDataset();
  }
  document.addEventListener('harborline:completed',event=>reportReady(event.detail.report));
  document.addEventListener('harborline:invalidated',invalidated);
  $('scenario-run').addEventListener('click',()=>{
    const output=$('scenario-output');if(!report)return;
    output.replaceChildren();output.hidden=false;output.className='scenario-output';
    try{
      const receipt=$('scenario-receipt').value,meal=$('scenario-meal').value,hotel=$('scenario-hotel').value;
      if(!receipt.trim()||!meal.trim()||!hotel.trim())throw new Error('Enter all three scenario thresholds.');
      const scenario=root.HarborlineUI.previewSettings({...report.settings,receiptLimit:receipt,mealLimit:meal,hotelNightLimit:hotel});
      if(!scenario)throw new Error('Run a review before comparing policy scenarios.');
      const current=report.summary,draft=scenario.summary;
      const metrics=el('div',null,'scenario-metrics');
      [[count(current.held),'Current holds'],[count(draft.held),'Scenario holds'],[money(draft.heldPositiveCents),'Scenario held value']].forEach(([value,label])=>{const box=el('div');box.append(el('strong',value),el('span',label));metrics.append(box);});
      output.append(metrics);
      const released=report.rows.filter((row,i)=>row.held&&!scenario.rows[i].held),added=report.rows.filter((row,i)=>!row.held&&scenario.rows[i].held);
      const difference=draft.heldPositiveCents-current.heldPositiveCents;
      output.append(el('p',count(released.length)+' claims would have no flags under the draft; '+count(added.length)+' additional claims would be held. Positive held value would '+(difference===0?'stay unchanged':difference>0?'increase by '+money(difference):'decrease by '+money(-difference))+'. This is a screening difference, not savings or a payment decision.'));
      const changed=[...released,...added].slice(0,8);
      if(changed.length){const refs=el('div',null,'ai-source-links');changed.forEach(row=>{const button=el('button',row.claimId,'ai-source-link');button.type='button';button.addEventListener('click',()=>root.HarborlineUI.showClaim(row.index));refs.append(button);});output.append(refs);}
    }catch(error){output.className='scenario-output error';output.textContent=error.message;}
  });
  ['scenario-receipt','scenario-meal','scenario-hotel'].forEach(id=>$(id).addEventListener('input',()=>{$('scenario-output').hidden=true;}));
  showView(location.hash.slice(1)||'overview');
})(typeof window!=='undefined'?window:globalThis);
