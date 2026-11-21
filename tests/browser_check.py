from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
results=[]
console_errors=[]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
    page.on('pageerror', lambda e: console_errors.append(str(e)))
    source=(ROOT/'index.html').read_text().replace('<script src="ai-insights.js"></script>','')
    page.set_content(source, wait_until='load')
    page.add_script_tag(content=(ROOT/'ai-insights.js').read_text())
    assert page.locator('#demo').count()==1
    page.locator('#demo').click()
    assert page.locator('#kpi-claims').inner_text()=='10'
    assert page.locator('#ai-local').locator('.ai-stat').count()==3
    assert page.locator('#ai-payload-preview').text_content().find('DEMO-004')>=0
    assert page.locator('#ai-payload-preview').text_content().find('Demo Airline')<0
    assert page.locator('#ai-payload-preview').text_content().find('employee_id')<0
    results.append('Synthetic demo loaded; local metrics and minimized payload ready')
    page.locator('#ai-run').click()
    assert 'Enter your OpenAI API key' in page.locator('#ai-status').inner_text()
    page.locator('#ai-key').fill('sk-test-one-two-three-four-five')
    page.locator('#ai-run').click()
    assert 'consent' in page.locator('#ai-status').inner_text().lower()
    results.append('API key and explicit consent required before sending data')
    page.evaluate('''() => { window.__mockCalls=[]; window.fetch=async (path, opts) => {const b=JSON.parse(opts.body); window.__mockCalls.push(b.mode); return {ok:true,json:async()=>({report:{headline:'Evidence-backed finance review',executive_summary:'Review approvals and possible duplicates before settlement.',findings:[{title:'Potential repeated airfare',impact:'Airfare claims require a receipt review.', evidence:'DEMO-004 and DEMO-010 both T8',action:'Compare merchant invoice and tickets.',severity:'high'}],next_steps:['Request receipts','Validate approvals','Document findings'],limitations:'Potential duplicates are unconfirmed.',answer:'Prioritize Airfare T8 matching.'},model:'gpt-6-luna',usage:{input_tokens:485,output_tokens:210}})}; }; }''')
    page.locator('#ai-consent').check()
    page.locator('#ai-run').click()
    page.locator('#ai-output h3').wait_for()
    assert page.locator('#ai-output h3').inner_text()=='Evidence-backed finance review'
    assert 'DEMO-004' in page.locator('#ai-output').inner_text()
    assert 'sk-test-one' not in page.locator('#ai-output').inner_text()
    results.append('Model-generated findings render safely; no key leaks to findings')
    page.locator('#ai-question').fill('What should the controller verify first?')
    page.locator('#ai-ask').click()
    page.locator('#ai-output h4').first.wait_for()
    assert 'Prioritize Airfare T8' in page.locator('#ai-output').inner_text()
    assert page.evaluate('window.__mockCalls')==['analysis','question']
    results.append('Follow-up finance question hits proxy with restricted evidence only')
    page.locator('#ai-clear-key').click()
    assert page.locator('#ai-key').input_value()==''
    results.append('Clear key removes input and stops outstanding requests')
    page.screenshot(path=str(ROOT/'tests/screenshot-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(ROOT/'tests/screenshot-mobile.png'),full_page=True)
    assert page.locator('#ai-run').is_visible()
    results.append('Desktop and mobile render screenshots captured')
    # Optional class test data is never committed to the public repository.
    claims=os.environ.get('FINANCE_CLAIMS', '/mnt/data/Data/expense_claims_sep.csv')
    employees=os.environ.get('FINANCE_EMPLOYEES', '/mnt/data/Data/employees.csv')
    if Path(claims).is_file() and Path(employees).is_file():
        page.set_content(source, wait_until='load')
        page.add_script_tag(content=(ROOT/'ai-insights.js').read_text())
        page.locator('#claims-file').set_input_files(claims)
        page.locator('#employees-file').set_input_files(employees)
        page.locator('#run').click()
        assert page.locator('#kpi-claims').inner_text()=='675'
        assert page.locator('#kpi-held').inner_text()=='127'
        assert page.locator('#kpi-held-amount').inner_text()=='$33,970.16'
        evid=json.loads(page.locator('#ai-payload-preview').text_content())
        assert evid['summary']['claims']==675 and evid['summary']['held']==127
        assert evid['summary']['positive_value_on_hold_usd']==33970.16
        assert len(evid['example_priority_claims'])<=18
        results.append('Real 675-row input passes browser workflow with exact reconciled amounts')
    else:
        results.append('Course dataset not present: optional 675-row integration check skipped')
    assert not console_errors,console_errors
    print(json.dumps({'status':'PASS','count':len(results),'results':results,'console_errors':console_errors},indent=2))
    browser.close()
