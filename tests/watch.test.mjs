import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('VOD timeline covers the full duration despite partial or disjoint seekable ranges', () => {
  const s = setup();
  for (const ranges of [[[20, 35]], [[0, 35], [70, 80]]]) {
    s.video.seekable = { length: ranges.length, start: i => ranges[i][0], end: i => ranges[i][1] };
    const timeline = s.site.readPlayback().video.timeline;
    assert.equal(timeline.start, 0);
    assert.equal(timeline.end, 100);
    assert.equal(s.site.seekTo(50), true);
    assert.equal(s.video.currentTime, 50);
    assert.equal(s.site.seekTo(200), true);
    assert.equal(s.video.currentTime, 100);
    assert.equal(s.site.seekTo(-10), true);
    assert.equal(s.video.currentTime, 0);
  }
});

test('live DVR uses moving seekable ranges and returns to the latest live edge', async () => {
  const s = setup(true);
  let ranges = [[100, 160], [180, 220]];
  s.video.duration = Infinity; s.video.currentTime = 200;
  s.video.seekable = { get length() { return ranges.length; }, start: i => ranges[i][0], end: i => ranges[i][1] };
  s.watch.show();
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  const progress = find(s.shadow, node => node.getAttribute('role') === 'slider');
  const live = find(s.shadow, node => node.dataset.action === 'goLive');
  assert.equal(progress.getAttribute('aria-valuemin'), '100');
  assert.equal(progress.getAttribute('aria-valuemax'), '220');
  assert.equal(live.hidden, false);
  progress.dispatchEvent({ type: 'click', detail: 1, clientX: 500 });
  assert.equal(s.video.currentTime, 160);
  assert.equal(s.site.seekTo(175), true); assert.equal(s.video.currentTime, 180);
  ranges = [[190, 250]];
  s.site.perform('seekBack'); assert.equal(s.video.currentTime, 190);
  live.click(); assert.equal(s.video.currentTime, 250);
  await Promise.resolve();
  assert.equal(live.disabled, true);
  assert.equal(s.video.paused, false);
  s.watch.show(); s.watch.handle('up'); s.watch.handle('confirm');
  ranges = []; s.tick();
  assert.equal(progress.disabled, true);
  assert.equal(s.watch.state.adjusting, false);
  assert.equal(s.watch.state.row, 'controls');
  s.watch.handle('up'); assert.equal(s.watch.state.row, 'controls');
  assert.equal(s.site.perform('seekBack'), false);
  assert.equal(s.site.perform('goLive'), false);
});

test('finite live metadata and unknown durations do not invent a DVR window', () => {
  const s = setup();
  const query = s.document.querySelector;
  s.document.querySelector = selector => selector === '#movie_player'
    ? { getPlayerResponse: () => ({ videoDetails: { isLive: true } }) } : query(selector);
  assert.equal(s.site.readPlayback().video.timeline.isLive, true);
  assert.equal(s.site.seekTo(20), false);
  s.video.seekable = { length: 1, start: () => 30, end: () => 90 };
  assert.equal(s.site.seekTo(20), true); assert.equal(s.video.currentTime, 30);
  s.document.querySelector = query;
  s.video.duration = NaN; s.video.seekable = { length: 0 };
  assert.equal(s.site.seekTo(20), false);
  assert.equal(s.site.readPlayback().video.timeline.isLive, false);
});

