import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// No document, location, history, media or clock exists in this context.
const window = {};
runInNewContext(['src/app/route-state.ts', 'src/app/state-machine.ts'].map(file => moduleSource(file)).join('\n'), { window });
const { createState, createStore, transition } = window.YTGamepadStateMachine;
const plain = value => JSON.parse(JSON.stringify(value));
const effects = result => result.effects.map(effect => effect.type).join(',');
test('hidden playback controls allow direct directional seeking without moving invisible focus', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MODE', value: 'playback', route: '/watch?v=first' });
  for (const [action, media] of [['left', 'seekBack'], ['right', 'seekForward']]) {
    const result = store.dispatch({ type: 'BASE_INPUT', action, route: '/watch?v=first' });
    assert.deepEqual(plain(result.effects), [{ type: 'media', value: media }]);
    assert.equal(store.state.app.mode, 'playback');
  }
});

test('recommendation grid moves between rows, clamps a short last row and requests more at the end', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'WATCH_SHOW', target: 'recommendations', count: 10 });
  const input = action => store.dispatch({ type: 'WATCH_INPUT', action, cardCount: 10, cardColumns: 4 });
  input('right'); input('right'); input('right'); input('right');
  assert.equal(store.state.watch.index, 3, 'right stops at the edge of the current row');
  input('down'); assert.equal(store.state.watch.index, 7);
  input('down'); assert.equal(store.state.watch.index, 9, 'short last row selects a surviving card');
  input('right'); assert.equal(store.state.watch.index, 9, 'right stops at the end of a short last row');
  input('left'); assert.equal(store.state.watch.index, 8);
  input('left'); assert.equal(store.state.watch.index, 8, 'left stops at the start of the current row');
  input('right'); assert.equal(store.state.watch.index, 9);
  assert.equal(effects(input('down')), 'loadRecommendations,focus');
  assert.equal(store.state.watch.index, 9, 'loading cannot move selection past the list');
  input('up'); assert.equal(store.state.watch.index, 5);
  input('up'); assert.equal(store.state.watch.index, 1);
  input('up'); assert.equal(store.state.watch.row, 'controls');
  input('down'); assert.equal(store.state.watch.index, 1, 'returning preserves recommendation selection');
  input('back'); assert.equal(store.state.watch.row, 'controls');
});

test('transitions are deterministic, replayable and leave frozen previous states untouched', () => {
  const store = createStore(createState('/watch?v=first'));
  const original = store.state;
  const event = Object.freeze({ type: 'WATCH_SHOW', target: 'recommendations', count: 3 });
  assert.deepEqual(plain(transition(original, event)), plain(transition(original, event)));
  store.dispatch(event);
  assert.equal(original.watch.row, 'controls');
  assert.equal(store.state.watch.row, 'recommendations');
  assert.throws(() => { store.state.watch.row = 'progress'; }, TypeError);
  const replay = transition(plain(original), plain(event));
  assert.deepEqual(plain(replay.nextState), plain(store.state));
});

test('all layer combinations resolve exactly one owner and native shortcuts never fall through', () => {
  const state = createState('/watch?v=first');
  for (let bits = 0; bits < 16; bits++) {
    const flags = { menu: !!(bits & 1), native: !!(bits & 2), panel: !!(bits & 4), help: !!(bits & 8) };
    for (const action of ['back', 'confirm', 'playPause', 'search']) {
      const result = transition(state, { type: 'INPUT_OWNER', enabled: true, navigating: false, action, ...flags });
      const owner = flags.menu ? 'menu' : flags.native ? 'native' : flags.panel ? 'panel' : flags.help ? 'help' : 'region';
      if (owner === 'native' && ['playPause', 'search'].includes(action)) {
        assert.equal(result.disposition, 'blocked'); assert.equal(result.effects.length, 0);
      } else {
        assert.equal(result.effects.length, 1); assert.equal(result.effects[0].value, owner);
      }
    }
  }
});

