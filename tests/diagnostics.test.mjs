import { legacyModuleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';
const source = file => legacyModuleSource(file);
const raw = { module: 'site', operation: 'readPlayback', name: 'Error', reason: 'original failure', stack: 'Error: original failure',
  state: { route: 'watch', mode: 'controls', adaptation: 'ready', enabled: true, title: 'private' } };

test('store bounds count and total size and drops unknown fields and URLs', () => {
  const context = {};
  runInNewContext(source('src/diagnostics/diagnostics-store.ts'), context);
  const store = context.YTGamepadDiagnosticStore;
  const entry = store.normalize({ ...raw, reason: 'failed https://www.youtube.com/watch?v=private' }, '0.2.0', 123);
  assert.equal(entry.reason, 'failed [URL]');
  assert.equal(entry.state.enabled, true); assert.equal(entry.state.title, undefined);
  assert.equal(entry.timestamp, 123);
  const bounded = store.bounded(Array.from({ length: 150 }, (_, timestamp) => ({ ...raw, timestamp, version: '0.2.0', stack: 'x'.repeat(1024) })));
  assert.ok(bounded.length <= 100); assert.ok(JSON.stringify(bounded).length <= 32768);
  assert.equal(bounded.at(-1).timestamp, 149);
  assert.equal(store.bounded(null).length, 0);
});

test('collector retains early failures until the bridge is ready and cannot break recovery', () => {
  const listeners = {}, messages = [];
  const window = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, postMessage(message) { messages.push(message); } };
  const context = { window, location: { origin: 'https://www.youtube.com' } };
  runInNewContext(moduleSource('src/diagnostics/diagnostics.ts'), context);
  for (let i = 0; i < 105; i++) window.YTGamepadDiagnostics.record('site', 'read', new Error('failure ' + i), {});
  assert.equal(messages.length, 0);
  for (const fn of listeners.message) fn({ source: window, origin: context.location.origin, data: { source: 'yt-gamepad-settings' } });
  assert.equal(messages.length, 100); assert.equal(messages[0].entry.reason, 'failure 5');
  assert.match(messages[0].entry.stack, /failure 5/);
  window.postMessage = () => { throw new Error('transport broken'); };
  assert.doesNotThrow(() => window.YTGamepadDiagnostics.record('watch', 'sync', new Error('render failed')));
});

test('worker serializes concurrent tabs, supplies its own version, persists across restart and rate limits', async () => {
  const saved = {}, listeners = {};
  let now = 1000, writes = 0;
  const chrome = { runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path, getManifest: () => ({ version: '0.2.0' }), onMessage: { addListener(fn) { listeners.message = fn; } } },
    storage: { local: { async get(key) { return { [key]: structuredClone(saved[key]) }; }, async set(values) { writes++; Object.assign(saved, structuredClone(values)); }, async remove(key) { delete saved[key]; } },
      onChanged: { addListener() {} } }, tabs: { onRemoved: { addListener() {} } }, windows: { onRemoved: { addListener() {} } } };
  const start = () => runInNewContext(moduleSource('src/background/background.ts'), { chrome, console, Date: { now: () => now } });
  start();
  const send = (entry = raw, id = 1, url = 'https://www.youtube.com/watch?v=secret') => new Promise(resolve => {
    const result = listeners.message({ type: 'ytg-diagnostic', entry }, { frameId: 0, tab: { id }, url }, resolve);
    if (!result) resolve(null);
  });
  await Promise.all([send({ ...raw, version: 'forged' }), send(raw, 2)]);
  assert.equal(saved['ytg-diagnostics'].length, 2); assert.equal(saved['ytg-diagnostics'][0].version, '0.2.0');
  start(); await send(); assert.equal(saved['ytg-diagnostics'].length, 3);
  assert.equal(await send(raw, 3, 'https://example.com/'), null);
  await Promise.all(Array.from({ length: 110 }, () => send()));
  assert.equal(writes, 102); assert.ok(saved['ytg-diagnostics'].length <= 100);
  now += 60000; await send(); assert.equal(writes, 103);
  assert.equal(listeners.message({ type: 'ytg-clear-diagnostics' }, { id: 'test', url: 'https://www.youtube.com/' }, () => {}), undefined);
  const pending = send();
  await new Promise(resolve => listeners.message({ type: 'ytg-clear-diagnostics' }, { id: 'test', url: chrome.runtime.getURL('src/settings/options.html') }, resolve));
  await pending; assert.equal(saved['ytg-diagnostics'], undefined);
  await send();
  const inlineRequest = { type: 'ytg-clear-inline-diagnostics' };
  const inlineSender = { id: 'test', frameId: 0, tab: { id: 1, active: true }, url: 'https://www.youtube.com/' };
  for (const sender of [{ ...inlineSender, id: 'other' }, { ...inlineSender, frameId: 1 }, { ...inlineSender, tab: { id: 1, active: false } }, { ...inlineSender, url: 'https://example.com/' }]) {
    assert.equal(listeners.message(inlineRequest, sender, () => {}), undefined);
  }
  assert.equal(saved['ytg-diagnostics'].length, 1);
  await new Promise(resolve => listeners.message(inlineRequest, inlineSender, resolve));
  assert.equal(saved['ytg-diagnostics'], undefined);
});