function setup(integrated = false) {
  let shadow, frame, clicks = 0, now = 0, clockRegistrations = 0;
  const frames = [];
  const requestFrame = callback => { frames.push(callback); return frames.length; };
  const setClock = callback => { clockRegistrations++; frame = callback; return 1; };
  const clearClock = () => { frame = undefined; };
  const classes = new Set(), actions = [];
  function node(tag) {
    const listeners = {}, attributes = {}, names = new Set();
    return {
      tagName: tag, children: [], dataset: {}, style: {}, textContent: '', isConnected: true,
      classList: { add: name => names.add(name), remove: name => names.delete(name), toggle(name, on) { on ? names.add(name) : names.delete(name); }, contains: name => names.has(name) },
      append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { attributes[name] = value; }, getAttribute: name => attributes[name] ?? null,
      addEventListener(name, fn) { listeners[name] = fn; },
      dispatchEvent(event) { listeners[event.type]?.(event); },
      click() { listeners.click?.({ detail: 0 }); },
      focus() { if (shadow) shadow.activeElement = this; }, scrollIntoView() {}, scrollBy() {},
      contains: () => false, attachShadow() { shadow = node('shadow'); return shadow; },
      getBoundingClientRect: () => ({ left: 0, width: 1000 }),
      set innerHTML(value) { throw new TypeError('TrustedHTML required'); }
    };
  }
  const video = { currentTime: 10, duration: 100, paused: false, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
  const native = node('button'); native.click = () => clicks++;
  let nextItems = [{ key: 'next', href: '/watch?v=next', label: '下一首歌', channel: '推荐频道',
    thumbnail: 'https://i.ytimg.com/vi/next/hqdefault.jpg', thumbnailFallback: 'https://i.ytimg.com/vi/next/hqdefault.jpg' }];
  const location = { pathname: '/watch', search: '?v=current', origin: 'https://www.youtube.com' };
  const events = {}, configs = [];
  const listen = (name, callback) => {
    const previous = events[name];
    events[name] = event => { previous?.(event); callback(event); };
  };
  const document = {
    addEventListener: listen,
    createElement: node, createElementNS: (_ns, tag) => node(tag), body: node('body'),
    documentElement: { dataset: {}, getAttribute: () => null, removeAttribute() {}, append() {}, classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, value) { value ? classes.add(name) : classes.delete(name); } } },
    querySelector(selector) {
      if (selector === '#movie_player') return { getPlayerResponse: () => ({ videoDetails: { videoId: 'current', channelId: 'UCcreator', title: '当前视频', author: '测试频道', shortDescription: '视频说明', viewCount: '123' } }) };
      if (selector.startsWith('video')) return video;
      if (selector === '.ytp-settings-menu') return null;
      if (selector.startsWith('.ytp-')) return native;
      return null;
    }, querySelectorAll: () => []
  };
  const window = { YTGamepadMenu: { opened: false, close() { this.opened = false; } }, addEventListener: listen, postMessage() {}, YTGamepadInput: { connected: true, configure() {} }, YTGamepad: { refresh() {}, configure() {}, registerSite(config) { configs.push(config); } } };
  window.__testWatchNext = () => ({ route: '/watch?v=current', recommendations: nextItems, queue: [], loading: false, failed: false });
  window.__testOpenWatchVideo = () => { actions.push('navigate'); return true; };
  const controller = {
    state: { mode: 'playback', enabled: true, navigating: false },
    requestMode(mode) { this.state.mode = mode; window.YTGamepadWatch.sync(); },
    request(type, value) {
      if (!this.state.enabled || this.state.navigating) return false;
      const methods = { mode: 'requestMode', media: 'perform', seek: 'seekTo', settings: 'openSettings',
        backSettings: 'backSettings', channel: 'openChannel', recommendation: 'openRecommendation',
        replies: 'expandReplies', comments: 'loadComments' };
      return this[methods[type]]?.(value);
    },
    observePlayback(playback) { document.documentElement.classList.toggle('ytg-settings-open', this.state.enabled && playback.settingsOpen); },
    prepareVideo(href) { actions.push(href); },
    perform(action) { actions.push(action); if (action === 'playPause') video.paused = !video.paused; if (action === 'seekForward') video.currentTime += 10; return true; }
  };
  runInNewContext(['src/app/route-state.ts', 'src/app/state-machine.ts', 'src/navigation/focus.ts', 'src/ui/styles.ts', 'src/ui/watch-view.ts', 'src/ui/watch-panels.ts', 'src/playback/watch.ts'].map(file => moduleSource(file)).join('\n'), {
    window, document, location, URL, URLSearchParams, Date: { now: () => now }, getComputedStyle: () => ({ display: 'block' }), requestAnimationFrame: requestFrame, setTimeout: () => 1, clearTimeout() {}, setInterval: setClock, clearInterval: clearClock,
    MutationObserver: class { observe() {} }
  });
  const watch = window.YTGamepadWatch;
  const context = { window, document, location, URL, URLSearchParams, Date: { now: () => now }, history: { back() {} }, requestAnimationFrame: requestFrame, setInterval: setClock, clearInterval: clearClock, getComputedStyle: () => ({ display: 'block' }) };
  runInNewContext(moduleSource('src/sites/youtube.ts'), context);
  const site = window.YTGamepadSite;
  Object.assign(controller, {
    readRoute: site.readRoute, readWatchPage: site.readWatchPage, readPlayback: site.readPlayback,
    readComments: site.readComments, expandReplies: site.expandReplies, loadComments: site.loadComments,
    seekTo: site.seekTo, hasNativeLayer: site.hasNativeLayer,
    openSettings: site.openSettings, backSettings: () => site.settingsOpen() && site.backSettings(),
    openChannel: () => site.openChannel(() => controller.requestMode('browse')),
    openRecommendation: key => site.openRecommendation(key, controller.prepareVideo),
    requestAutoHide(idle) { if (watch.state.row === 'controls' && !video.paused && !video.ended && idle > 5000) controller.requestMode('playback'); }
  });
  if (integrated) {
    runInNewContext(moduleSource('src/app/coordinator.ts'), context);
  } else {
    watch.connect(controller);
    const render = watch.sync;
    // The isolated view's controller owns state, just like the real coordinator.
    watch.sync = (mode, preferences) => {
      if (mode) controller.state.mode = mode;
      if (preferences) controller.state.enabled = preferences.enabled !== false;
      render();
    };
    watch.sync('playback', { enabled: true });
  }
  return { watch, window, video, classes, actions, events, adapter: configs[0], nextItems, site, document, location, get clockRegistrations() { return clockRegistrations; }, get shadow() { return shadow; }, get clicks() { return clicks; }, flushFrames() { while (frames.length) frames.shift()(); }, tick() { if (integrated) frame?.(); else { watch.refreshPlayback(); watch.checkIdle(); } this.flushFrames(); }, advance(ms) { now += ms; }, controller, clearCards() { nextItems = []; watch.refresh(); } };
}

