'use strict';
// Synthetic policy and accounting fixtures. No employee or course data is bundled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(match => {
  const src = /\bsrc=["']([^"']+)["']/.exec(match[1])?.[1];
  return src && !/^(?:https?:)?\/\//.test(src) ? fs.readFileSync(path.join(root, src), 'utf8') : match[2];
});
const core = scripts.find(script => /(?:root|window)\.Harborline\s*=/.test(script));
assert.ok(core, 'The production page must load the actual finance engine.');
const context = {window: {}, Intl, Date, console};
vm.createContext(context);
vm.runInContext(core, context, {timeout: 10000});
const H = context.window.Harborline;
const plain = value => JSON.parse(JSON.stringify(value));
const staff = [
  {employee_id: 'E1', department: 'Finance', office: 'Test office', level: 'Staff', cost_center: 'F1'},
  {employee_id: 'E2', department: 'Operations', office: 'Test office', level: 'Staff', cost_center: 'O1'}
];
const claim = (id, overrides = {}) => ({
  claim_id: id, employee_id: 'E1', expense_date: '2026-09-01', submit_date: '2026-09-02',
  category: 'Other', merchant: `Synthetic ${id}`, amount_usd: '10.00', receipt_attached: 'Y',
  nights: '', fare_class: '', preapproval_id: '', attendees: '', description: 'Synthetic test', ...overrides
});
const analyze = (claims, settings = {}, employees = staff) => H.analyze(claims, employees, settings);
const codes = row => [...new Set(row.flags.map(flag => flag.code))].sort();
const checkCodes = (report, expected) => assert.deepEqual(plain(report.rows.map(codes)), expected);

test('USD parsing preserves exact cents and rejects malformed or over-precise values', () => {
  for (const [value, expected] of [['0', 0], ['75.01', 7501], ['-12.30', -1230], ['+3.1', 310]]) assert.equal(H.centsOf(value), expected);
  for (const value of ['', '1e3', 'Infinity', 'NaN', '0.001', '$1.00', '1,000', '90071992547410.00']) assert.equal(H.centsOf(value), null, value);
});

test('calendar parsing rejects impossible dates and accepts a real leap day', () => {
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '09/01/2026']) assert.equal(H.dateOf(value), null, value);
  assert.equal(H.dateOf('2024-02-29').text, '2024-02-29');
});

test('receipt requirement begins at exactly $75 and an unknown receipt does not count as present', () => {
  const r = analyze([claim('A', {amount_usd: '74.99', receipt_attached: ''}), claim('B', {amount_usd: '75.00', receipt_attached: 'N'}), claim('C', {amount_usd: '75.01', receipt_attached: ''})]);
  checkCodes(r, [[], ['T2'], ['T2']]);
  assert.equal(r.quality.blankReceiptsRequired, 1);
  assert.equal(r.summary.heldPositiveCents, 15001);
});

test('submission deadline is inclusive at 60 days and holds at 61 days', () => {
  checkCodes(analyze([claim('A', {submit_date: '2026-10-31'}), claim('B', {submit_date: '2026-11-01'})]), [[], ['T1']]);
});

test('hotel policy uses total cents divided by valid nights without boundary rounding', () => {
  checkCodes(analyze([claim('A', {category: 'Hotel', amount_usd: '600.00', nights: '2'}), claim('B', {category: 'Hotel', amount_usd: '600.01', nights: '2'}), claim('C', {category: 'Hotel', amount_usd: '100', nights: ''})]), [[], ['T4'], ['R6']]);
});

test('entertainment approval starts above $500, and missing attendees remain a separate reason', () => {
  const r = analyze([claim('A', {category: 'Client Entertainment', amount_usd: '500', attendees: '2'}), claim('B', {category: 'Client Entertainment', amount_usd: '500.01', attendees: ''})]);
  checkCodes(r, [[], ['T6']]);
  assert.equal(r.rows[1].flags.length, 2);
  assert.equal(r.ruleCounts.T6, 1, 'Rule count is unique claims, not repeated reasons.');
  assert.equal(r.summary.heldPositiveCents, 50001);
});

test('non-economy airfare requires approval, while an unrecognized class holds for correction', () => {
  checkCodes(analyze([claim('A', {category: 'Airfare', fare_class: 'Economy'}), claim('B', {category: 'Airfare', fare_class: 'Business'}), claim('C', {category: 'Airfare', fare_class: 'First', preapproval_id: 'approval-present'}), claim('D', {category: 'Airfare', fare_class: 'unknown'})]), [[], ['T5'], [], ['R7']]);
});