test('search over recommendations unwinds language, composition, search and menu one layer at a time', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MODE', value: 'controls', route: '/watch?v=first' });
  store.dispatch({ type: 'WATCH_FOCUS', region: 'controls', index: 7 });
  store.dispatch({ type: 'WATCH_SHOW', target: 'recommendations', count: 3 });
  store.dispatch({ type: 'MENU_OPEN' });
  store.dispatch({ type: 'MENU_SEARCH', selected: 2 });
  store.dispatch({ type: 'MENU_COMPOSE', value: 'ni' });
  store.dispatch({ type: 'MENU_LANGUAGE', value: true });
  for (const expected of ['languageFocus', 'compositionFocus', 'mainFocus', 'closeMenu']) {
    assert.equal(effects(store.dispatch({ type: 'MENU_INPUT', action: 'back' })), expected);
    assert.equal(store.state.watch.row, 'recommendations');
    assert.equal(store.state.app.mode, 'controls');
  }
  assert.equal(store.state.menu.opened, false);
  assert.equal(effects(store.dispatch({ type: 'WATCH_INPUT', action: 'back' })), 'focus');
  assert.equal(store.state.watch.row, 'controls'); assert.equal(store.state.watch.index, 7);
  assert.equal(effects(store.dispatch({ type: 'WATCH_INPUT', action: 'back' })), 'mode');
});

test('page search closes directly and editing shortcuts cannot generate playback effects', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MENU_SEARCH', selected: 0 });
  assert.equal(store.state.menu.openedFrom, 'pageSearch');
  for (const action of ['playPause', 'seekBack', 'seekForward', 'mute']) {
    const result = store.dispatch({ type: 'MENU_INPUT', action });
    assert.equal(result.effects.length, 1);
    assert.ok(!['media', 'pageBack', 'historyGo', 'assign'].includes(result.effects[0].type));
  }
  assert.equal(effects(store.dispatch({ type: 'MENU_INPUT', action: 'back' })), 'closeMenu');
});

test('panel scroll observations keep the selected comment until its body is visible', () => {
  const store = createStore();
  store.dispatch({ type: 'WATCH_PANEL', panel: 'comments' });
  store.dispatch({ type: 'WATCH_FOCUS', region: 'panel', index: 1 });
  assert.equal(effects(store.dispatch({ type: 'WATCH_INPUT', action: 'down', commentCount: 3, scrollDelta: 90 })), 'panelScroll');
  assert.equal(store.state.watch.panelIndex, 1);
  store.dispatch({ type: 'WATCH_INPUT', action: 'down', commentCount: 3, scrollDelta: 0 });
  assert.equal(store.state.watch.panelIndex, 2);
  assert.equal(store.dispatch({ type: 'WATCH_INPUT', action: 'playPause' }).disposition, 'blocked');
  assert.equal(effects(store.dispatch({ type: 'WATCH_INPUT', action: 'back' })), 'closePanel');
  assert.equal(store.state.watch.panel, '');
});

test('verified history chains return once; traversal and duplicate finishes cannot increase depth', () => {
  const store = createStore(createState('/results?search_query=music'));
  for (const [route, target] of [['/results?search_query=music', '/watch?v=first'], ['/watch?v=first', '/watch?v=second']]) {
    store.dispatch({ type: 'PREPARE_VIDEO', route, target });
    store.dispatch({ type: 'HISTORY', method: 'pushState', route: target, changed: true });
    store.dispatch({ type: 'NAV_FINISH', route: target });
    store.dispatch({ type: 'NAV_FINISH', route: target });
  }
  assert.equal(store.state.app.watchDepth, 2);
  const result = store.dispatch({ type: 'PAGE_BACK', route: '/watch?v=second', temporaryLayer: false });
  assert.equal(effects(result), 'pause,closeMenu,historyGo');
  assert.equal(result.effects[2].value, -2);
  assert.equal(store.dispatch({ type: 'PAGE_BACK', route: '/watch?v=second' }).disposition, 'blocked');
  store.dispatch({ type: 'POPSTATE', route: '/results?search_query=music' });
  assert.equal(store.state.app.returning, true);
  assert.equal(store.dispatch({ type: 'BASE_INPUT', action: 'confirm', route: '/watch?v=second' }).disposition, 'blocked');
  store.dispatch({ type: 'NAV_FINISH', route: '/results?search_query=music' });
  assert.equal(store.state.app.returning, false);
});

