import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';

function fixture(invalidated = false) {
  const attributes = new Map();
  const root = { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k), hasAttribute: k => attributes.has(k), append() { throw new Error('Unexpected late loading UI'); } };
  const window = new EventTarget();
  let timeout, resolveStorage;
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/app/early-start.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(source, { exports, window, document: { documentElement: root }, matchMedia: () => ({ matches: true }),
    navigator: { getGamepads: () => [{ connected: true, mapping: 'standard' }] },
    chrome: { storage: { local: { get: () => {
      if (invalidated) throw new Error('Extension context invalidated.');
      return new Promise(resolve => { resolveStorage = resolve; });
    } } } },
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; } });
  exports.startEarly();
  return { attributes, window, exports, expire: () => timeout?.(), resolve: value => resolveStorage(value) };
}

test('early startup settles privately after application readiness and preserves native theme', () => {
  const f = fixture();
  assert.equal(f.attributes.get('data-ytg-boot'), 'starting');
  assert.equal(f.attributes.has('dark'), false);
  f.window.dispatchEvent(new Event('ytg-main-ready'));
  f.window.dispatchEvent(new Event('ytg-main-failed'));
  assert.equal(f.attributes.has('data-ytg-boot'), true);
  f.exports.finishEarlyContent();
  assert.equal(f.attributes.size, 0);
});

test('timeout clears preparation and late storage cannot recreate UI', async () => {
  const f = fixture();
  f.expire();
  f.resolve({ uiTheme: 'light' });
  await Promise.resolve();
  assert.equal(f.attributes.size, 0);
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