test('meal totals aggregate across merchants but do not use a refund to hide spending above the cap', () => {
  const r = analyze([claim('A', {category: 'Meals', amount_usd: '40.00'}), claim('B', {category: 'Meals', amount_usd: '35.01'}), claim('C', {category: 'Meals', amount_usd: '-50.00'})]);
  checkCodes(r, [['T3'], ['T3'], []]);
  assert.equal(r.summary.positiveCents, 7501);
  assert.equal(r.summary.creditCents, -5000);
  assert.equal(r.summary.netCents, 2501);
  assert.equal(r.summary.heldPositiveCents, 7501);
});

test('meal groups are separated by employee and expense date', () => {
  checkCodes(analyze([claim('A', {category: 'Meals', amount_usd: '40'}), claim('B', {category: 'Meals', amount_usd: '40', employee_id: 'E2'}), claim('C', {category: 'Meals', amount_usd: '40', expense_date: '2026-09-02'})]), [[], [], []]);
});

test('possible splits include only positive sub-threshold rows and include exactly $75 groups', () => {
  const r = analyze([claim('A', {merchant: 'Shared', amount_usd: '40'}), claim('B', {merchant: 'shared', amount_usd: '35'}), claim('C', {merchant: 'Shared', amount_usd: '75'}), claim('D', {merchant: 'Shared', amount_usd: '-10'})]);
  checkCodes(r, [['T7'], ['T7'], [], []]);
  assert.equal(r.groups.splits.length, 1);
  assert.equal(r.groups.splits[0].totalCents, 7500);
});

test('duplicates normalize merchant case and whitespace but keep every source claim', () => {
  const r = analyze([claim('A', {merchant: '  Test   Vendor ', amount_usd: '100'}), claim('B', {merchant: 'test vendor', amount_usd: '100', submit_date: '2026-09-03'})]);
  checkCodes(r, [['T8'], ['T8']]);
  assert.equal(r.summary.claims, 2);
  assert.equal(r.summary.heldPositiveCents, 20000);
});

test('opposite signed amounts are not duplicates, but duplicate refunds are still reviewed', () => {
  const r = analyze([claim('A', {merchant: 'Same', amount_usd: '100'}), claim('B', {merchant: 'Same', amount_usd: '-100'}), claim('C', {merchant: 'Same', amount_usd: '-100'})]);
  checkCodes(r, [[], ['T8'], ['T8']]);
  assert.equal(r.summary.heldPositiveCents, 0);
  assert.equal(r.summary.heldCreditCents, -20000);
  assert.equal(r.summary.netCents, -10000);
});

test('refunds skip positive-spend rules but still validate identity and dates', () => {
  checkCodes(analyze([claim('A', {category: 'Hotel', amount_usd: '-400', receipt_attached: '', nights: ''}), claim('B', {employee_id: 'missing', amount_usd: '-10', expense_date: '2026-02-29'})]), [[], ['R3', 'R4']]);
});

test('unknown employees remain in the report and the unmatched department totals', () => {
  const r = analyze([claim('A', {employee_id: 'missing', amount_usd: '100'})]);
  checkCodes(r, [['R3']]);
  assert.equal(r.summary.claims, 1);
  assert.equal(r.departments[0].department, 'Unmatched employee');
  assert.equal(r.departments[0].netCents, 10000);
});

test('conflicting HR duplicates do not multiply a claim or silently choose a department', () => {
  const r = analyze([claim('A')], {}, [staff[0], {...staff[0], department: 'Different'}]);
  checkCodes(r, [['R3']]);
  assert.equal(r.summary.claims, 1);
  assert.equal(r.summary.netCents, 1000);
  assert.equal(r.rows[0].department, 'Conflicting employee records');
});

test('invalid amounts are retained as data holds while excluded from dollar totals', () => {
  const r = analyze([claim('A', {amount_usd: '12.345'}), claim('B', {amount_usd: ''}), claim('C', {amount_usd: '4'})]);
  checkCodes(r, [['R1'], ['R1'], []]);
  assert.equal(r.summary.claims, 3);
  assert.equal(r.summary.invalidAmounts, 2);
  assert.equal(r.summary.netCents, 400);
});

test('zero-dollar claims remain visible and still receive date validation', () => {
  const r = analyze([claim('A', {amount_usd: '0'}), claim('B', {amount_usd: '0', submit_date: '2026-08-01'})]);
  checkCodes(r, [[], ['R5']]);
  assert.equal(r.summary.zeroClaims, 2);
  assert.equal(r.summary.netCents, 0);
});

