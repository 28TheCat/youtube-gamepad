import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { createPinia, disposePinia } from 'pinia';
import { createRenderer, h, watch } from 'vue';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Load the production TS store with real Vue/Pinia, independent of Chromium.
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ configFile: false, root, publicDir: false, logLevel: 'silent',
  build: { write: false, minify: false,
    lib: { entry: root + '/src/app/interaction-store.ts', formats: ['es'] },
    rolldownOptions: { external: ['vue', 'pinia'] }
  }
});
mkdirSync(root + '/output/testing', { recursive: true });
const file = root + '/output/testing/interaction-store.mjs';
const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(result => result.output);
writeFileSync(file, outputs.find(item => item.type === 'chunk').code);
const { useInteractionStore } = await import(pathToFileURL(file).href + '?run=' + Date.now());

test('Pinia commits immutable state before effects and isolates page instances', () => {
  const pinia = createPinia(), otherPinia = createPinia();
  try {
    const store = useInteractionStore(pinia), other = useInteractionStore(otherPinia);
    const seen = [];
    const stop = watch(() => store.state, state => seen.push(state), { flush: 'sync' });
    const previous = store.state;
    const result = store.dispatch({ type: 'MENU_OPEN' });
    assert.equal(store.state, result.nextState);
    assert.equal(seen.at(-1), store.state);
    assert.equal(previous.menu.opened, false);
    assert.ok(Object.isFrozen(store.state));
    assert.ok(Object.isFrozen(store.state.menu));
    assert.throws(() => { store.state.menu.opened = false; }, TypeError);
    store.dispatch({ type: 'MENU_SEARCH', selected: 3 });
    const back = store.dispatch({ type: 'MENU_INPUT', action: 'back' });
    assert.equal(store.state.menu.view, 'main');
    assert.equal(store.state.menu.menuSelection, 3);
    assert.equal(back.effects[0].type, 'mainFocus');
    const close = store.dispatch({ type: 'MENU_INPUT', action: 'back' });
    assert.equal(store.state.menu.opened, false);
    assert.equal(close.effects[0].type, 'closeMenu');
    assert.equal(other.state.menu.opened, false);
    assert.equal(other.state.menu.menuSelection, 0);
    stop();
  } finally { disposePinia(pinia); disposePinia(otherPinia); }
});

// Minimal Vue host: exercises actual mount/unmount without a browser executable.
test('navigation locks menu, playback and base actions in the real Pinia store', () => {
  const pinia = createPinia();
  try {
    const store = useInteractionStore(pinia);
    store.dispatch({ type: 'APP_INIT', route: '/watch?v=first' });
    store.dispatch({ type: 'MENU_OPEN' });
    store.dispatch({ type: 'NAV_START' });
    for (const event of [{ type: 'MENU_INPUT', action: 'back' },
      { type: 'WATCH_INPUT', action: 'confirm' },
      { type: 'BASE_INPUT', action: 'back', route: '/watch?v=first' }]) {
      const before = store.state, result = store.dispatch(event);
      assert.equal(result.disposition, 'blocked');
      assert.deepEqual(result.effects, []);
      assert.equal(store.state, before);
    }
    store.dispatch({ type: 'NAV_CANCEL', route: '/watch?v=first' });
    assert.equal(store.dispatch({ type: 'MENU_INPUT', action: 'back' }).disposition, 'handled');
  } finally { disposePinia(pinia); }
});

const renderer = createRenderer({
  createElement: tag => ({ tag, children: [] }), createText: text => ({ text }),
  createComment: text => ({ text }), setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; }, patchProp() {},
  insert: (node, parent) => { node.parent = parent; parent.children.push(node); },
  remove: node => { const list = node.parent?.children; if (list) list.splice(list.indexOf(node), 1); },
  parentNode: node => node.parent, nextSibling: () => null
});

test('unmounting and reopening a Vue panel preserves page interaction state', () => {
  const pinia = createPinia();
  try {
    const store = useInteractionStore(pinia);
    store.dispatch({ type: 'APP_INIT', route: '/watch?v=persistent' });
    store.dispatch({ type: 'MENU_OPEN' });
    const snapshot = store.state;
    const mount = () => {
      const app = renderer.createApp({ setup() {
        const sameStore = useInteractionStore();
        assert.equal(sameStore, store);
        return () => h('section', sameStore.state.app.route);
      } });
      app.use(pinia); app.mount({ children: [] });
      return app;
    };
    mount().unmount();
    assert.equal(store.state, snapshot);
    const reopened = mount();
    assert.equal(store.state.app.route, '/watch?v=persistent');
    assert.equal(store.state.menu.opened, true);
    reopened.unmount();
  } finally { disposePinia(pinia); }
});