test('watch creates no periodic timer and the coordinator supplies exactly one clock', () => {
  assert.equal(setup().clockRegistrations, 0);
  assert.equal(setup(true).clockRegistrations, 1);
});

test('watch controls observe asynchronous media failure and refresh playback after success', async () => {
  const s = setup(); s.video.paused = true;
  s.watch.show('controls');
  let settle;
  s.controller.perform = () => new Promise(resolve => { settle = resolve; });
  const find = node => node.dataset.action === 'playPause' ? node : node.children.map(find).find(Boolean);
  const button = find(s.shadow);
  const texts = node => [node.textContent, ...node.children.flatMap(texts)].join('');
  button.click();
  assert.doesNotMatch(texts(s.shadow), /This action is (?:currently )?unavailable/);
  settle(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(texts(s.shadow), /This action is (?:currently )?unavailable/);
  assert.equal(button.getAttribute('aria-label'), 'Play');
  button.click(); s.video.paused = false; settle(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.getAttribute('aria-label'), 'Pause');
});

test('recommendation snapshots do not inspect native cards or unloaded images', () => {
  const s = setup();
  s.document.querySelectorAll = () => { throw new Error('native card scan'); };
  assert.equal(s.site.readWatchPage().recommendations[0].thumbnail, 'https://i.ytimg.com/vi/next/hqdefault.jpg');
  assert.equal(s.site.loadRecommendations(), false);
});

test('failed card images retry once and preserve their thumbnail container', () => {
  const s = setup();
  s.nextItems[0].thumbnail = 'https://i.ytimg.com/vi/next/expired.jpg';
  s.watch.refresh();
  const find = (node, tag) => node.tagName === tag ? node : node.children?.map(child => find(child, tag)).find(Boolean);
  const findCard = n => n.dataset.videoId ? n : n.children?.map(findCard).find(Boolean);
  const image = find(findCard(s.shadow), 'img');
  assert.equal(image.src, 'https://i.ytimg.com/vi/next/expired.jpg');
  image.dispatchEvent({ type: 'error' });
  assert.equal(image.src, 'https://i.ytimg.com/vi/next/hqdefault.jpg');
  image.dispatchEvent({ type: 'error' });
  assert.equal(image.style.visibility, 'hidden');
  assert.ok(find(s.shadow, 'button').children.length);
});

test('watch shell uses safe DOM construction and restores the normal page when disabled', () => {
  const s = setup();
  assert.equal(s.classes.has('ytg-watch-active'), true);
  s.watch.sync('playback', { enabled: false });
  assert.equal(s.classes.has('ytg-watch-active'), false);
  assert.equal(s.watch.handle('up'), false);
  s.location.pathname = '/results'; s.watch.sync('browse', { enabled: true });
  assert.equal(s.classes.has('ytg-watch-active'), false);
});

test('showing controls reads page data once through the mode synchronization', () => {
  const s = setup();
  let reads = 0;
  const readPage = s.controller.readWatchPage;
  s.controller.readWatchPage = () => { reads++; return readPage(); };
  s.watch.show();
  assert.equal(reads, 1);
  assert.equal(s.watch.state.mode, 'controls');
});

test('directional focus and page refresh do not read playback; media refresh does not read page data', () => {
  const s = setup(); s.watch.show();
  let pages = 0, playback = 0;
  const readPage = s.controller.readWatchPage, readPlayback = s.controller.readPlayback;
  s.controller.readWatchPage = () => { pages++; return readPage(); };
  s.controller.readPlayback = () => { playback++; return readPlayback(); };
  s.watch.handle('right'); s.watch.handle('left');
  assert.equal(pages, 0); assert.equal(playback, 0);
  s.watch.refreshPage();
  assert.equal(pages, 1); assert.equal(playback, 0);
  s.watch.refreshPlayback();
  assert.equal(pages, 1); assert.equal(playback, 1);
});

test('progress requires A to adjust and A ends adjustment without hiding controls', () => {
  const s = setup(); s.watch.show();
  s.watch.handle('right'); assert.equal(s.watch.state.index, 5); assert.equal(s.video.currentTime, 10);
  s.watch.handle('up'); assert.equal(s.watch.state.row, 'progress');
  s.watch.handle('right'); assert.equal(s.video.currentTime, 10);
  s.watch.handle('confirm'); assert.equal(s.watch.state.adjusting, true);
  s.watch.handle('right'); assert.equal(s.video.currentTime, 20);
  s.watch.handle('down'); assert.equal(s.watch.state.row, 'progress');
  s.watch.handle('confirm'); assert.equal(s.watch.state.adjusting, false);
  assert.equal(s.watch.state.mode, 'controls');
  s.watch.handle('down'); assert.equal(s.watch.state.row, 'controls'); assert.equal(s.watch.state.index, 5);
  s.watch.handle('left');
  s.watch.handle('confirm'); assert.equal(s.video.paused, true);
});

test('up from progress hides the watch surface and preserves playback and control selection', () => {
  const s = setup(true);
  const input = action => s.adapter.interceptAction(action);
  input('up'); input('right'); input('up');
  assert.equal(s.watch.state.row, 'progress');
  assert.equal(s.watch.state.adjusting, false);
  input('up');
  assert.equal(s.watch.state.mode, 'playback');
  assert.equal(s.watch.ownsFocus, false);
  assert.equal(s.classes.has('ytg-controls'), false);
  assert.equal(s.video.paused, false);
  assert.equal(s.video.currentTime, 10);
  input('up');
  assert.equal(s.watch.state.row, 'controls');
  assert.equal(s.watch.state.index, 5);
  input('up'); input('confirm'); input('up');
  assert.equal(s.watch.state.adjusting, true);
  assert.equal(s.watch.state.mode, 'controls');
  input('confirm'); input('up');
  assert.equal(s.watch.state.mode, 'playback');
});

test('recommendation B returns to controls before returning to pure playback', () => {
  const s = setup(); s.watch.show('recommendations');
  assert.equal(s.watch.state.recommendations, 1);
  assert.equal(s.watch.state.row, 'recommendations');
  s.watch.handle('back'); assert.equal(s.watch.state.row, 'controls'); assert.equal(s.watch.state.mode, 'controls');
  s.watch.handle('back'); assert.equal(s.watch.state.mode, 'playback');
});

test('description closes back to its original button and missing recommendations recover focus', () => {
  const s = setup(); s.watch.show();
  for (let i = 0; i < 3; i++) s.watch.handle('left');
  s.watch.handle('confirm'); assert.equal(s.watch.state.panel, 'description');
  s.watch.handle('back'); assert.equal(s.watch.state.panel, ''); assert.equal(s.watch.state.index, 1);
  s.watch.show('recommendations'); s.clearCards();
  assert.equal(s.watch.state.row, 'controls'); assert.equal(s.watch.state.index, 4);
});

test('recommendations activate API destinations and native settings remain delegated', () => {
  const s = setup(); s.watch.show('recommendations'); s.watch.handle('confirm');
  assert.deepEqual(s.actions, ['/watch?v=next', 'navigate']);
  s.watch.show(); for (let i = 0; i < 7; i++) s.watch.handle('right');
  s.watch.handle('confirm'); assert.equal(s.clicks, 1);
});

test('comments panel closes to the comments button and cleans up when disabled', () => {
  const s = setup(); s.watch.show();
  for (let i = 0; i < 4; i++) s.watch.handle('right');
  s.watch.handle('confirm');
  assert.equal(s.watch.state.panel, 'comments');
  assert.equal(s.classes.has('ytg-comments'), true);
  s.watch.handle('back');
  assert.equal(s.watch.state.panel, '');
  assert.equal(s.watch.state.index, 8);
  assert.equal(s.classes.has('ytg-comments'), false);
  s.watch.handle('confirm');
  s.watch.sync('controls', { enabled: false });
  assert.equal(s.classes.has('ytg-comments'), false);
});

test('returning from recommendations and progress preserves the chosen control', () => {
  const s = setup(); s.watch.show(); s.watch.handle('right'); s.watch.handle('right');
  s.watch.handle('down'); s.watch.handle('up');
  assert.equal(s.watch.state.index, 6);
  s.watch.handle('up'); s.watch.handle('back');
  assert.equal(s.watch.state.index, 6);
});

test('recommendations reject destinations removed from the current API snapshot', () => {
  const s = setup(); s.watch.show('recommendations'); s.clearCards();
  assert.equal(s.watch.state.recommendations, 0);
  assert.equal(s.site.openRecommendation('next', () => { throw new Error('must not navigate'); }), 'missing');
  assert.deepEqual(s.actions, []);
});

test('loaded comments remain text and request replies through the page port', () => {
  const s = setup(); let clicks = 0, expanded = [];
  s.window.__testComments = () => ({ route: '/watch?v=current', loading: false, failed: false, hasMore: false,
    items: [{ key: 'comment', author: '测试用户', text: '<img src=x> 测试评论', hasReplies: true,
      repliesLabel: '2 条回复', expanded }] });
  s.window.__testCommentReplies = key => { assert.equal(key, 'comment'); clicks++; expanded = ['回复内容']; return true; };
  s.watch.show(); for (let i = 0; i < 4; i++) s.watch.handle('right');
  s.watch.handle('confirm'); s.watch.handle('down'); s.watch.handle('down'); s.watch.handle('confirm');
  assert.equal(clicks, 1);
  const texts = node => [node.textContent, ...node.children.flatMap(texts)];
  assert.equal(texts(s.shadow).includes('<img src=x> 测试评论'), true);
  assert.equal(texts(s.shadow).includes('↳ 回复内容'), true);
  s.watch.handle('up'); s.watch.handle('confirm');
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  let header = find(s.shadow, node => node.className === 'comment-header');
  let body = find(s.shadow, node => node.className === 'comment-body');
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  assert.equal(body.hidden, true);
  assert.equal(clicks, 1);
  s.tick();
  assert.equal(find(s.shadow, node => node.className === 'comment-body').hidden, true);
  s.watch.handle('confirm');
  header = find(s.shadow, node => node.className === 'comment-header');
  body = find(s.shadow, node => node.className === 'comment-body');
  assert.equal(header.getAttribute('aria-expanded'), 'true');
  assert.equal(body.hidden, false);
  assert.equal(texts(body).includes('↳ 回复内容'), true);
  assert.equal(clicks, 1);
  s.watch.handle('back'); assert.equal(s.watch.state.index, 8);
});

test('coordinator connects the real watch and site through playback, controls and channel navigation', () => {
  const s = setup(true), coordinator = s.window.YTGamepadCoordinator;
  assert.equal(s.watch.state.mode, coordinator.mode);
  assert.equal(s.adapter.shouldShowSelection({ scope: s.document }), false);
  s.adapter.interceptAction('up');
  assert.equal(coordinator.mode, 'controls'); assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.classes.has('ytg-controls'), true);
  s.adapter.interceptAction('confirm'); assert.equal(s.video.paused, true);
  s.adapter.interceptAction('back');
  assert.equal(coordinator.mode, 'playback'); assert.equal(s.watch.state.mode, 'playback');
  s.adapter.interceptAction('down'); assert.equal(s.watch.state.row, 'recommendations');
  s.adapter.interceptAction('back'); assert.equal(coordinator.mode, 'controls');
  s.adapter.interceptAction('back'); assert.equal(coordinator.mode, 'playback');
  let clickedMode;
  s.location.assign = href => { assert.equal(href, '/channel/UCcreator'); clickedMode = coordinator.mode; };
  s.adapter.interceptAction('up'); for (let i = 0; i < 4; i++) s.watch.handle('left'); s.watch.handle('confirm');
  assert.equal(clickedMode, 'browse'); assert.equal(s.watch.state.mode, 'browse');
  assert.equal(s.classes.has('ytg-watch-active'), false);
  assert.equal(s.adapter.shouldShowSelection({ scope: s.document }), true);
});

