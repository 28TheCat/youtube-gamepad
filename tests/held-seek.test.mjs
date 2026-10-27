import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';

function setup() {
  const events = {}, held = new Set(), previews = [], feedback = [], writes = [];
  let time = 100, nativeLayer = false;
  const video = { duration: 3600, volume: .5, muted: false, paused: false,
    get currentTime() { return time; }, set currentTime(value) { time = value; writes.push(value); },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const location = { pathname: '/watch', search: '?v=held', origin: 'https://www.youtube.com', assign() {} };
  const button = { getAttribute: () => null, click() {} };
  const watch = { state: { panel: '' }, sync() {}, connect() {},
    seekPreview: value => previews.push(value && { ...value }),
    mediaFeedback: (action, delta) => feedback.push({ action, delta }) };
  const input = { connected: true, configure() {}, isHeld: action => held.has(action), cancelSeeking() { held.clear(); } };
  const menu = { opened: false, configure() {}, close() { this.opened = false; } };
  const core = { hasTemporaryLayer: false, registerSite() {}, configure() {}, refresh() {} };
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage() {},
    YTGamepadInput: input, YTGamepadWatch: watch, YTGamepadMenu: menu, YTGamepad: core };
  const document = { hidden: false, hasFocus: () => true, addEventListener(name, fn) { events[name] = fn; },
    querySelectorAll: () => [], querySelector(selector) {
      return ['.ytp-subtitles-button', '.ytp-play-button', '.ytp-settings-button'].includes(selector) ? button : video;
    }, documentElement: { dataset: {}, classList: { toggle() {}, contains: () => false } } };
  const context = { window, document, location, URL,
    history: { back() {}, go() {} }, getComputedStyle: () => ({ display: 'block' }) };
  runInNewContext(moduleSource('src/app/coordinator.ts'), context);
  window.YTGamepadSite.hasNativeLayer = () => nativeLayer;
  const coordinator = window.YTGamepadCoordinator;
  return { video, document, window, location, held, previews, writes, feedback, events, menu, input, coordinator,
    nativeLayer(value) { nativeLayer = value; },
    press(action = 'seekForward') { held.add(action); return coordinator.request('media', action); },
    repeat(action = 'seekForward') { return coordinator.request('media', action); },
    release(action = 'seekForward', cancelled = false) {
      held.delete(action); events['yt-gamepad-button-end']({ detail: { action, cancelled } });
    } };
}

test('short press previews ten seconds and release commits exactly one seek without pausing', () => {
  const s = setup(); assert.equal(s.press(), true);
  assert.deepEqual(s.previews.at(-1), { target: 110, delta: 10, start: 0, end: 3600 });
  assert.deepEqual(s.writes, []); assert.equal(s.video.currentTime, 100);
  s.release(); s.release();
  assert.deepEqual(s.writes, [110]); assert.equal(s.video.paused, false);
  assert.deepEqual(s.feedback, [{ action: 'seekForward', delta: 10 }]);
  assert.equal(s.previews.at(-1), null);
});

test('held seeking accelerates previews and writes only the final target', () => {
  const s = setup(); s.video.paused = true; s.press();
  for (let i = 0; i < 6; i++) s.repeat();
  assert.deepEqual(s.previews.filter(Boolean).map(item => item.delta), [10, 20, 30, 40, 55, 70, 100]);
  assert.deepEqual(s.writes, []); s.release();
  assert.deepEqual(s.writes, [200]); assert.equal(s.video.paused, true);
  s.press(); assert.equal(s.previews.at(-1).delta, 10); s.release();
  assert.deepEqual(s.writes, [200, 210]);
});

test('rewind clamps to the beginning and reversal resets acceleration', () => {
  const s = setup(); s.press('seekBack');
  for (let i = 0; i < 20; i++) s.repeat('seekBack');
  assert.equal(s.previews.at(-1).target, 0); assert.deepEqual(s.writes, []);
  s.press('seekForward'); assert.equal(s.previews.at(-1).target, 10);
  s.release('seekBack'); assert.deepEqual(s.writes, []);
  s.release(); assert.deepEqual(s.writes, [10]);
});

