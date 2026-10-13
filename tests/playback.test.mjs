import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function setup(pathname = '/watch', connected = true) {
  const events = {}, classes = new Map(), location = { pathname, search: '', origin: 'https://www.youtube.com', assign(path) { this.assigned = path; } };
  let backs = 0, jumps = [];
  const video = { duration: 100, currentTime: 95, volume: .98, paused: false, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  let adapter, captions = 0, menus = 0;
  const button = { getAttribute: () => null, click() { captions++; } };
  const window = { addEventListener(name, fn) { events[name] = fn; }, postMessage() {}, YTGamepadInput: { connected }, YTGamepad: { registerSite(config) { adapter = config; } }, YTGamepadMenu: { configure() {}, close() {}, handle() { menus++; } } };
  const document = { querySelectorAll: () => [], addEventListener(name, fn) { events[name] = fn; }, querySelector(selector) { return ['.ytp-subtitles-button', '.ytp-play-button', '.ytp-settings-button'].includes(selector) ? button : video; }, documentElement: { dataset: {}, classList: { contains: name => classes.get(name) === true, toggle(name, enabled) { classes.set(name, enabled); } } } };
  const history = { back() { backs++; }, go(delta) { jumps.push(delta); }, pushState(_state, _title, href) { const url = new URL(href, location.origin); location.pathname = url.pathname; location.search = url.search; }, replaceState(_state, _title, href) { if (href) { const url = new URL(href, location.origin); location.pathname = url.pathname; location.search = url.search; } } };
  const context = { URL, window, document, location, history, innerHeight: 800, getComputedStyle: node => ({ display: 'block', position: node?.position || 'static' }) };
  for (const file of ['src/app/route-state.ts', 'src/app/state-machine.ts', 'src/sites/youtube.ts', 'src/app/coordinator.ts']) runInNewContext(moduleSource(file), context);
  return { history, window, document, adapter, video, location, events, classes, jumps, get backs() { return backs; }, get captions() { return captions; }, get menus() { return menus; } };
}

test('theater layout follows controller connection and respects manual settings', () => {
  const s = setup('/', false);
  assert.equal(s.classes.get('ytg-theater'), false);
  s.window.YTGamepadInput.connected = true; s.events['yt-gamepad-connection']();
  assert.equal(s.classes.get('ytg-theater'), true);
  s.events['yt-gamepad-local-settings']({ detail: { theater: false } });
  assert.equal(s.classes.get('ytg-theater'), false);
  s.events['yt-gamepad-local-settings']({ detail: { theater: true, enabled: false } });
  assert.equal(s.classes.get('ytg-theater'), false);
  s.events['yt-gamepad-local-settings']({ detail: { enabled: true } });
  assert.equal(s.classes.get('ytg-theater'), true);
  s.window.YTGamepadInput.connected = false; s.events['yt-gamepad-connection']();
  assert.equal(s.classes.get('ytg-theater'), false);
});

test('playback left and right seek with boundary clamping and keep controls hidden', () => {
  for (const [action, time] of [['left', 85], ['right', 100]]) {
    const s = setup();
    assert.equal(s.adapter.interceptAction(action), true);
    assert.equal(s.video.currentTime, time);
    assert.equal(s.window.YTGamepadCoordinator.mode, 'playback');
  }
});
test('playback confirm pauses and up enters controls without opening the quick menu', () => {
  const s = setup(); s.adapter.interceptAction('confirm'); assert.equal(s.video.paused, true);
  assert.equal(s.adapter.interceptAction('up'), true); assert.equal(s.menus, 0);
  assert.equal(s.window.YTGamepadCoordinator.mode, 'controls');
  assert.equal(s.classes.get('ytg-playback'), true);
  assert.equal(s.classes.get('ytg-controls'), true);
});
test('SPA route switches mode; volume and captions work through menu actions', () => {
  const s = setup('/'); assert.equal(s.adapter.interceptAction('right'), false);
  s.location.pathname = '/watch'; s.events['yt-navigate-finish'](); assert.equal(s.window.YTGamepadCoordinator.mode, 'playback');
  s.window.YTGamepadSite.perform('volumeUp'); assert.equal(s.video.volume, 1);
  assert.equal(s.window.YTGamepadSite.perform('captions'), true); assert.equal(s.captions, 1);
});

test('watch navigation excludes the masthead and moves up to the preceding recommendation', () => {
  const s = setup();
  const navigationWindow = {};
  runInNewContext(moduleSource('src/navigation/navigation.ts'), { window: navigationWindow });
  const make = (left, top, header = false) => {
    const container = {};
    const el = { closest(selector) {
      if (selector === 'ytd-masthead') return header ? container : null;
      if (selector.includes('yt-lockup-view-model')) return header ? null : container;
      return null;
    } };
    return { el, section: header ? 'header' : 'content', rect: { left, top, width: 600, height: 220 } };
  };
  const header = make(500, 0, true), above = make(1160, 70), selected = make(1160, 300);
  const all = [header, above, selected];
  const allowed = s.adapter.filterCandidates(all.map(item => item.el));
  assert.equal(allowed.includes(header.el), false);
  const pool = all.filter(item => allowed.includes(item.el));
  assert.equal(navigationWindow.YTGamepadNavigation.choose(selected, pool, 'up', s.adapter.sections), above);
  assert.equal(navigationWindow.YTGamepadNavigation.choose(above, pool, 'up', s.adapter.sections), null);
  s.location.pathname = '/';
  assert.equal(s.adapter.filterCandidates(all.map(item => item.el)).includes(header.el), true);
});

test('confirming a video enters fullscreen layout and B returns to its source list', () => {
  const s = setup('/results');
  s.location.search = '?search_query=music';
  s.adapter.beforeActivate({ getAttribute: () => '/watch?v=123' });
  assert.equal(s.classes.get('ytg-playback'), false, 'native layout stays available until the destination player passes capability checks');
  s.history.pushState({}, '', '/watch?v=123');
  s.events['yt-navigate-finish']();
  assert.equal(s.classes.get('ytg-playback'), true);
  assert.equal(s.adapter.interceptAction('back'), true);
  assert.equal(s.video.paused, true);
  assert.equal(s.classes.get('ytg-playback'), false);
  assert.deepEqual(s.jumps, [-1]);
});

test('only controller activation prepares playback and canceled navigation restores browsing', () => {
  const s = setup('/');
  assert.equal(s.events.click, undefined);
  assert.equal(s.classes.get('ytg-playback'), false);
  s.adapter.beforeActivate({ getAttribute: () => '/watch?v=123' });
  assert.equal(s.classes.get('ytg-playback'), false);
  assert.equal(s.window.YTGamepadCoordinator.navigating, true);
  s.events['yt-navigate-finish']();
  assert.equal(s.classes.get('ytg-playback'), false);
});

test('B on a directly opened video returns to home', () => {
  const s = setup();
  s.adapter.interceptAction('back');
  assert.equal(s.location.assigned, '/');
  assert.equal(s.backs, 0);
});

test('safe viewport accounts for stacked fixed masthead and sticky category bar', () => {
  const s = setup('/');
  const bar = (top, height, position, parentElement = s.document.documentElement) => ({ position, parentElement, getBoundingClientRect: () => ({ top, bottom: top + height, width: 1000, height }) });
  const masthead = bar(0, 64, 'fixed');
  const wrapper = bar(64, 56, 'sticky');
  const chips = bar(64, 56, 'static', wrapper);
  const distant = bar(500, 50, 'sticky');
  s.document.querySelectorAll = () => [masthead, chips, wrapper, distant];
  const viewport = s.adapter.getViewport();
  assert.equal(viewport.top, 136);
  assert.equal(viewport.bottom, 784);
});

test('leaving after playing recommendations returns across the video chain to the source list', () => {
  const s = setup('/results');
  s.window.YTGamepadCoordinator.prepareVideo('/watch?v=first');
  s.history.pushState({}, '', '/watch?v=first'); s.events['yt-navigate-finish']();
  s.window.YTGamepadCoordinator.prepareVideo('/watch?v=second');
  s.history.pushState({}, '', '/watch?v=second'); s.events['yt-navigate-finish']();
  s.adapter.interceptAction('back');
  assert.deepEqual(s.jumps, [-2]); assert.equal(s.backs, 0);
});

test('control buttons navigate without seeking; the progress bar consumes left and right', () => {
  const s = setup();
  s.adapter.interceptAction('up');
  const button = { matches: () => false };
  assert.equal(s.adapter.interceptAction('right', { current: button }), false);
  assert.equal(s.video.currentTime, 95);
  const progress = { matches: selector => selector === '.ytp-progress-bar' };
  s.adapter.interceptAction('left', { current: progress });
  assert.equal(s.video.currentTime, 95);
  s.adapter.interceptAction('confirm', { current: progress });
  s.adapter.interceptAction('left', { current: progress });
  assert.equal(s.video.currentTime, 85);
  assert.equal(s.adapter.interceptAction('down', { current: progress }), true);
  assert.equal(s.adapter.interceptAction('confirm', { current: progress }), true);
  assert.equal(s.window.YTGamepadCoordinator.mode, 'controls');
  assert.equal(s.window.YTGamepadCoordinator.interactionState.watch.adjusting, false);
  assert.equal(s.video.paused, false, 'confirming a seek keeps the existing playback state');
});

test('B dismisses controls before leaving the video', () => {
  const s = setup();
  s.adapter.interceptAction('up');
  s.adapter.interceptAction('back');
  assert.equal(s.window.YTGamepadCoordinator.mode, 'playback');
  assert.equal(s.classes.get('ytg-controls'), false);
  assert.equal(s.video.paused, false);
  assert.equal(s.location.assigned, undefined);
  s.adapter.interceptAction('back');
  assert.equal(s.video.paused, true);
  assert.equal(s.location.assigned, '/');
});

test('native settings B returns from a submenu, then closes settings', () => {
  const s = setup();
  let parentClicks = 0, closeClicks = 0;
  const scope = { matches: () => true, querySelector: () => ({ click() { parentClicks++; } }) };
  s.adapter.onAction('back', { scope });
  assert.equal(parentClicks, 1);
  scope.querySelector = () => null;
  s.document.querySelector = () => ({ click() { closeClicks++; } });
  s.adapter.onAction('back', { scope });
  assert.equal(closeClicks, 1);
  assert.equal(s.backs, 0);
  assert.equal(s.location.assigned, undefined);
});

test('settings page identity uses visible labels and survives value changes', () => {
  const s = setup();
  const label = textContent => ({ textContent, getBoundingClientRect: () => ({ width: 100, height: 30 }) });
  const speed = label('Playback speed'), quality = label('Quality');
  let labels = [speed, quality], value = 'Auto';
  const menu = { matches: () => true, querySelectorAll: () => labels };
  const item = { closest: () => menu, querySelector: () => quality, getAttribute: () => value };
  const main = s.adapter.getOverlayView(menu);
  assert.equal(s.adapter.getKey(item), 'Quality');
  value = '1080p'; assert.equal(s.adapter.getOverlayView(menu), main);
  labels = [label('Auto'), label('1080p')];
  assert.notEqual(s.adapter.getOverlayView(menu), main);
  assert.equal(s.adapter.getOverlayView({ matches: () => false }), null);
});

test('B recognizes the current YouTube settings header back button', () => {
  const s = setup(); let clicked = false;
  const scope = { matches: () => true, querySelector(selector) {
    return selector.includes('.ytp-panel-back-button') ? { click() { clicked = true; } } : null;
  } };
  s.adapter.onAction('back', { scope });
  assert.equal(clicked, true);
  assert.equal(s.backs, 0);
});

test('progress navigation returns to the native control row', () => {
  const s = setup();
  s.adapter.interceptAction('up');
  const w = {};
  runInNewContext(moduleSource('src/navigation/navigation.ts'), { window: w });
  const play = { section: 'controls', rect: { left: 20, top: 730, width: 40, height: 40 } };
  const settings = { section: 'controls', rect: { left: 800, top: 730, width: 40, height: 40 } };
  const progress = { section: 'progress', rect: { left: 20, top: 700, width: 920, height: 15 } };
  const items = [play, settings, progress];
  assert.equal(w.YTGamepadNavigation.choose(play, items, 'up', s.adapter.sections), progress);
  assert.equal(w.YTGamepadNavigation.choose(progress, items, 'down', s.adapter.sections)?.section, 'controls');
  assert.equal(w.YTGamepadNavigation.choose(play, items, 'right', s.adapter.sections), settings);
});

function playFromList(s, href = '/watch?v=first') {
  assert.equal(s.window.YTGamepadCoordinator.prepareVideo(href), true);
  s.events['yt-navigate-start']();
  s.history.pushState({ youtube: true }, '', href);
  s.events['yt-navigate-finish']();
}
test('duplicate navigation notifications neither increase depth nor dismiss controls', () => {
  const s = setup('/results'); playFromList(s);
  s.adapter.interceptAction('up');
  s.events['yt-navigate-finish']();
  s.events['yt-navigate-start'](); s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepadCoordinator.mode, 'controls');
  s.adapter.interceptAction('back'); s.adapter.interceptAction('back');
  assert.deepEqual(s.jumps, [-1]);
});
test('canceled and same-video navigation do not add depth', () => {
  const s = setup('/results'); playFromList(s);
  assert.equal(s.window.YTGamepadCoordinator.prepareVideo('/watch?v=first'), false);
  s.window.YTGamepadCoordinator.prepareVideo('/watch?v=canceled');
  s.events['yt-navigate-cancel']();
  s.adapter.interceptAction('back');
  assert.deepEqual(s.jumps, [-1]);
});
test('unconfirmed pushes, replaced routes and traversal return safely to the source', () => {
  for (const change of ['missingPush', 'extraPush', 'replace', 'back', 'forward', 'cancelAfterPush']) {
    const s = setup('/results'); playFromList(s);
    s.window.YTGamepadCoordinator.prepareVideo('/watch?v=second');
    if (change === 'missingPush') s.location.search = '?v=second';
    else if (change === 'replace') s.history.replaceState({}, '', '/watch?v=second');
    else s.history.pushState({}, '', '/watch?v=second');
    if (change === 'extraPush') s.history.pushState({}, '', '/watch?v=unrelated');
    if (change === 'back' || change === 'forward') { s.location.search = change === 'back' ? '?v=first' : '?v=other'; s.events.popstate(); }
    if (change === 'cancelAfterPush') s.events['yt-navigate-cancel']();
    else s.events['yt-navigate-finish']();
    s.adapter.interceptAction('back');
    assert.deepEqual(s.jumps, [], change);
    assert.equal(s.location.assigned, '/results', change);
  }
});
test('page return remains locked through popstate until navigation finishes', () => {
  const s = setup('/results'); playFromList(s);
  s.adapter.interceptAction('back'); s.adapter.interceptAction('back');
  assert.deepEqual(s.jumps, [-1]);
  s.location.pathname = '/results'; s.location.search = ''; s.events.popstate();
  s.adapter.onAction('back', { scope: s.document });
  assert.equal(s.backs, 0);
  assert.equal(s.window.YTGamepadCoordinator.navigating, true);
  s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepadCoordinator.navigating, false);
  s.adapter.onAction('back', { scope: s.document });
  assert.equal(s.backs, 1);
});
test('disable during navigation cleans interaction state and preserves the return lock', () => {
  const s = setup('/results'); playFromList(s);
  s.adapter.interceptAction('back');
  s.events['yt-gamepad-local-settings']({ detail: { enabled: false } });
  s.events['yt-gamepad-local-settings']({ detail: { enabled: true } });
  s.adapter.interceptAction('back');
  assert.deepEqual(s.jumps, [-1]);
  s.location.pathname = '/results'; s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepadCoordinator.navigating, false);
});
