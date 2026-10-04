import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup({ missing = '', throwing = false } = {}) {
  let now = 0, tick, port, refresh, config;
  const classes = new Set(), events = new Map(), nodes = new Map();
  const listeners = (name, callback) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(callback);
  };
  function node() {
    const handlers = {}, names = new Set();
    return { isConnected: true, hidden: false, style: {}, dataset: {}, children: [], textContent: '',
      classList: { add: name => names.add(name), remove: name => names.delete(name), contains: name => names.has(name), toggle(name, on) { on ? names.add(name) : names.delete(name); } },
      append(...items) { this.children.push(...items); for (const item of items) if (item.id) nodes.set(item.id, item); },
      attachShadow() { this.shadow = node(); return this.shadow; },
      setAttribute() {}, addEventListener(name, callback) { handlers[name] = callback; },
      click() { handlers.click?.(); }, closest: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 100, height: 100 }), focus() {} };
  }
  const video = { isConnected: true, paused: false, duration: Infinity, currentTime: 0,
    pause() { this.paused = true; }, play() { return Promise.resolve(); } };
  const buttons = { '.ytp-play-button': { isConnected: true, click() {} }, '.ytp-settings-button': { isConnected: true, click() {} } };
  const player = { isConnected: true, contains: value => value === video,
    querySelector: selector => missing === selector ? null : buttons[selector] || null };
  const root = node(); root.classList = {
    add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
    toggle(name, on) { on ? classes.add(name) : classes.delete(name); }
  };
  const document = { documentElement: root, body: node(), createElement: node, addEventListener: listeners,
    querySelector(selector) {
      if (throwing) throw new Error('changed DOM');
      if (selector === '#movie_player') return missing === 'player' ? null : player;
      if (selector.startsWith('video')) return missing === 'video' ? null : video;
      if (selector.startsWith('.ytp-')) return missing === selector ? null : buttons[selector] || null;
      return nodes.get(selector.slice(1)) || null;
    }, querySelectorAll: () => [] };
  const watch = { state: { panel: '', row: 'controls' }, ownsFocus: false, failRender: false,
    connect(value) { port = value; },
    sync() {
      if (this.failRender) throw new Error('render failure');
      this.ownsFocus = port.state.mode === 'controls';
      classes[port.state.surfaceReady && port.state.mode !== 'browse' ? 'add' : 'delete']('ytg-watch-active');
      if (!port.state.surfaceReady) this.state.panel = '';
    }, refresh() { refresh?.(); }, handle: () => false, handleInput: () => 'pass' };
  const menu = { opened: false, connect() {}, close() { this.opened = false; } };
  const window = { YTGamepadWatch: watch, YTGamepadMenu: menu, YTGamepadInput: {}, postMessage() {}, addEventListener: listeners,
    YTGamepad: { registerSite(value) { config = value; }, configure() {}, refresh() {} } };
  const location = { pathname: '/watch', search: '?v=current', origin: 'https://www.youtube.com' };
  const context = { window, document, location, URL, URLSearchParams, history: {}, Date: { now: () => now },
    setInterval(fn) { tick = fn; }, setTimeout: () => 1, clearTimeout() {},
    getComputedStyle: () => ({ display: 'block' }) };
  for (const file of ['app/route-state.js', 'state-machine.js', 'sites/youtube.js', 'coordinator.js']) {
    runInNewContext(moduleSource(file), context);
  }
  return { window, document, classes, location, video, player, watch, menu, nodes, get config() { return config; }, get port() { return port; },
    setMissing(value) { missing = value; }, setThrowing(value) { throwing = value; }, setRefresh(value) { refresh = value; },
    advance(ms) { now += ms; tick(); }, event(name, value = {}) { for (const callback of events.get(name) || []) callback(value); },
    get status() { return window.YTGamepadCoordinator.adaptation.status; } };
}

test('missing player preserves native UI immediately and reports a timeout after five seconds', () => {
  const s = setup({ missing: 'player' });
  assert.equal(s.status, 'waiting'); assert.equal(s.port.state.mode, 'browse');
  assert.equal(s.classes.has('ytg-playback'), false); assert.equal(s.classes.has('ytg-watch-active'), false);
  assert.equal(s.document.documentElement.dataset.ytgNative, 'true');
  s.advance(4999); assert.equal(s.status, 'waiting');
  s.advance(1); assert.equal(s.status, 'fallback');
  const notice = s.nodes.get('ytg-fallback-notice');
  assert.equal(notice.hidden, false); assert.match(notice.shadow.children[1].textContent, /未找到播放器/);
});

test('normal async loading takes over only once all essential capabilities arrive', () => {
  const s = setup({ missing: 'video' }); s.advance(2000);
  assert.equal(s.status, 'waiting');
  s.setMissing(''); s.advance(500);
  assert.equal(s.status, 'ready'); assert.equal(s.classes.has('ytg-playback'), true);
  assert.equal(s.classes.has('ytg-watch-active'), true);
  assert.equal(s.document.documentElement.dataset.ytgNative, undefined);
  assert.equal(s.video.paused, false);
});