test('repeated claim IDs flag every row without dropping rows', () => {
  const r = analyze([claim('same'), claim('same', {merchant: 'Different', amount_usd: '11'})]);
  checkCodes(r, [['R10'], ['R10']]);
  assert.equal(r.summary.claims, 2);
  assert.equal(r.summary.netCents, 2100);
});

test('unrecognized receipt markers are never accepted as proof', () => {
  checkCodes(analyze([claim('A', {amount_usd: '100', receipt_attached: 'true'})]), [['R8', 'T2']]);
});

test('invalid settings fail before a report can be produced', () => {
  for (const settings of [{daysLimit: 0.5}, {splitMinClaims: 1}, {duplicateMinClaims: 1}, {receiptLimit: 75.001}, {mealLimit: -1}, {hotelNightLimit: null}, {entertainmentLimit: ''}]) assert.throws(() => analyze([claim('A')], settings));
});

test('policy overrides use the same exact arithmetic as the baseline review', () => {
  const claims = [claim('A', {category: 'Meals', amount_usd: '80', receipt_attached: 'N'})];
  checkCodes(analyze(claims), [['T2', 'T3']]);
  checkCodes(analyze(claims, {receiptLimit: 100, mealLimit: 100}), [[]]);
});

test('department totals reconcile to the full report without double-counting holds', () => {
  const r = analyze([claim('A', {employee_id: 'E1', category: 'Meals', amount_usd: '100', receipt_attached: 'N'}), claim('B', {employee_id: 'E2', amount_usd: '-20'}), claim('C', {employee_id: 'missing', amount_usd: '50'})]);
  for (const key of ['claims', 'held', 'positiveCents', 'creditCents', 'netCents', 'heldPositiveCents']) assert.equal(r.departments.reduce((sum, d) => sum + d[key], 0), r.summary[key], key);
  assert.equal(r.summary.heldPositiveCents, 15000);
  assert.equal(r.summary.flagInstances, 3);
});

test('source records are not mutated by normalization and analysis', () => {
  const source = [claim('A', {category: ' meal ', merchant: '  Test   Shop ', receipt_attached: ' y '})];
  const before = JSON.stringify(source);
  const r = analyze(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(r.rows[0].category, 'Meals');
  assert.equal(r.rows[0].raw.merchant, source[0].merchant);
});

test('CSV parser preserves quoted text, multiline physical row numbers, and BOM headers', () => {
  const rows = H.parseCSV('\uFEFFclaim_id,description\r\nA,"Line one\nLine two, with ""quotes"""\r\nB,plain');
  assert.equal(rows[0].description, 'Line one\nLine two, with "quotes"');
  assert.equal(rows[0]._sourceRow, 2);
  assert.equal(rows[1]._sourceRow, 4);
  assert.deepEqual(plain(rows.headers), ['claim_id', 'description']);
});

test('malformed CSV is rejected entirely rather than producing partial results', () => {
  for (const csv of ['a,a\n1,2', 'a,b\n1,2,3', 'a,b\n1,"unterminated', 'a,b\n1,"ok"junk', 'a,b\n1,un"quoted']) assert.throws(() => H.parseCSV(csv));
  assert.throws(() => H.validateHeaders(H.parseCSV('claim_id\nA'), 'claims'));
});

test('CSV export protects formula-like text but preserves numeric credits', () => {
  for (const value of ['=HYPERLINK("https://example.invalid")', '+SUM(1,2)', '-2+3', '@SUM(1,2)', '\t=1+1', '\r=1+1']) {
    const roundtrip = H.parseCSV(H.toCSV(['value'], [[value]]));
    assert.equal(roundtrip[0].value, "'" + value.replace(/\r\n?/g, '\n'));
  }
  assert.equal(H.parseCSV(H.toCSV(['value'], [[-19.95]]))[0].value, '-19.95');
});

test('CSV export roundtrips commas, quotes and line breaks', () => {
  const value = 'a,b\n"quoted"';
  assert.equal(H.parseCSV(H.toCSV(['value'], [[value]]))[0].value, value);
});

test('a sum outside the exact safe integer range is rejected', () => {
  assert.throws(() => analyze([claim('A', {amount_usd: '90071992547409.90'}), claim('B', {amount_usd: '1.00'})]), /exact numeric range/);
});
