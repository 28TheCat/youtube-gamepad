import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';

function setup(layout = 'windowed') {
  const events = {}, configs = [];
  let port, browserFullscreenCalls = 0, historyCalls = 0;
  const video = { currentTime: 31, duration: 300, paused: false, volume: .5,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  const location = { pathname: '/watch', search: '?v=expanded', origin: 'https://www.youtube.com', assign() { historyCalls++; } };
  const watch = { state: { panel: '', row: 'player', adjusting: false }, connect(value) { port = value; },
    sync() {}, handle() { return false; }, handleInput() { return 'pass'; }, refreshPage() {}, refreshPlayback() {}, checkIdle() {}, seekPreview() {} };
  const root = { dataset: {}, style: { getPropertyValue: () => '', removeProperty() {} },
    getAttribute: () => null, removeAttribute() {}, classList: { toggle() {}, contains: () => false },
    requestFullscreen() { browserFullscreenCalls++; return Promise.resolve(); } };
  const document = { hidden: false, hasFocus: () => true, documentElement: root,
    addEventListener(name, callback) { events[name] = callback; },
    querySelectorAll: () => [], querySelector(selector) {
      if (selector.startsWith('.ytp-')) return { getAttribute: () => null, click() {} };
      return video;
    } };
  const window = { addEventListener(name, callback) { events[name] = callback; }, postMessage() {},
    YTGamepadWatch: watch, YTGamepadInput: { mode: 'gamepad', connected: true, configure() {} },
    YTGamepadMenu: { opened: false, configure() {}, close() {} },
    YTGamepad: { hasTemporaryLayer: false, configure() {}, refresh() {}, registerSite(config) { configs.push(config); } } };
  runInNewContext(moduleSource('src/app/coordinator.ts'), { window, document, location, URL, URLSearchParams,
    history: { back() { historyCalls++; }, go() { historyCalls++; } },
    MutationObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({ display: 'block' }) });
  window.YTGamepadSite.hasNativeLayer = () => false;
  events['yt-gamepad-local-settings']({ detail: { playbackLayout: layout } });
  window.YTGamepadCoordinator.checkAdaptation();
  return { root, video, watch, port, events, location, adapter: configs[0], coordinator: window.YTGamepadCoordinator,
    get browserFullscreenCalls() { return browserFullscreenCalls; }, get historyCalls() { return historyCalls; } };
}

test('detail-page expansion returns locally without changing browser fullscreen or playback', () => {
  const s = setup();
  assert.equal(s.root.dataset.ytgPlaybackLayout, 'windowed');
  assert.equal(s.coordinator.request('fullscreen'), true);
  assert.equal(s.root.dataset.ytgPlaybackLayout, 'fullscreen');
  assert.equal(s.root.dataset.ytgWatchExpanded, 'true');
  assert.equal(s.port.state.mode, 'playback');
  assert.equal(s.browserFullscreenCalls, 0);
  s.adapter.interceptAction('back');
  assert.equal(s.root.dataset.ytgPlaybackLayout, 'windowed');
  assert.equal(s.root.dataset.ytgWatchExpanded, undefined);
  assert.equal(s.port.state.mode, 'controls');
  assert.equal(s.video.currentTime, 31); assert.equal(s.video.paused, false);
  assert.equal(s.historyCalls, 0);
});

test('expanded controls return locally while a panel or timeline adjustment retains Back', () => {
  const s = setup(); s.coordinator.request('fullscreen'); s.coordinator.setMode('controls');
  s.watch.state.panel = 'description';
  s.adapter.handleRegion('back');
  assert.equal(s.root.dataset.ytgWatchExpanded, 'true');
  s.watch.state.panel = ''; s.watch.state.adjusting = true;
  s.adapter.handleRegion('back');
  assert.equal(s.root.dataset.ytgWatchExpanded, 'true');
  s.watch.state.adjusting = false;
  assert.equal(s.adapter.handleRegion('back'), 'handled');
  assert.equal(s.root.dataset.ytgPlaybackLayout, 'windowed');
});

test('default fullscreen uses its existing entry and expansion ends on another route', async () => {
  const direct = setup('fullscreen');
  assert.equal(await direct.coordinator.request('fullscreen'), true);
  assert.equal(direct.browserFullscreenCalls, 1);
  assert.equal(direct.root.dataset.ytgWatchExpanded, undefined);
  const s = setup(); s.coordinator.request('fullscreen');
  s.location.search = '?v=other'; s.coordinator.setMode('playback');
  assert.equal(s.root.dataset.ytgWatchExpanded, undefined);
  assert.equal(s.root.dataset.ytgPlaybackLayout, 'windowed');
});
