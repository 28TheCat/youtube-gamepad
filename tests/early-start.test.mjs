import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
import { importSettingsModel } from './helpers/settings-model.mjs';
const routes = await importSettingsModel('src/shared/explore-pages.ts');

function fixture(invalidated = false, lateRoot = false, pathname = '/') {
  const attributes = new Map();
  const children = new Set();
  const root = { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k), hasAttribute: k => attributes.has(k), append(node) { children.add(node); } };
  const document = { documentElement: lateRoot ? null : root, createElement() {
    return { textContent: '', remove() { children.delete(this); } };
  } };
  const window = new EventTarget();
  let timeout, resolveStorage, observed, frame;
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/app/early-start.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) { assert.equal(name, '../shared/explore-pages'); return routes; }, window, document, location: { pathname }, matchMedia: () => ({ matches: true }),
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() { observed = this.callback; } disconnect() { observed = undefined; } },
    requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame: () => { frame = undefined; },
    navigator: { getGamepads: () => [{ connected: true, mapping: 'standard' }] },
    chrome: { storage: { local: { get: () => {
      if (invalidated) throw new Error('Extension context invalidated.');
      return new Promise(resolve => { resolveStorage = resolve; });
    } } } },
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; } });
  exports.startEarly();
  return { attributes, window, exports, children, paint: () => frame?.(),
    attachRoot() { document.documentElement = root; observed?.(); },
    expire: () => timeout?.(), resolve: value => resolveStorage(value) };
}

test('early startup settles privately after application readiness and preserves native theme', () => {
  const f = fixture();
  assert.equal(f.attributes.get('data-ytg-boot'), 'starting');
  assert.equal(f.attributes.has('dark'), false);
  f.window.dispatchEvent(new Event('ytg-main-ready'));
  f.window.dispatchEvent(new Event('ytg-main-failed'));
  assert.equal(f.attributes.has('data-ytg-boot'), true);
  f.exports.finishEarlyContent();
  assert.equal(f.children.size, 0, 'startup does not cover the page');
  f.paint();
  assert.equal(f.attributes.size, 0);
  assert.equal(f.children.size, 0);
});

test('timeout clears preparation and late storage cannot recreate UI', async () => {
  const f = fixture();
  f.expire();
  f.resolve({ uiTheme: 'light' });
  await Promise.resolve();
  assert.equal(f.attributes.size, 0);
  assert.equal(f.children.size, 0);
});

test('startup attaches when html arrives without hiding the page', () => {
  const f = fixture(false, true);
  assert.equal(f.children.size, 0);
  f.attachRoot();
  assert.equal(f.attributes.get('data-ytg-boot'), 'starting');
  assert.equal(f.children.size, 0);
  f.exports.abortEarlyContent();
  assert.equal(f.children.size, 0);
});

test('disabled extension reveals native page immediately', async () => {
  const f = fixture();
  f.resolve({ enabled: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.children.size, 0);
  assert.equal(f.attributes.size, 0);
});

for (const pathname of ['/watch', '/shorts/first']) test(`startup on ${pathname} leaves playback visible`, () => {
  const f = fixture(false, false, pathname);
  assert.equal(f.attributes.get('data-ytg-boot'), 'starting');
  assert.equal(f.children.size, 0);
  f.exports.abortEarlyContent();
  assert.equal(f.children.size, 0);
});

test('startup failure and page exit clear markers', () => {
  for (const event of ['abort', 'pagehide']) {
    const f = fixture();
    if (event === 'abort') f.exports.abortEarlyContent();
    else f.window.dispatchEvent(new Event(event));
    f.exports.finishEarlyContent();
    assert.equal(f.attributes.size, 0);
  }
});

test('synchronous extension invalidation clears early startup without throwing', () => {
  const f = fixture(true);
  assert.equal(f.attributes.size, 0);
  assert.equal(f.window[Symbol.for('yt-gamepad.early-start')], undefined);
});


test('native account flows do not install a startup cover', () => {
  for (const route of ['/account', '/signin', '/channel_switcher', '/logout']) {
    const f = fixture(false, false, route);
    assert.equal(f.children.size, 0);
    assert.equal(f.attributes.size, 0);
  }
});