test('coordinator synchronizes settings and SPA changes with the watch surface', () => {
  const s = setup(true);
  s.adapter.interceptAction('up');
  s.events['yt-gamepad-local-settings']({ detail: { enabled: false } });
  assert.equal(s.classes.has('ytg-watch-active'), false);
  assert.equal(s.watch.handle('back'), false);
  s.events['yt-gamepad-local-settings']({ detail: { enabled: true } });
  assert.equal(s.watch.state.mode, 'playback'); assert.equal(s.classes.has('ytg-watch-active'), true);
  s.location.pathname = '/results'; s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepadCoordinator.mode, 'browse'); assert.equal(s.watch.state.mode, 'browse');
  s.location.pathname = '/watch'; s.events['popstate']();
  assert.equal(s.window.YTGamepadCoordinator.navigating, true);
  s.events['yt-navigate-finish']();
  assert.equal(s.window.YTGamepadCoordinator.mode, 'playback'); assert.equal(s.watch.state.mode, 'playback');
});

test('closing native settings restores watch controls through the coordinator policy', () => {
  const s = setup(true);
  s.adapter.interceptAction('up'); s.watch.handle('right');
  s.window.YTGamepadCoordinator.setMode('playback');
  s.adapter.onAction('back', { scope: { matches: () => true, querySelector: () => null } });
  assert.equal(s.clicks, 1);
  assert.equal(s.window.YTGamepadCoordinator.mode, 'controls');
  assert.equal(s.watch.state.mode, 'controls'); assert.equal(s.watch.state.index, 5);
  assert.equal(s.shadow.activeElement.dataset.action, 'seekForward');
});

