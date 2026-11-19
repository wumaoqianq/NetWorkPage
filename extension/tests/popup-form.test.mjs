import test from 'node:test';
import assert from 'node:assert/strict';
import { collectForm, fillForm } from '../popup-form.js';

function fixture() {
  const elements = Object.fromEntries(['title', 'url', 'description', 'purpose', 'notes', 'category', 'tags', 'pinned', 'later', 'scope', 'access-scope', 'collections', 'description-source']
    .map(id => [id, { id, value: '', checked: false, dataset: {}, querySelectorAll: () => [] }]));
  elements.scope.value = 'home'; elements['access-scope'].value = '本机';
  globalThis.document = { querySelector: selector => elements[selector.slice(1)] };
  return elements;
}

test('capture range and endpoint access scope stay independent', () => {
  const elements = fixture();
  elements.title.value = '标题'; elements.url.value = 'http://localhost:3000/';
  const form = collectForm();
  assert.equal(form.range, 'home');
  assert.equal(form.scope, '本机');
  assert.equal(form.title, '标题');
});

test('old drafts migrate range while new drafts restore private scope', () => {
  fixture();
  fillForm({ scope: 'home', title: '旧草稿' });
  assert.equal(collectForm().range, 'home');
  assert.equal(collectForm().scope, '公网');
  fillForm({ range: 'page', scope: '局域网' });
  assert.equal(collectForm().range, 'page');
  assert.equal(collectForm().scope, '局域网');
});
