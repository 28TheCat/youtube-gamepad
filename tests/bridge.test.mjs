import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = ['actions.js', 'bindings.js', 'content.js'].map(file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')).join('\n');
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
  return { window, listeners, intervals, messages, storageListeners, runtimeListeners,
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