test('video completion opens gamepad recommendations once and can open them again after replay', () => {
  const s = setup(true);
  assert.equal(s.watch.state.mode, 'playback');
  const finish = () => {
    s.video.ended = true; s.video.paused = true;
    s.events.ended({ target: { tagName: 'VIDEO' } });
    s.flushFrames();
  };
  finish();
  assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.watch.state.row, 'recommendations');
  s.watch.handle('back');
  s.watch.handle('back');
  s.watch.refresh();
  assert.equal(s.watch.state.mode, 'playback', 'a refresh must not reopen dismissed recommendations');
  s.video.ended = false; s.video.paused = false;
  s.watch.refresh();
  finish();
  assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.watch.state.row, 'recommendations');
});

test('playlist completion leaves the native queue in charge of the next video', () => {
  const s = setup();
  s.location.search = '?v=current&list=RDcurrent&start_radio=1';
  s.watch.sync();
  s.video.ended = true; s.video.paused = true;
  s.watch.refresh();
  assert.equal(s.watch.state.mode, 'playback', 'the recommendation overlay must not interrupt playlist transitions');
  s.location.search = '?v=next&list=RDcurrent&index=2';
  s.video.ended = false; s.video.paused = false;
  s.watch.sync();
  assert.equal(s.watch.state.mode, 'playback');
});