test('uncertain or canceled history uses the source URL without guessing a jump', () => {
  const store = createStore(createState('/results'));
  store.dispatch({ type: 'PREPARE_VIDEO', route: '/results', target: '/watch?v=first' });
  store.dispatch({ type: 'HISTORY', method: 'pushState', route: '/watch?v=first', changed: true });
  store.dispatch({ type: 'NAV_CANCEL', route: '/watch?v=first' });
  const result = store.dispatch({ type: 'PAGE_BACK', route: '/watch?v=first' });
  assert.equal(effects(result), 'pause,closeMenu,assign'); assert.equal(result.effects[2].value, '/results');
});

test('navigation blocks every interactive slice, including menus, until completion', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MENU_OPEN' });
  store.dispatch({ type: 'NAV_START' });
  for (const event of [{ type: 'MENU_INPUT', action: 'back' }, { type: 'WATCH_INPUT', action: 'confirm' },
    { type: 'BASE_INPUT', action: 'back', route: '/watch?v=first' }]) {
    const state = store.state, result = store.dispatch(event);
    assert.equal(result.disposition, 'blocked'); assert.equal(result.effects.length, 0); assert.equal(store.state, state);
  }
  store.dispatch({ type: 'ENABLE', enabled: false, route: '/watch?v=first' });
  assert.equal(store.state.menu.opened, false); assert.ok(store.state.app.navigation);
  store.dispatch({ type: 'NAV_CANCEL', route: '/watch?v=first' });
  assert.equal(store.state.app.mode, 'browse'); assert.equal(store.state.app.navigation, null);
});

test('auto-hide requires playing idle controls with no layer, recommendation focus or navigation', () => {
  for (const blocker of ['paused', 'idle', 'menu', 'panel', 'native', 'recommendations', 'navigation']) {
    const store = createStore(createState('/watch?v=first'));
    store.dispatch({ type: 'MODE', value: 'controls', route: '/watch?v=first' });
    if (blocker === 'menu') store.dispatch({ type: 'MENU_OPEN' });
    if (blocker === 'panel') store.dispatch({ type: 'WATCH_PANEL', panel: 'description' });
    if (blocker === 'recommendations') store.dispatch({ type: 'WATCH_SHOW', target: 'recommendations', count: 3 });
    if (blocker === 'navigation') store.dispatch({ type: 'NAV_START' });
    const result = store.dispatch({ type: 'AUTO_HIDE', playing: blocker !== 'paused', idle: blocker === 'idle' ? 5000 : 6000,
      temporaryLayer: blocker === 'native' });
    assert.equal(store.state.app.mode, 'controls', blocker); assert.equal(result.effects.length, 0, blocker);
  }
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MODE', value: 'controls', route: '/watch?v=first' });
  assert.equal(effects(store.dispatch({ type: 'AUTO_HIDE', playing: true, idle: 6000 })), 'renderMode');
  assert.equal(store.state.app.mode, 'playback');
});


test('slider B unwinds adjustment, progress focus, controls and playback separately', () => {
  const store = createStore(createState('/watch?v=first'));
  store.dispatch({ type: 'MODE', value: 'controls', route: '/watch?v=first' });
  store.dispatch({ type: 'WATCH_FOCUS', region: 'controls', index: 9 });
  const input = action => store.dispatch({ type: 'WATCH_INPUT', action, controlCount: 12 });
  input('up');
  assert.equal(store.state.watch.row, 'progress');
  assert.equal(effects(input('right')), '');
  input('confirm');
  assert.equal(store.state.watch.adjusting, true);
  assert.equal(effects(input('left')), 'activate');
  assert.equal(input('down').disposition, 'blocked');
  input('back');
  assert.equal(store.state.watch.adjusting, false);
  assert.equal(store.state.watch.row, 'progress');
  input('back');
  assert.equal(store.state.watch.row, 'controls');
  assert.equal(store.state.watch.index, 9);
  assert.equal(effects(input('back')), 'mode');
});