test('losing the video after takeover closes custom layers and restores all native layout', () => {
  const s = setup(); assert.equal(s.status, 'ready');
  s.window.YTGamepadCoordinator.setMode('controls'); s.watch.state.panel = 'comments'; s.menu.opened = true;
  for (const name of ['ytg-comments', 'ytg-settings-open', 'ytg-recommendations']) s.classes.add(name);
  s.setMissing('video'); s.advance(500);
  assert.equal(s.status, 'fallback'); assert.equal(s.menu.opened, false); assert.equal(s.watch.state.panel, '');
  for (const name of ['ytg-playback', 'ytg-controls', 'ytg-watch-active', 'ytg-comments', 'ytg-settings-open', 'ytg-recommendations']) assert.equal(s.classes.has(name), false, name);
  assert.equal(s.port.state.mode, 'browse'); assert.equal(s.config.shouldShowSelection({ scope: s.document }), true);
  assert.equal(s.window.YTGamepadCoordinator.request('mode', 'controls'), false);
  assert.equal(s.video.paused, false);
});

test('fallback remains stable until a manual retry or a new video route', () => {
  const s = setup({ missing: 'video' }); s.advance(5000);
  s.setMissing(''); s.advance(1000); assert.equal(s.status, 'fallback');
  s.nodes.get('ytg-fallback-notice').shadow.children[2].click();
  assert.equal(s.status, 'ready'); assert.equal(s.nodes.get('ytg-fallback-notice').hidden, true);
  s.setMissing('video'); s.advance(500); assert.equal(s.status, 'fallback');
  s.setMissing(''); s.location.search = '?v=next'; s.event('yt-navigate-finish');
  assert.equal(s.status, 'ready'); assert.equal(s.classes.has('ytg-watch-active'), true);
});

test('adapter exceptions and partial view renders preserve the CSS safety gate', () => {
  const s = setup({ throwing: true }); assert.equal(s.status, 'fallback');
  assert.equal(s.document.documentElement.dataset.ytgNative, 'true');
  s.setThrowing(false); s.watch.failRender = true; s.window.YTGamepadCoordinator.retryAdaptation();
  assert.equal(s.status, 'fallback'); assert.equal(s.classes.has('ytg-playback'), false);
  assert.equal(s.document.documentElement.dataset.ytgNative, 'true');
  assert.equal(s.document.documentElement.dataset.ytgMode, 'browse');
});

test('failure while reading a view snapshot triggers fallback without escaping the port', () => {
  const s = setup(); s.setThrowing(true);
  assert.doesNotThrow(() => s.port.readPlayback()); assert.equal(s.status, 'fallback');
  assert.equal(s.port.readPlayback().video, null);
});

test('optional metadata, subtitles, comments and finite duration are not required', () => {
  const s = setup(); assert.equal(s.status, 'ready');
  assert.equal(s.window.YTGamepadSite.inspectWatchCapabilities().ready, true);
  s.video.isConnected = false; s.advance(500); assert.equal(s.status, 'fallback');
});

test('a detached player or a preview video outside it cannot authorize takeover', () => {
  const s = setup();
  s.player.contains = () => false; s.advance(500);
  assert.equal(s.status, 'fallback');
  assert.match(s.window.YTGamepadCoordinator.adaptation.reason, /视频播放能力/);
  s.player.contains = value => value === s.video; s.player.isConnected = false;
  s.window.YTGamepadCoordinator.retryAdaptation();
  assert.equal(s.status, 'waiting'); s.advance(5000);
  assert.match(s.window.YTGamepadCoordinator.adaptation.reason, /播放器/);
});

test('disabling or leaving a failed watch route removes the notice and clears the failure latch', () => {
  const s = setup({ missing: 'video' }); s.advance(5000);
  s.event('yt-gamepad-local-settings', { detail: { enabled: false } });
  assert.equal(s.status, 'inactive'); assert.equal(s.nodes.get('ytg-fallback-notice').hidden, true);
  s.setMissing(''); s.event('yt-gamepad-local-settings', { detail: { enabled: true } });
  assert.equal(s.status, 'ready');
  s.setMissing('player'); s.advance(500); s.location.pathname = '/results'; s.event('yt-navigate-finish');
  assert.equal(s.status, 'inactive'); assert.equal(s.nodes.get('ytg-fallback-notice').hidden, true);
});

 test('native play and settings buttons are optional and recover independently', () => {
  const s = setup({ missing: '.ytp-settings-button' });
  assert.equal(s.status, 'ready');
  s.setMissing('.ytp-play-button'); s.advance(500);
  assert.equal(s.status, 'ready');
  assert.equal(s.window.YTGamepadCoordinator.request('media', 'playPause'), true);
  s.setMissing(''); s.advance(500); assert.equal(s.status, 'ready');
 });
 test('optional reads and commands fail independently without exiting controls', async () => {
  const s = setup(); const site = s.window.YTGamepadSite;
  s.window.YTGamepadCoordinator.setMode('controls');
  const original = s.document.querySelectorAll;
  s.document.querySelectorAll = selector => {
    if (selector.startsWith('ytd-comments') || selector.startsWith('ytd-compact-video-renderer')) throw new Error('changed optional DOM');
    return original(selector);
  };
  assert.equal(s.port.readComments().length, 0);
  assert.equal(s.port.readWatchPage().recommendations.length, 0);
  assert.equal(s.port.readWatchFeatures().comments, 'failed');
  assert.equal(s.port.readWatchFeatures().recommendations, 'failed');
  assert.equal(s.status, 'ready'); assert.equal(s.port.state.mode, 'controls');
  site.performWatchAction = () => { throw new Error('native action failed'); };
  assert.equal(s.port.request('watchAction', 'like'), false);
  assert.equal(s.status, 'ready');
  s.document.querySelectorAll = original;
  s.advance(500); assert.notEqual(s.port.readWatchFeatures().comments, 'failed');
 });