test('video completion preserves an open gamepad panel', () => {
  const s = setup(true); s.watch.show();
  for (let i = 0; i < 3; i++) s.watch.handle('left');
  s.watch.handle('confirm');
  assert.equal(s.watch.state.panel, 'description');
  s.video.ended = true; s.video.paused = true;
  s.events.ended({ target: { tagName: 'VIDEO' } });
  assert.equal(s.watch.state.panel, 'description');
});

test('auto-hide requires idle controls, playing video and no temporary layer or navigation', () => {
  for (const blocker of ['paused', 'ended', 'recommendations', 'progress', 'panel', 'menu', 'nativeDialog', 'navigating']) {
    const s = setup(true); s.watch.show();
    if (blocker === 'paused') s.video.paused = true;
    if (blocker === 'ended') s.video.ended = true;
    if (blocker === 'recommendations') s.watch.show('recommendations');
    if (blocker === 'progress') s.watch.handle('up');
    if (blocker === 'panel') { for (let i = 0; i < 3; i++) s.watch.handle('left'); s.watch.handle('confirm'); }
    if (blocker === 'menu') s.window.YTGamepadMenu.opened = true;
    if (blocker === 'nativeDialog') {
      const original = s.document.querySelectorAll;
      s.document.querySelectorAll = selector => selector.startsWith('[role=') ? [{ isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100 }), closest: () => null }] : original(selector);
    }
    if (blocker === 'navigating') s.events['yt-navigate-start']();
    s.advance(6000); s.tick();
    assert.equal(s.watch.state.mode, 'controls', blocker);
  }
  const s = setup(true); s.watch.show();
  s.advance(5000); s.tick(); assert.equal(s.watch.state.mode, 'controls');
  s.advance(1); s.tick(); assert.equal(s.watch.state.mode, 'playback');
});
test('closing a native layer grants a fresh idle window', () => {
  const s = setup(true); s.watch.show();
  s.window.YTGamepad.hasTemporaryLayer = true;
  s.advance(6000); s.tick();
  s.window.YTGamepad.hasTemporaryLayer = false;
  s.advance(5000); s.tick(); assert.equal(s.watch.state.mode, 'controls');
  s.advance(1); s.tick(); assert.equal(s.watch.state.mode, 'playback');
});
test('recommendation refresh does not steal native dialog focus', () => {
  const s = setup(true); s.watch.show('recommendations');
  const selected = s.shadow.activeElement;
  s.window.YTGamepad.hasTemporaryLayer = true;
  s.clearCards();
  assert.equal(s.watch.state.row, 'controls');
  assert.equal(s.shadow.activeElement, selected);
});

