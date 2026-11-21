'use strict';
// Cross-file integration checks, not a substitute for live browser verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
const localStyles = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);

test('HTML IDs are unique and explicit label targets exist', () => {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], 'Duplicate IDs can bind controls to the wrong panel.');
  for (const match of html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/gi)) assert.ok(ids.includes(match[1]), 'Missing label target: ' + match[1]);
});

test('all page script and stylesheet assets exist and are allowed by the page CSP', () => {
  for (const file of [...localScripts, ...localStyles]) {
    assert.ok(!/^(?:https?:)?\/\//.test(file), 'Application assets are served by this deployment.');
    assert.ok(fs.existsSync(path.join(root, file)), 'Missing application asset: ' + file);
  }
  assert.match(html, /script-src[^;]*'self'/);
  if (localStyles.length) assert.match(html, /style-src[^;]*'self'/);
  assert.match(html, /connect-src 'self'/);
  assert.ok(localScripts.indexOf('providers.js') < localScripts.indexOf('ai-insights.js'), 'Provider presets must be available before the AI client initializes.');
});

test('static DOM bindings in the shipped client resolve to real elements', () => {
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const scripts = [...inline, ...localScripts.map(file => fs.readFileSync(path.join(root, file), 'utf8'))];
  const missing = new Set();
  for (const script of scripts) {
    for (const match of script.matchAll(/\$\(["']([^"']+)["']\)/g)) if (!ids.includes(match[1])) missing.add(match[1]);
    for (const match of script.matchAll(/getElementById\(["']([^"']+)["']\)/g)) if (!ids.includes(match[1])) missing.add(match[1]);
  }
  assert.deepEqual([...missing].sort(), [], 'An absent DOM binding would break page initialization or its event handlers.');
});
