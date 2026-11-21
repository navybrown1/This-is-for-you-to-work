'use strict';
(function (root) {
  const USD = cents => Number((cents / 100).toFixed(2));
  const fmt = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const num = x => Number(x || 0).toLocaleString('en-US');
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '0%';
  function priorityRows(report) {
    return report.rows.filter(r => r.held && r.cents > 0).map(r => {
      const codes = [...new Set(r.flags.map(f => f.code))];
      // Clearly labeled ordering heuristic, not a fraud score or risk probability.
      const score = Math.log1p(r.cents / 100) * 6 + codes.length * 3
        + (codes.includes('T8') ? 9 : 0) + (codes.includes('T5') ? 8 : 0)
        + (codes.includes('T6') ? 6 : 0) + (codes.includes('R3') ? 4 : 0);
      return { row: r, codes, score };
    }).sort((a, b) => b.score - a.score || b.row.cents - a.row.cents || a.row.index - b.row.index);
  }
  function buildEvidence(report) {
    if (!report || !report.summary || !Array.isArray(report.rows)) throw new Error('Run a valid local review first.');
    const s = report.summary;
    const ranked = priorityRows(report), selectedClaims = ranked.slice(0, 18);
    const selectedDepartments = report.departments.slice(0, 16);
    const dataRuleMap = new Map();
    report.rows.forEach(row => {
      const seen = new Set();
      row.flags.forEach(flag => {
        if (!/^R(?:[1-9]|10)$/.test(flag.code)) return;
        if (!dataRuleMap.has(flag.code)) dataRuleMap.set(flag.code, { code: flag.code, labels: new Set(), claims: 0 });
        const rule = dataRuleMap.get(flag.code);
        // Labels are fixed checker text; reasons can contain private source values.
        rule.labels.add(String(flag.label).slice(0, 100));
        if (!seen.has(flag.code)) { rule.claims++; seen.add(flag.code); }
      });
    });
    return {
      source: 'Local deterministic policy checker; summarizes only the currently loaded files',
      currency: 'USD',
      policy_thresholds: {
        receipt_required_from_usd: report.settings.receiptLimit,
        meal_daily_limit_usd: report.settings.mealLimit,
        hotel_nightly_limit_usd: report.settings.hotelNightLimit,
        submit_within_days: report.settings.daysLimit,
        entertainment_approval_over_usd: report.settings.entertainmentLimit,
        split_minimum_claims: report.settings.splitMinClaims,
        duplicate_minimum_claims: report.settings.duplicateMinClaims
      },
      summary: {
        claims: s.claims, held: s.held, unflagged: s.noFlags,
        positive_claims: s.positiveClaims, refunds: s.credits,
        positive_submitted_usd: USD(s.positiveCents), refunds_usd: USD(s.creditCents), net_submitted_usd: USD(s.netCents),
        positive_value_on_hold_usd: USD(s.heldPositiveCents),
        held_share_percent: Number((100 * s.held / Math.max(1, s.claims)).toFixed(1)),
        data_quality_hold_claims: s.dataHeld, policy_hold_claims: s.policyHeld,
        invalid_amount_claims: s.invalidAmounts
      },
      rules: Object.entries(report.ruleCounts).map(([code, count]) => ({
        code, label: root.Harborline?.ruleNames?.[code] || code, claims: count
      })),
      data_rules: [...dataRuleMap.values()]
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map(rule => ({ code: rule.code, labels: [...rule.labels].slice(0, 4), claims: rule.claims })),
      evidence_coverage: {
        all_claims_in_aggregates: true,
        departments_total: report.departments.length,
        departments_included: selectedDepartments.length,
        departments_selection: 'Up to 16 departments, ordered by positive held value. Omitted departments remain in the full summary totals.',
        positive_held_claims_total: ranked.length,
        example_claims_included: selectedClaims.length,
        example_selection: 'Up to 18 positive held claims, ordered by an amount-and-flag review heuristic. This is a selected sample, not all held claims, a random sample, or a fraud score. Refund, zero-dollar, and invalid-amount claims appear in aggregate counts only.'
      },
      departments: selectedDepartments.map(d => ({
        department: String(d.department).slice(0, 72), claims: d.claims, held: d.held,
        held_share_percent: Number((100 * d.held / Math.max(1, d.claims)).toFixed(1)),
        positive_on_hold_usd: USD(d.heldPositiveCents), net_submitted_usd: USD(d.netCents)
      })),
      pattern_groups: {
        possible_duplicate_groups: report.groups.duplicates.length,
        possible_split_groups: report.groups.splits.length,
        meal_limit_groups: report.groups.meals.length
      },
      data_quality: {
        blank_receipt_fields: report.quality.blankReceipts,
        required_receipts_blank: report.quality.blankReceiptsRequired,
        unmatched_employees: report.quality.unmatchedEmployees,
        unknown_categories: report.quality.unknownCategories,
        invalid_or_missing_dates: report.quality.invalidDates,
        reversed_dates: report.quality.reversedDates,
        positive_hotel_claims_missing_nights: report.quality.missingNights,
        positive_airfare_claims_missing_or_unrecognized_class: report.quality.missingFare,
        duplicate_claim_id_rows: report.quality.duplicateClaimIds,
        invalid_amounts: report.quality.invalidAmounts
      },
      example_priority_claims: selectedClaims.map(x => ({
        claim_id: String(x.row.claimId).slice(0, 60),
        source_row_number: x.row.rowNumber,
        category: String(x.row.category).slice(0, 60),
        department: String(x.row.department).slice(0, 70),
        amount_usd: USD(x.row.cents),
        policy_or_data_flags: x.codes
      })),
      boundaries: [
        'All dollar amounts come from locally parsed data, not independent verification.',
        'Held positive value counts each flagged claim once; it is not financial loss or fraud.',
        'Rule counts and flags can overlap; no automatic claim denial is authorized.',
        'Receipt contents, real approvals, and duplicate claims outside these exports cannot be verified.'
      ]
    };
  }
  function localPriorities(report) {
    const s = report.summary, ranked = priorityRows(report).slice(0, 3);
    const departments = report.departments.filter(d => d.heldPositiveCents > 0);
    const leader = departments[0];
    const rules = Object.entries(report.ruleCounts).sort((a,b) => b[1] - a[1]);
    const biggest = rules.find(([, count]) => count > 0);
    return {
      heldShare: pct(s.held, s.claims), heldValue: fmt(s.heldPositiveCents),
      dept: leader?.department || 'No held spend',
      deptValue: leader ? fmt(leader.heldPositiveCents) : '$0.00',
      deptShare: leader && s.heldPositiveCents ? pct(leader.heldPositiveCents, s.heldPositiveCents) : '0%',
      signal: biggest ? biggest[0] + ' · ' + num(biggest[1]) + ' claims' : 'None identified',
      ranked: ranked.map(x => ({ id: x.row.claimId, cents: x.row.cents, codes: x.codes }))
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildEvidence, localPriorities, priorityRows };
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const state = { report: null, evidence: null, serial: 0, controller: null, busy: false };
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  function setStatus(text, isError = false) { const el = $('ai-status'); el.textContent = text; el.className = isError ? 'ai-feedback error' : 'ai-feedback'; }
  function clearResult() { $('ai-output').hidden = true; $('ai-output').replaceChildren(); }
  function stopRequest() {
    state.serial++;
    if (state.controller) state.controller.abort();
    state.controller = null;
    state.busy = false;
    $('ai-run').disabled = false;
    $('ai-ask').disabled = false;
  }
  function invalidate() {
    stopRequest(); state.report = null; state.evidence = null;
    $('ai-local').replaceChildren(); $('ai-payload-preview').textContent = 'Run a local review to see the evidence.';
    $('ai-consent').checked = false; clearResult(); setStatus('');
  }
  function renderLocal(report) {
    const summary = localPriorities(report), el = $('ai-local'); el.replaceChildren();
    const a = node('div', null, 'ai-stat');
    a.append(node('span', 'Claims requiring review', 'ai-stat-label'), node('strong', summary.heldShare, 'ai-stat-value'), node('div', `${num(report.summary.held)} of ${num(report.summary.claims)} claims · ${summary.heldValue} positive value held`, 'ai-stat-desc'));
    const b = node('div', null, 'ai-stat');
    b.append(node('span', 'Largest department exposure', 'ai-stat-label'), node('strong', summary.deptValue, 'ai-stat-value'), node('div', `${summary.dept} · ${summary.deptShare} of positive held value`, 'ai-stat-desc'));
    const c = node('div', null, 'ai-stat'); c.append(node('span', 'First claims to inspect · review heuristic', 'ai-stat-label'));
    const ol = node('ol', null, 'ai-priority');
    if (!summary.ranked.length) ol.append(node('li', 'No claims currently held.'));
    summary.ranked.forEach(item => {
      const li = node('li'); li.append(node('strong', item.id), document.createTextNode(` · ${fmt(item.cents)} · ${item.codes.join(', ')}`)); ol.append(li);
    }); c.append(ol);
    el.append(a, b, c);
  }
  function reportReady(report) {
    stopRequest(); state.report = report; state.evidence = buildEvidence(report);
    clearResult(); $('ai-consent').checked = false;
    $('ai-payload-preview').textContent = JSON.stringify(state.evidence, null, 2);
    renderLocal(report);
    setStatus('Local review intelligence is ready. AI analysis is optional and requires your consent.');
  }
  function addHeading(parent, level, text) { const el = node(level, text); parent.append(el); return el; }
  function addParagraph(parent, text, className) { const el = node('p', text, className); parent.append(el); return el; }
  function displayAI(data, isQuestion) {
    const out = $('ai-output'); out.replaceChildren();
    const r = data.report || {};
    addHeading(out, 'h3', r.headline || 'AI-assisted finance review');
    if (isQuestion && r.answer) { addHeading(out, 'h4', 'Answer'); addParagraph(out, r.answer); }
    addParagraph(out, r.executive_summary || 'No summary returned.');
    if (Array.isArray(r.findings) && r.findings.length) {
      addHeading(out, 'h4', 'Evidence-backed findings');
      const cards = node('div', null, 'ai-findings');
      r.findings.forEach(f => {
        const card = node('article', null, 'ai-finding'); const head = node('div', null, 'ai-find-header');
        head.append(node('strong', f.title), node('span', f.severity, 'ai-severity '+f.severity));card.append(head);
        addParagraph(card, f.impact);addParagraph(card, 'Evidence: '+f.evidence);
        card.append(node('small', 'Next check: '+f.action));cards.append(card);
      }); out.append(cards);
    }
    if (Array.isArray(r.next_steps) && r.next_steps.length) {
      addHeading(out, 'h4', 'Recommended next steps');const ol = node('ol');r.next_steps.forEach(step => ol.append(node('li', step)));out.append(ol);
    }
    if (r.limitations) addParagraph(out, 'Limitations: '+r.limitations, 'ai-caveat');
    addParagraph(out, `Generated with ${data.model} · ${num(data.usage?.input_tokens)} input tokens · ${num(data.usage?.output_tokens)} output tokens. Usage is billed by OpenAI. Model judgments require independent verification.`, 'ai-meta');
    out.hidden = false;
  }
  async function requestAI(mode) {
    if (state.busy) return;
    if (!state.evidence) { setStatus('Load and review both CSV files first.', true); return; }
    const key = $('ai-key').value.trim();
    if (!key) { $('ai-key').focus(); setStatus('Enter your OpenAI API key.', true); return; }
    if (!$('ai-consent').checked) { $('ai-consent').focus(); setStatus('Review the data-sharing notice and check the consent box first.', true); return; }
    const question = $('ai-question').value.trim();
    if (mode === 'question' && !question) { $('ai-question').focus(); setStatus('Enter a question about your review.', true); return; }
    if (location.protocol === 'file:') { setStatus('Open the deployed Vercel site to enable AI requests. Offline local priorities still work.', true); return; }
    stopRequest(); const id = state.serial, controller = new AbortController();state.controller = controller;state.busy = true;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 65000);
    $('ai-run').disabled = true; $('ai-ask').disabled = true; clearResult();
    setStatus(mode === 'question' ? 'Checking your question against the summarized claims…' : 'Generating an evidence-based executive review…');
    try {
      const response = await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        body: JSON.stringify({apiKey: key, model: $('ai-model').value, mode, question, evidence: state.evidence}) });
      let data;
      try { data = await response.json(); } catch { throw new Error('The AI service did not return a valid response.'); }
      if (id !== state.serial) return;
      if (!response.ok) throw new Error(data.error || 'The AI request could not be completed.');
      displayAI(data, mode === 'question');
      setStatus('AI review complete. Cross-check every recommendation against the underlying claim details.');
    } catch (error) {
      if (id === state.serial) {
        if (timedOut) setStatus('The AI request timed out. Wait a moment before trying again.', true);
        else if (error.name !== 'AbortError') setStatus(error.message || 'AI analysis could not be completed.', true);
      }
    }
    finally { clearTimeout(timeout); if (id === state.serial) { state.busy = false; state.controller = null; $('ai-run').disabled = false; $('ai-ask').disabled = false; } }
  }

  document.addEventListener('harborline:invalidated', invalidate);
  document.addEventListener('harborline:completed', e => reportReady(e.detail.report));
  $('ai-run').addEventListener('click', () => requestAI('analysis'));
  $('ai-ask').addEventListener('click', () => requestAI('question'));
  $('ai-question').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); requestAI('question'); } });
  $('ai-clear-key').addEventListener('click', () => { $('ai-key').value = ''; $('ai-key').type = 'password'; $('ai-show-key').textContent='Show'; $('ai-show-key').setAttribute('aria-pressed','false'); stopRequest(); setStatus('API key cleared from this page.'); });
  $('ai-show-key').addEventListener('click', () => { const visible = $('ai-key').type === 'password'; $('ai-key').type = visible ? 'text' : 'password'; $('ai-show-key').textContent = visible ? 'Hide' : 'Show'; $('ai-show-key').setAttribute('aria-pressed', visible ? 'true' : 'false'); });
  $('ai-payload-preview').textContent = 'Run a local review to see the evidence.';
})(typeof window !== 'undefined' ? window : globalThis);