test('stale view sync cannot overwrite coordinator mode or enablement', () => {
  const s = setup(true), coordinator = s.window.YTGamepadCoordinator;
  s.watch.show('recommendations');
  s.watch.sync('playback', { enabled: false });
  assert.equal(coordinator.mode, 'controls');
  assert.equal(s.watch.state.mode, 'controls');
  assert.equal(s.watch.state.row, 'recommendations');
  assert.equal(s.classes.has('ytg-watch-active'), true);
  const snapshot = coordinator.state; snapshot.mode = 'browse'; snapshot.enabled = false;
  assert.equal(coordinator.mode, 'controls');
  assert.equal(coordinator.state.enabled, true);
  s.events['yt-gamepad-exit']();
  s.watch.sync('controls', { enabled: true });
  assert.equal(coordinator.mode, 'browse');
  assert.equal(s.watch.ownsFocus, false);
  assert.equal(s.classes.has('ytg-watch-active'), false);
});

test('global exit restores the native watch page and clears an open comments panel', () => {
  const s = setup(true); s.watch.show();
  for (let i = 0; i < 4; i++) s.watch.handle('right');
  s.watch.handle('confirm');
  assert.equal(s.watch.state.panel, 'comments');
  s.events['yt-gamepad-exit']();
  for (const name of ['ytg-watch-active', 'ytg-playback', 'ytg-controls', 'ytg-theater', 'ytg-comments', 'ytg-settings-open']) assert.equal(s.classes.has(name), false, name);
  assert.equal(s.watch.state.panel, '');
  assert.equal(s.watch.handle('confirm'), false);
  s.events['yt-gamepad-local-settings']({ detail: { theater: true } });
  assert.equal(s.classes.has('ytg-watch-active'), false);
  s.events['yt-gamepad-resume']();
  assert.equal(s.classes.has('ytg-watch-active'), true);
});

test('watch renders and operates through injected snapshots without native DOM access', () => {
  const s = setup(), commands = [];
  Object.assign(s.controller, {
    readRoute: () => ({ key: '/watch?v=isolated', isWatch: true }),
    readWatchPage: () => ({ isWatch: true, title: '适配器提供的标题', channel: '频道', viewCount: 42,
      description: '说明', recommendations: [{ key: 'isolated-next', label: '下一条', channel: '频道', thumbnail: '' }] }),
    readPlayback: () => ({ video: { currentTime: 25, duration: 100, paused: false, timeline: { isLive: false, canSeek: true, start: 0, end: 100, ranges: [{ start: 0, end: 100 }], atLiveEdge: false } }, captionsEnabled: true, settingsOpen: false }),
    readComments: () => [{ key: 'comment', author: '作者', text: '评论', expanded: [], hasReplies: true, repliesLabel: '回复' }],
    hasNativeLayer: () => false, hasTemporaryLayer: () => false,
    perform: action => { commands.push(action); return true; },
    openRecommendation: key => { commands.push(key); return 'opened'; },
    openSettings: () => { commands.push('settings'); return true; },
    backSettings: () => false, loadComments: () => commands.push('loadComments'),
    expandReplies: key => { commands.push(key); return true; }
  });
  s.document.querySelector = s.document.querySelectorAll = () => { throw new Error('view attempted native DOM access'); };
  s.watch.sync('playback', { enabled: true });
  s.watch.show('recommendations');
  assert.equal(s.watch.state.recommendations, 1);
  s.watch.handle('confirm'); assert.deepEqual(commands, ['isolated-next']);
  s.watch.handle('back'); s.watch.handle('up'); s.watch.handle('confirm'); s.watch.handle('right');
  assert.deepEqual(commands, ['isolated-next', 'seekForward']);
  const texts = node => [node.textContent, ...node.children.flatMap(texts)];
  assert.ok(texts(s.shadow).includes('适配器提供的标题'));
  assert.ok(texts(s.shadow).includes('0:25'));
  s.tick();
});

