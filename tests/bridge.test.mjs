import { legacyModuleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = ['src/shared/actions.ts', 'src/input/bindings.ts', 'src/app/content.ts'].map(file => legacyModuleSource(file)).join('\n');
function setup() {
  const listeners = new Map(), intervals = new Set(), messages = [], storageListeners = new Set(), runtimeListeners = new Set();
  let observerCallback, disconnects = 0, themeWrites = 0, delayedSettings;
  const target = () => ({
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  });
  const eventSource = set => ({ addListener: fn => set.add(fn), removeListener: fn => set.delete(fn) });
  const window = { ...target(), postMessage: message => messages.push(message) };
  const context = {
    window, console, location: { origin: 'https://www.youtube.com' },
    document: { ...target(), hidden: false, documentElement: { hasAttribute: () => false } },
    navigator: { getGamepads: () => [] },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { disconnects++; }
    },
    chrome: {
      runtime: { id: 'test', onMessage: eventSource(runtimeListeners), sendMessage: async () => ({ ok: true }) },
      storage: { onChanged: eventSource(storageListeners), local: {
        get(defaults, callback) { delayedSettings = () => callback(defaults); callback(defaults); },
        set() { themeWrites++; return Promise.resolve(); }
      } }
    }
  };
  return { window, listeners, intervals, messages, storageListeners, runtimeListeners, context,
    boot: () => runInNewContext(source, context),
    fire: (type, event) => [...listeners.get(type) || []].forEach(fn => fn(event)),
    get staleCallbacks() { return [...intervals, ...[...listeners.values()].flatMap(set => [...set])]; },
    lateSettings: () => delayedSettings(), observe: () => observerCallback(),
    get disconnects() { return disconnects; }, get themeWrites() { return themeWrites; }
  };
}

test('bridge starts and publishes settings without YTGamepadRuntime', () => {
  const s = setup();
  s.boot();
  assert.equal(s.window.YTGamepadRuntime, undefined);
  assert.equal(s.messages[0].source, 'yt-gamepad-settings');
  assert.equal(s.messages[0].values.enabled, true);
  assert.equal(s.intervals.size, 1);
  assert.equal(s.runtimeListeners.size, 2);
});

test('bridge preserves bfcache and releases all resources on final pagehide', () => {
  const s = setup(); s.boot();
  s.fire('pagehide', { persisted: true });
  assert.equal(s.intervals.size, 1);
  const stale = s.staleCallbacks;
  s.fire('pagehide', { persisted: false });
  for (const callback of stale) callback({});
  s.lateSettings(); s.observe();
  assert.equal(s.intervals.size, 0);
  assert.equal([...s.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal(s.storageListeners.size, 0); assert.equal(s.runtimeListeners.size, 0);
  assert.equal(s.disconnects, 1); assert.equal(s.messages.length, 1); assert.equal(s.themeWrites, 1);
});

test('reinjected bridge replaces its old listeners and polling', () => {
  const s = setup(); s.boot();
  const stale = s.staleCallbacks;
  s.boot();
  for (const callback of stale) callback({});
  assert.equal(s.intervals.size, 1); assert.equal(s.storageListeners.size, 1);
  assert.equal(s.runtimeListeners.size, 2); assert.equal(s.listeners.get('message').size, 1);
  assert.equal(s.disconnects, 1); assert.equal(s.messages.length, 2);
});

for (const asynchronous of [false, true]) {
  test(`invalidated runtime ${asynchronous ? 'rejection' : 'synchronous throw'} disposes old bridge`, async () => {
    const s = setup(); s.boot();
    const stale = s.staleCallbacks;
    let calls = 0;
    s.context.navigator.getGamepads = () => [{ connected: true, mapping: 'standard' }];
    s.context.chrome.runtime.sendMessage = () => {
      calls++;
      const error = new Error('Extension context invalidated.');
      if (asynchronous) return Promise.reject(error);
      throw error;
    };
    assert.doesNotThrow(() => [...s.intervals][0]());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.intervals.size, 0);
    assert.equal(s.storageListeners.size, 0);
    assert.equal(s.runtimeListeners.size, 0);
    assert.equal(s.disconnects, 1);
    for (const callback of stale) callback({});
    s.lateSettings(); s.observe();
    assert.equal(calls, 1, 'stale callbacks never retry an invalidated extension');
    assert.equal(s.messages.length, 1);
  });
}

test('invalidated theme storage and delayed settings reads stop the bridge without throwing', async () => {
  for (const operation of ['theme', 'settings']) {
    const s = setup(); s.boot();
    const error = new Error('Extension context invalidated.');
    if (operation === 'theme') {
      s.context.document.documentElement.hasAttribute = () => true;
      s.context.chrome.storage.local.set = () => { throw error; };
      assert.doesNotThrow(() => s.observe());
    } else {
      s.context.chrome.storage.local.get = () => { throw error; };
      assert.doesNotThrow(() => s.fire('message', { source: s.window,
        origin: 'https://www.youtube.com', data: { source: 'yt-gamepad-ready' } }));
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.intervals.size, 0);
    assert.equal(s.storageListeners.size, 0);
    assert.equal(s.runtimeListeners.size, 0);
  }
});

for (const trigger of ['poll', 'settings']) {
  test(`invalidated context without a controller stops the bridge on ${trigger}`, () => {
    const s = setup(); s.boot();
    let invalidated = 0;
    s.context.chrome.runtime.id = undefined;
    s.context.chrome.storage.onChanged.removeListener = () => { throw new Error('Extension context invalidated.'); };
    s.context.YTGamepadInlineSettings = { mount() { invalidated++; throw new Error('Extension context invalidated.'); } };
    s.context.document.getElementById = () => ({ shadowRoot: { querySelector: () => ({}) } });
    assert.doesNotThrow(() => {
      if (trigger === 'poll') [...s.intervals][0]();
      else s.fire('message', { source: s.window, origin: 'https://www.youtube.com', data: { source: 'yt-gamepad-open-settings' } });
    });
    assert.equal(invalidated, 0, 'stale settings never mount');
    assert.equal(s.intervals.size, 0);
    assert.equal(s.runtimeListeners.size, 0);
    assert.equal(s.disconnects, 1);
  });
}
