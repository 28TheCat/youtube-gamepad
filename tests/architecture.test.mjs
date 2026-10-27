import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual core -> injected policy -> site chain. UI ports are small
// doubles so this checks ownership independently of rendering and selectors.
function setup() {
  const commands = [], listeners = new Map(), frames = [], intervals = new Map();
  let intervalId = 0;
  let overlay = null, watchPort, menuPort;
  const node = () => ({ isConnected: true, style: {
    getPropertyValue(key) { return this[key] || ''; },
    setProperty(key, value) { this[key] = value; },
    removeProperty(key) { const previous = this[key] || ''; delete this[key]; return previous; }
  }, dataset: {}, attributes: {},
    classList: { toggle() {}, remove() {}, add() {}, contains: () => false },
    contains: () => false, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    getAttribute(name) { return this.attributes[name] ?? null; }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, focus() {}, scrollIntoView() {},
    remove() {}, append() {}, replaceChildren(...children) { this.children = children; }, attachShadow: () => ({ append() {} }) });
  const addEventListener = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  };
  const video = { readyState: 2, videoWidth: 640, videoHeight: 360, paused: false, ended: false, currentTime: 20, duration: 100,
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const document = { body: node(), documentElement: node(), createElement: node, addEventListener,
    contains: () => true,
    querySelector: selector => (selector.startsWith('video') || selector === '#movie_player video') ? video : selector === '#movie_player'
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
    YTGamepadInput: { configure() {}, connected: true, mode: 'gamepad' } };
  const location = { pathname: '/watch', search: '?v=current', origin: 'https://www.youtube.com', assign(path) { commands.push('navigate:' + path); } };
  const context = { window, document, location, URL, URLSearchParams, history: { back() {}, go() {} },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    MutationObserver: class { observe() {} disconnect() {} }, cancelAnimationFrame() {}, requestAnimationFrame(callback) { frames.push(callback); return frames.length; }, setTimeout, clearTimeout,
    setInterval(callback, delay) { const id = ++intervalId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); } };
  for (const file of ['src/app/route-state.ts', 'src/app/state-machine.ts', 'src/navigation/core.ts', 'src/sites/youtube.ts', 'src/app/coordinator.ts']) {
    runInNewContext(moduleSource(file), context);
  }
  return { window, watch, menu, commands, video, location, document,
    intervals, tick() { for (const { callback } of [...intervals.values()]) callback(); this.flush(); },
    flush() { while (frames.length) frames.shift()(); },
    get watchPort() { return watchPort; }, get menuPort() { return menuPort; },
    act: action => window.YTGamepad.act(action),
    nativeDialog() {
      overlay = { ...node(), matches: () => false, querySelectorAll: () => [],
        querySelector: () => ({ click() { overlay = null; commands.push('native:back'); } }) };
    },
    event(name, event = {}) { for (const callback of listeners.get(name) || []) callback(event); }
  };
}

test('one coordinator clock checks health, refreshes playback and evaluates idle once per frame', () => {
  const s = setup(); s.flush();
  let inspections = 0, playback = 0, idle = 0, pages = 0;
  const site = s.window.YTGamepadSite, inspect = site.inspectWatchCapabilities;
  site.inspectWatchCapabilities = (...args) => { inspections++; return inspect(...args); };
  s.watch.refreshPlayback = () => playback++;
  s.watch.refreshPage = () => pages++;
  s.watch.checkIdle = () => idle++;
  assert.equal(s.intervals.size, 1);
  assert.equal([...s.intervals.values()][0].delay, 500);
  s.tick();
  assert.deepEqual({ inspections, playback, idle, pages }, { inspections: 1, playback: 1, idle: 1, pages: 0 });
  // API/media notifications arriving with the clock share its single frame.
  for (const { callback } of s.intervals.values()) callback();
  s.watchPort.requestRefresh(false); s.watchPort.requestRefresh();
  s.flush();
  assert.deepEqual({ inspections, playback, idle, pages }, { inspections: 2, playback: 2, idle: 2, pages: 1 });
  s.document.hidden = true; s.event('visibilitychange'); s.flush();
  assert.equal(s.intervals.size, 0);
  s.tick(); assert.equal(idle, 2);
  s.document.hidden = false; s.event('visibilitychange'); s.flush();
  assert.equal(s.intervals.size, 1);
  s.tick(); assert.equal(idle, 3);
  s.event('yt-gamepad-local-settings', { detail: { enabled: false } });
  assert.equal(s.intervals.size, 0);
  s.window.YTGamepadCoordinator.destroy();
  assert.equal(s.intervals.size, 0);
});