test('adapter snapshots do not expose native media or recommendation nodes', () => {
  const s = setup(), site = s.window.YTGamepadSite;
  const page = site.readWatchPage(), playback = site.readPlayback();
  assert.equal(page.title, '当前视频');
  assert.equal(page.recommendations[0].key, 'next');
  assert.equal(page.recommendations[0].anchor, undefined);
  playback.video.currentTime = 99;
  assert.equal(s.video.currentTime, 10);
  assert.doesNotThrow(() => JSON.stringify({ page, playback }));
  s.clearCards();
  assert.equal(site.openRecommendation('next', () => { throw new Error('must not navigate'); }), 'missing');
});

test('adapter clears stale recommendations while the player belongs to the previous route', () => {
  const s = setup();
  s.location.search = '?v=new-video';
  const page = s.window.YTGamepadSite.readWatchPage();
  assert.equal(page.waiting, true);
  assert.equal(page.title, ''); assert.equal(page.recommendations.length, 0);
  assert.equal(s.window.YTGamepadSite.openRecommendation('next', () => true), 'missing');
  s.watch.refresh();
  assert.equal(s.watch.state.recommendations, 0);
});


test('left and right in playback seek directly while keeping controls hidden', () => {
  for (const [action, expected] of [['left', 0], ['right', 20]]) {
    const s = setup(true);
    s.adapter.interceptAction(action);
    assert.equal(s.watch.state.mode, 'playback');
    assert.equal(s.watch.state.index, 4);
    assert.equal(s.video.currentTime, expected);
  }
});

test('continuous seeking accelerates and resets on idle, reversal, route change and other media actions', () => {
  const s = setup(); s.video.duration = 10000; s.video.currentTime = 1000;
  const forward = () => { const before = s.video.currentTime; s.site.perform('seekForward'); return s.video.currentTime - before; };
  assert.deepEqual(Array.from({ length: 8 }, forward), [10, 10, 10, 10, 15, 15, 30, 30]);
  s.advance(600); assert.equal(forward(), 10);
  Array.from({ length: 5 }, forward);
  const before = s.video.currentTime; s.site.perform('seekBack');
  assert.equal(s.video.currentTime - before, -10);
  assert.equal(forward(), 10);
  Array.from({ length: 5 }, forward);
  s.site.perform('playPause'); assert.equal(forward(), 10);
  Array.from({ length: 5 }, forward);
  s.location.search = '?v=changed'; assert.equal(forward(), 10);
  assert.ok(Array.from({ length: 30 }, forward).every(step => step <= 60));
  s.video.currentTime = 9998; assert.equal(forward(), 2);
  assert.equal(forward(), 0);
});

test('B hides controls before exiting page fullscreen and does not navigate in the same press', async () => {
  const s = setup(true); let exits = 0;
  s.document.fullscreenElement = {};
  s.document.exitFullscreen = async () => { exits++; s.document.fullscreenElement = null; };
  s.watch.show();
  s.adapter.interceptAction('back');
  assert.equal(s.watch.state.mode, 'playback'); assert.equal(exits, 0);
  s.adapter.interceptAction('back');
  await Promise.resolve();
  assert.equal(exits, 1); assert.equal(s.video.paused, false);
});

test('shoulders switch recommendations and comments without seeking, starting on recommendations', () => {
  const s = setup();
  s.watch.show();
  assert.equal(s.watch.state.panel, '');
  const time = s.video.currentTime;
  assert.equal(s.watch.handleInput('seekForward'), 'handled');
  assert.equal(s.watch.state.panel, 'comments');
  assert.equal(s.watch.handleInput('seekBack'), 'handled');
  assert.equal(s.watch.state.panel, '');
  assert.equal(s.watch.state.row, 'recommendations');
  assert.equal(s.video.currentTime, time);
});