test('release revalidates moving DVR ranges and never seeks into a gap', () => {
  const s = setup(); s.video.duration = Infinity;
  let ranges = [[80, 105], [120, 160]];
  s.video.seekable = { get length() { return ranges.length; }, start: i => ranges[i][0], end: i => ranges[i][1] };
  s.press(); assert.equal(s.previews.at(-1).target, 105);
  ranges = [[130, 180]]; s.release(); assert.deepEqual(s.writes, [130]);
  s.press('seekBack'); ranges = []; s.release('seekBack');
  assert.deepEqual(s.writes, [130]);
});

test('unknown duration and live streams without DVR cannot start a preview', () => {
  for (const duration of [NaN, Infinity]) {
    const s = setup(); s.video.duration = duration;
    assert.equal(s.press(), false); s.release();
    assert.deepEqual(s.writes, []); assert.deepEqual(s.previews, []);
  }
});

test('return, menu, blur, hidden page, disable, navigation and native layers cancel uncommitted seeks', () => {
  for (const interrupt of [
    s => s.events['yt-gamepad-action']({ detail: { action: 'back' } }),
    s => { s.menu.opened = true; s.coordinator.checkAdaptation(); },
    s => s.events.blur(),
    s => { s.document.hidden = true; s.events.visibilitychange(); },
    s => s.events['yt-gamepad-local-settings']({ detail: { enabled: false } }),
    s => { s.location.search = '?v=other'; s.coordinator.checkAdaptation(); },
    s => { s.nativeLayer(true); s.coordinator.checkAdaptation(); },
    s => s.release('seekForward', true),
    s => s.coordinator.destroy()
  ]) {
    const s = setup(); s.press(); s.repeat(); interrupt(s); s.release();
    assert.deepEqual(s.writes, []); assert.equal(s.previews.at(-1), null);
  }
});

test('volume applies immediately, clamps its limits, and cancels pending seek', () => {
  const s = setup(); s.press();
  for (let i = 0; i < 20; i++) s.coordinator.request('media', 'volumeUp');
  assert.equal(s.video.volume, 1); s.release(); assert.deepEqual(s.writes, []);
  for (let i = 0; i < 30; i++) s.coordinator.request('media', 'volumeDown');
  assert.equal(s.video.volume, 0);
});

test('mouse or keyboard media requests retain immediate seeking', () => {
  const s = setup(); s.coordinator.request('media', 'seekForward');
  assert.deepEqual(s.writes, [110]); assert.deepEqual(s.previews, []);
});

test('saved playback steps apply to held previews, immediate seeks and volume without reload', () => {
  const s = setup();
  const configure = values => s.events['yt-gamepad-local-settings']({ detail: values });
  configure({ seekStep: 20, volumeStep: 12 });
  s.press(); assert.equal(s.previews.at(-1).delta, 20);
  s.release(); assert.deepEqual(s.writes, [120]);
  s.coordinator.request('media', 'seekBack'); assert.equal(s.video.currentTime, 100);
  s.video.volume = .5; s.coordinator.request('media', 'volumeUp'); assert.equal(s.video.volume, .62);
  s.press(); configure({ seekStep: 90 }); s.release();
  assert.equal(s.video.currentTime, 100, 'changing the step cancels an uncommitted preview');
  s.press(); s.repeat(); assert.equal(s.previews.at(-1).delta, 180, 'large configured steps do not decelerate when held');
  s.release(); assert.equal(s.video.currentTime, 280);
  configure({ seekStep: 10, volumeStep: 5 });
  s.coordinator.request('media', 'seekBack'); assert.equal(s.video.currentTime, 270);
});
