import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual core -> injected policy -> site chain. UI ports are small
// doubles so this checks ownership independently of rendering and selectors.
function setup() {
  const commands = [], listeners = new Map();
  let overlay = null, watchPort, menuPort;
  const node = () => ({ isConnected: true, style: {}, dataset: {},
    classList: { toggle() {}, remove() {}, add() {}, contains: () => false },
    contains: () => false, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    getAttribute: () => null, focus() {}, scrollIntoView() {},
    append() {}, attachShadow: () => ({ append() {} }) });
  const addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  };
  const video = { paused: false, ended: false, currentTime: 20, duration: 100,
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const document = { body: node(), documentElement: node(), createElement: node, addEventListener,
    contains: () => true,
    querySelector: selector => selector.startsWith('video') ? video : selector === '#movie_player'
      ? { isConnected: true, contains: value => value === video, querySelector: () => ({ isConnected: true, click() {} }) } : null,
    querySelectorAll: selector => selector.startsWith('[role=') && overlay ? [overlay] : [] };
  const menu = { opened: false, state: {}, connect(port) { menuPort = port; }, close() { this.opened = false; },
    handle(action) {
      commands.push('menu:' + action);
      if (action === 'search' || action === 'help') { this.opened = true; return 'handled'; }
      if (action === 'back') { this.close(); return 'handled'; }
      return 'pass';
    } };
  const watch = { state: { panel: '', row: 'controls' }, ownsFocus: false,
    connect(port) { watchPort = port; }, refresh() {},
    sync(mode) { this.state.mode = mode; this.ownsFocus = mode === 'controls'; },
    show() { watchPort.request('mode', 'controls'); },
    handle(action) {
      if (this.state.mode !== 'controls') return false;
      commands.push('watch:' + action);
      if (action === 'back') {
        if (this.state.panel) this.state.panel = '';
        else watchPort.request('mode', 'playback');
        return true;
      }
      return false;
    },
    handleInput(action) { return this.handle(action) ? 'handled' : 'blocked'; } };
  const window = { addEventListener, postMessage() {}, YTGamepadMenu: menu, YTGamepadWatch: watch,
    YTGamepadInput: { configure() {}, connected: false } };
  const location = { pathname: '/watch', search: '?v=current', origin: 'https://www.youtube.com', assign(path) { commands.push('navigate:' + path); } };
  const context = { window, document, location, URL, URLSearchParams, history: { back() {}, go() {} },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {}, setTimeout, clearTimeout };
  for (const file of ['app/route-state.js', 'state-machine.js', 'core.js', 'sites/youtube.js', 'coordinator.js']) {
    runInNewContext(moduleSource(file), context);
  }
  return { window, watch, menu, commands, video, get watchPort() { return watchPort; }, get menuPort() { return menuPort; },
    act: action => window.YTGamepad.act(action),
    nativeDialog() {
      overlay = { ...node(), matches: () => false, querySelectorAll: () => [],
        querySelector: () => ({ click() { overlay = null; commands.push('native:back'); } }) };
    },
    event(name) { for (const callback of listeners.get(name) || []) callback({}); }
  };
}

test('real coordinator routes shortcuts and prevents an open menu from leaking actions', () => {
  const s = setup();
  assert.equal(s.act('confirm'), 'handled'); assert.equal(s.video.paused, true);
  assert.equal(s.act('up'), 'handled'); assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.act('search'), 'handled'); assert.equal(s.menu.opened, true);
  assert.equal(s.act('confirm'), 'blocked'); assert.equal(s.video.paused, true);
  assert.equal(s.act('back'), 'handled'); assert.equal(s.menu.opened, false);
  assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.act('back'), 'handled'); assert.equal(s.watch.state.mode, 'playback');
  assert.equal(s.act('back'), 'handled');
  assert.ok(s.commands.includes('navigate:/'));
});

test('real policy keeps menu, native dialog and watch panel in separate input layers', () => {
  const s = setup(); s.act('up'); s.watch.state.panel = 'description';
  s.nativeDialog(); s.menu.opened = true;
  assert.equal(s.act('back'), 'handled'); assert.equal(s.watch.state.panel, 'description');
  assert.equal(s.act('playPause'), 'blocked'); assert.equal(s.video.paused, false);
  assert.equal(s.act('back'), 'handled'); assert.ok(s.commands.includes('native:back'));
  assert.equal(s.watch.state.panel, 'description');
  assert.equal(s.act('back'), 'handled'); assert.equal(s.watch.state.panel, '');
  assert.equal(s.watch.state.mode, 'controls');
});

test('injected UI action ports obey navigation locks and disabled settings', () => {
  const s = setup();
  assert.equal(typeof s.menuPort.submitSearch, 'function');
  assert.equal(typeof s.watchPort.readWatchPage, 'function');
  s.event('yt-navigate-start');
  assert.equal(s.menuPort.dispatchAction('search'), 'blocked');
  assert.equal(s.watchPort.dispatchAction('confirm'), 'blocked');
  assert.equal(s.menu.opened, false); assert.equal(s.video.paused, false);
  s.event('yt-navigate-cancel');
  assert.equal(s.menuPort.dispatchAction('search'), 'handled');
  for (const callback of []) callback();
  s.window.YTGamepad.configure({ enabled: false });
  assert.equal(s.menu.opened, false);
  assert.equal(s.watchPort.dispatchAction('confirm'), 'blocked');
});

test('view commands share one lock before media, recommendation, settings or mode changes', () => {
  const s = setup();
  const commands = [['media', 'playPause'], ['seek', 50], ['recommendation', 'next'],
    ['settings'], ['backSettings'], ['channel'], ['comments', true], ['replies', 'comment'], ['mode', 'controls']];
  s.event('yt-navigate-start');
  for (const [type, value] of commands) assert.equal(s.watchPort.request(type, value), false, type);
  assert.equal(s.video.paused, false); assert.equal(s.video.currentTime, 20);
  assert.equal(s.window.YTGamepadCoordinator.mode, 'playback');
  s.event('yt-navigate-finish'); s.event('yt-gamepad-exit');
  for (const [type, value] of commands) assert.equal(s.watchPort.request(type, value), false, type);
  assert.equal(s.window.YTGamepadCoordinator.mode, 'browse');
  assert.deepEqual(s.commands, []);
});

test('global exit closes UI and blocks actions above menus, native layers and navigation', () => {
  const s = setup(); s.act('up'); s.watch.state.panel = 'description';
  s.nativeDialog(); s.menu.opened = true; s.event('yt-navigate-start');
  s.event('yt-gamepad-exit');
  assert.equal(s.menu.opened, false);
  assert.equal(s.watch.state.mode, 'browse');
  assert.equal(s.window.YTGamepadCoordinator.mode, 'browse');
  assert.equal(s.act('confirm'), 'blocked');
  assert.equal(s.video.paused, false);
  assert.deepEqual(s.commands, []);
  s.event('yt-navigate-finish');
  assert.equal(s.watch.state.mode, 'browse');
  s.event('yt-gamepad-resume');
  assert.equal(s.watch.state.mode, 'playback');
  assert.equal(s.act('back'), 'handled');
  assert.ok(s.commands.includes('native:back'));
});