test('API notifications and media events share one page refresh per frame', () => {
  const s = setup(); s.flush();
  let refreshes = 0, playbackRefreshes = 0, fullRefreshes = 0, inspections = 0;
  s.watch.refresh = () => fullRefreshes++;
  s.watch.refreshPage = () => refreshes++;
  s.watch.refreshPlayback = () => playbackRefreshes++;
  const site = s.window.YTGamepadSite, inspect = site.inspectWatchCapabilities;
  site.inspectWatchCapabilities = (...args) => { inspections++; return inspect(...args); };
  for (let i = 0; i < 10; i++) {
    for (const name of ['ytg-watch-info-updated-v1', 'ytg-watch-next-updated-v1', 'ytg-comments-updated-v1']) s.event(name);
    s.event('ended', { target: { tagName: 'VIDEO' } });
    s.event('playing', { target: { tagName: 'VIDEO' } });
    s.watchPort.requestRefresh();
    s.watchPort.requestRefresh(false);
  }
  assert.equal(refreshes, 0);
  s.flush();
  assert.equal(refreshes, 1);
  assert.equal(playbackRefreshes, 1);
  assert.equal(fullRefreshes, 0);
  assert.equal(inspections, 1);
  s.event('playing', { target: { tagName: 'VIDEO' } }); s.flush();
  assert.equal(inspections, 2);
  assert.equal(refreshes, 1, 'health-only events do not repaint unchanged page data');
  assert.equal(playbackRefreshes, 2);
  s.event('visibilitychange'); s.flush();
  assert.equal(inspections, 3);
  assert.equal(refreshes, 1);
  assert.equal(playbackRefreshes, 2, 'periodic and visibility health checks do not duplicate progress updates');
});

test('queued page refreshes cannot outlive their route, disabled state or coordinator', () => {
  for (const change of ['route', 'disabled', 'destroyed']) {
    const s = setup(); s.flush();
    let refreshes = 0, idle = 0; s.watch.refresh = () => refreshes++;
    s.watch.checkIdle = () => idle++;
    for (const { callback } of s.intervals.values()) callback();
    s.event('ytg-watch-info-updated-v1');
    if (change === 'route') s.location.search = '?v=another';
    else if (change === 'disabled') s.event('yt-gamepad-local-settings', { detail: { enabled: false } });
    else s.window.YTGamepadCoordinator.destroy();
    s.flush();
    assert.equal(refreshes, 0, change);
    assert.equal(idle, 0, change);
  }
});

test('becoming ready renders through sync without a duplicate page refresh', () => {
  const s = setup(); s.flush();
  const site = s.window.YTGamepadSite, inspect = site.inspectWatchCapabilities;
  site.inspectWatchCapabilities = () => ({ ready: false, missing: ['video'] });
  s.window.YTGamepadCoordinator.retryAdaptation();
  let refreshes = 0, syncs = 0;
  const sync = s.watch.sync;
  s.watch.refresh = () => refreshes++;
  s.watch.sync = (...args) => { syncs++; return sync.apply(s.watch, args); };
  site.inspectWatchCapabilities = inspect;
  s.event('ytg-watch-info-updated-v1'); s.event('canplay', { target: { tagName: 'VIDEO' } });
  s.flush();
  assert.equal(syncs, 1);
  assert.equal(refreshes, 0);
});

test('real coordinator routes shortcuts and prevents an open menu from leaking actions', () => {
  const s = setup();
  assert.equal(s.act('playPause'), 'handled'); assert.equal(s.video.paused, true);
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
    ['commentPost', { text: 'Draft' }], ['commentSort', 'NEWEST_FIRST'],
    ['fullscreen'], ['settings'], ['backSettings'], ['channel'], ['comments', true], ['replies', 'comment'], ['mode', 'controls']];
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

test('assembled modules retain injected collaborators when global dependency reads are forbidden', () => {
  const s = setup();
  for (const name of ['YTGamepadRuntime', 'YTGamepadInteraction', 'YTGamepadFocus',
    'YTGamepadNavigation', 'YTGamepadControllerStyle', 'YTGamepadDiagnostics',
    'YTGamepadMenu', 'YTGamepadSite', 'YTGamepadWatch', 'YTGamepadInput', 'YTGamepadRouteController']) {
    Object.defineProperty(s.window, name, { configurable: true, get() { throw new Error('Unexpected global read: ' + name); } });
  }
  assert.equal(s.act('search'), 'handled');
  assert.equal(s.act('confirm'), 'blocked');
  assert.equal(s.act('back'), 'handled');
  assert.equal(s.act('playPause'), 'handled');
  assert.equal(s.video.paused, true);
  assert.equal(s.watchPort.readRoute().isWatch, true);
  assert.equal(s.watchPort.request('seek', 45), true);
  assert.equal(s.video.currentTime, 45);
});


test('windowed playback hands directions to page focus before any seek shortcut', () => {
  const s = setup();
  s.event('yt-gamepad-local-settings', { detail: { playbackLayout: 'windowed' } });
  const original = s.video.currentTime;
  assert.equal(s.act('right'), 'handled');
  assert.equal(s.video.currentTime, original);
  assert.equal(s.watch.state.mode, 'controls');
  assert.ok(s.commands.includes('watch:right'));
});
