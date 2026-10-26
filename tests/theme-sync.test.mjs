import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript-vue';

const source = ts.transpileModule(readFileSync(new URL('../src/shared/page-appearance.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup({ saved, tab, dark = false } = {}) {
  const attrs = new Set(), events = {};
  const system = { matches: dark, addEventListener(_type, callback) { events.system = callback; },
    removeEventListener() { delete events.system; } };
  const state = { saved, tab };
  const exports = {}; let mount, dispose, removed = 0;
  runInNewContext(source, {
    exports, matchMedia: () => system, navigator: { getGamepads: () => [] },
    require: name => name === 'vue' ? { onMounted(callback) { mount = callback; }, onUnmounted(callback) { dispose = callback; } }
      : name === '../input/controller-style.ts' ? { YTGamepadControllerStyle: {
        css: '', configureBindings() {}, use() {}, hint() {},
        register() { return () => { removed++; }; }
      } } : {},
    setInterval(callback) { events.interval = callback; return 1; }, clearInterval() { delete events.interval; },
    document: { documentElement: {
      toggleAttribute(name, on) { if (on) attrs.add(name); else attrs.delete(name); },
      setAttribute(name) { attrs.add(name); }
    }, head: { append() {} }, createElement: () => ({ remove() { removed++; } }), querySelectorAll: () => [] },
    chrome: {
      storage: { local: { async get() { return { uiTheme: state.saved }; } },
        onChanged: { addListener(callback) { events.storage = callback; }, removeListener() { delete events.storage; } } },
      tabs: { async query() { return [{ id: 1 }]; }, async sendMessage() {
        if (state.tab === undefined) throw new Error('No YouTube receiver');
        return { theme: await state.tab };
      } }
    }
  });
  exports.usePageAppearance(); mount();
  return { state, system, events, dispose: () => dispose(), get removed() { return removed; },
    theme: () => attrs.has('dark') ? 'dark' : 'light' };
}

test('current YouTube theme wins over remembered and system themes', async () => {
  const ui = setup({ saved: 'dark', tab: 'light', dark: true });
  await settle();
  assert.equal(ui.theme(), 'light');
});

test('unavailable tab uses remembered theme, then system for missing or invalid values', async () => {
  const remembered = setup({ saved: 'light', dark: true });
  const missing = setup({ dark: true });
  const invalid = setup({ saved: 'invalid', tab: 'invalid', dark: false });
  await settle();
  assert.equal(remembered.theme(), 'light');
  assert.equal(missing.theme(), 'dark');
  assert.equal(invalid.theme(), 'light');
});

test('YouTube changes update an open UI while system changes cannot override its theme', async () => {
  const ui = setup({ saved: 'light', tab: 'light' });
  await settle();
  ui.system.matches = true;
  ui.events.system();
  await settle();
  assert.equal(ui.theme(), 'light');
  ui.state.tab = 'dark';
  ui.events.storage({ uiTheme: { newValue: 'dark' } }, 'local');
  await settle();
  assert.equal(ui.theme(), 'dark');
});

test('system fallback follows system changes', async () => {
  const ui = setup();
  await settle();
  ui.system.matches = true;
  ui.events.system();
  await settle();
  assert.equal(ui.theme(), 'dark');
});

test('late responses from an older refresh cannot undo the latest theme', async () => {
  let release;
  const ui = setup({ tab: new Promise(resolve => { release = resolve; }) });
  await settle();
  ui.state.tab = 'dark';
  ui.events.storage({ uiTheme: { newValue: 'dark' } }, 'local');
  await settle();
  release('light');
  await settle();
  assert.equal(ui.theme(), 'dark');
});

test('unmount cancels appearance updates and releases listeners, timer and style', async () => {
  let release;
  const ui = setup({ tab: new Promise(resolve => { release = resolve; }) });
  await settle(); ui.dispose(); release('dark'); await settle();
  assert.equal(ui.theme(), 'light');
  assert.equal(ui.events.system, undefined);
  assert.equal(ui.events.storage, undefined);
  assert.equal(ui.events.interval, undefined);
  assert.equal(ui.removed, 2);
});
