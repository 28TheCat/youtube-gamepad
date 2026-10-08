import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Exercise the production model, including the Vue scheduler, without changing
// production exports or depending on a browser installation for failure cases.
const bundle = await build({
  configFile: false, publicDir: false, logLevel: 'silent',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/settings/inline-settings-model.ts', import.meta.url)),
    formats: ['iife'], name: 'SettingsModelFixture'
  } }
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code;
const flush = () => new Promise(resolve => setImmediate(resolve));

async function setup({ failLoad = false, invalidatedAt = '' } = {}) {
  let listener, removed = 0, disconnected = 0, focused = '', writes = [], setImpl;
  const saved = { enabled: true, theater: true, autoFullscreen: false };
  const message = { textContent: '' };
  const controls = ['general', 'display', 'theater', 'autoFullscreen', 'controller', 'confirm', '0', '1', 'repeatDelay-+']
    .map(id => ({ dataset: { setting: id }, focus() { focused = id; root.activeElement = this; }, scrollIntoView() {} }));
  const root = { activeElement: null, querySelector: () => message };
  const container = { isConnected: true, contains: node => controls.includes(node), querySelectorAll: () => controls };
  const context = {
    console, setTimeout, clearTimeout,
    location: { pathname: '/' },
    document: { documentElement: { dataset: {} }, createElement: () => ({}) },
    MutationObserver: class { observe() {} disconnect() { ++disconnected; } },
    chrome: { storage: {
      onChanged: { addListener(fn) {
        if (invalidatedAt === 'listener') throw new Error('Extension context invalidated.');
        listener = fn;
      }, removeListener(fn) {
        if (invalidatedAt) throw new Error('Extension context invalidated.');
        if (fn === listener) ++removed;
      } },
      local: {
        get(defaults) {
          if (invalidatedAt === 'read') throw new Error('Extension context invalidated.');
          if (failLoad) return Promise.reject(new Error('load failed'));
          return Promise.resolve({ ...defaults, ...saved });
        },
        async set(next) {
          writes.push(structuredClone(next));
          if (setImpl) await setImpl(next);
          Object.assign(saved, next);
          listener(Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }])), 'local');
        }
      }
    } }
  };
  runInNewContext(code, context);
  const model = context.SettingsModelFixture.createInlineSettingsModel(root, container);
  model.start(); await flush();
  return { model, message, root, controls, writes, saved,
    get focused() { return focused; },
    get removed() { return removed; }, get disconnected() { return disconnected; },
    failWrites() { setImpl = async () => { throw new Error('write failed'); }; },
    setWriter(fn) { setImpl = fn; },
    change(values) { listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); }
  };
}

test('failed inline saves leave values intact, announce failure and retain the active action', async () => {
  const s = await setup();
  s.model.open('display'); await flush();
  s.controls.find(node => node.dataset.setting === 'theater').focus();
  s.failWrites(); s.model.toggle('theater'); await flush();
  assert.equal(s.model.state.values.theater, true);
  assert.equal(s.model.state.saving, false);
  assert.match(s.message.textContent, /Could not save settings/);
  assert.equal(s.focused, 'theater');
  s.model.dispose();
});

test('closing during a pending save cancels focus/feedback and removes listeners', async () => {
  const s = await setup();
  let finish;
  s.setWriter(() => new Promise(resolve => { finish = resolve; }));
  s.controls.find(node => node.dataset.setting === 'theater').focus();
  s.model.toggle('theater');
  assert.equal(s.model.state.saving, true);
  s.model.dispose();
  s.root.activeElement = { dataset: { setting: 'outside' } };
  finish(); await flush();
  assert.equal(s.message.textContent, '');
  assert.equal(s.focused, 'theater');
  assert.equal(s.removed, 1); assert.equal(s.disconnected, 1);
});

test('external settings normalize bounded values without stealing focus from the menu footer', async () => {
  const s = await setup();
  s.root.activeElement = { dataset: {} };
  s.change({ deadzone: 10, repeatDelay: 1, repeatInterval: NaN }); await flush();
  assert.equal(s.model.state.values.deadzone, .75);
  assert.equal(s.model.state.values.repeatDelay, 150);
  assert.equal(s.model.state.values.repeatInterval, 140);
  assert.equal(s.focused, 'general');
  assert.equal(s.writes.length, 0);
  s.model.dispose();
});

test('load failure replaces the loading status and remains safe to dispose', async () => {
  const s = await setup({ failLoad: true });
  assert.equal(s.model.state.values, null);
  assert.match(s.model.state.error, /Could not load settings/);
  assert.match(s.message.textContent, /Close and reopen/);
  s.model.dispose();
  assert.equal(s.removed, 1);
});

for (const invalidatedAt of ['read', 'listener']) {
  test(`synchronous invalidation during ${invalidatedAt} is handled and cleanup stays safe`, async () => {
    const s = await setup({ invalidatedAt });
    assert.equal(s.model.state.values, null);
    assert.match(s.model.state.error, /Could not load settings/);
    assert.doesNotThrow(() => s.model.dispose());
    assert.doesNotThrow(() => s.model.dispose());
    assert.equal(s.disconnected, 1);
  });
}
