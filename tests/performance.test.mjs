import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { coreFixture } from '../scripts/performance.mjs';

test('scroll bursts do no synchronous layout reads and repaint only the selected target once per frame', () => {
  for (const size of [100, 1000]) {
    const s = coreFixture(size); s.window.YTGamepad.navigate('down'); s.reset();
    for (let i = 0; i < 100; i++) {
      s.context.scrollY = i * 10;
      s.events.scroll({ target: s.document });
    }
    assert.deepEqual(s.counts, { rects: 0, styles: 0, queries: 0, frames: 0 });
    s.flush();
    assert.equal(s.counts.frames, 1);
    assert.ok(s.counts.rects <= 2, JSON.stringify(s.counts));
    assert.ok(s.counts.styles <= 2, JSON.stringify(s.counts));
    assert.ok(s.counts.queries <= 1, JSON.stringify(s.counts));
    assert.equal(s.window.YTGamepad.current, s.nodes[0]);
  }
});

test('a DOM mutation still repairs removed focus when a scroll paint is already queued', () => {
  const s = coreFixture(); s.window.YTGamepad.navigate('down'); s.reset();
  s.events.scroll({ target: s.document });
  s.nodes[0].isConnected = false;
  s.mutate([{ type: 'childList', target: s.document.body }]);
  s.flush();
  assert.equal(s.counts.frames, 1);
  assert.equal(s.window.YTGamepad.current, s.nodes[1]);
});

test('scroll offsets survive route return without rebuilding selection memory on scroll', () => {
  const s = coreFixture(20);
  let gridScroll = 0, restored;
  s.window.scrollTo = pos => { s.context.scrollX = pos.left; s.context.scrollY = pos.top; };
  s.window.YTGamepad.registerSite({ selectors: 'cards', getSection: () => 'content', getKey: el => String(s.nodes.indexOf(el)),
    captureBrowseState: () => ({ category: 'music', gridScroll }),
    restoreBrowseState(saved) { restored = saved; return true; } });
  s.window.YTGamepad.focus(s.nodes[3]);
  s.context.scrollX = 12; s.context.scrollY = 450; gridScroll = 760;
  const grid = { matches: selector => selector === '[data-ytg-browse-grid]', scrollTop: gridScroll };
  s.events.scroll({ target: grid });
  s.flush();
  // A direct route transition also exercises the scroll-only saved snapshot.
  s.context.location.search = '?other'; s.context.scrollX = 0; s.context.scrollY = 0;
  s.dispatch('yt-navigate-finish');
  s.context.location.search = ''; s.dispatch('yt-navigate-finish');
  assert.equal(s.window.YTGamepad.current, s.nodes[3]);
  assert.equal(s.context.scrollX, 12); assert.equal(s.context.scrollY, 450);
  assert.equal(restored.category, 'music'); assert.equal(restored.gridScroll, 760);
});

test('scroll saves only offsets while selection and navigation capture complete focus state', () => {
  const s = coreFixture(100);
  let captures = 0, keys = 0, gridScroll = 0;
  s.window.YTGamepad.registerSite({ selectors: 'cards', getSection: () => 'content',
    getKey(el) { keys++; return String(s.nodes.indexOf(el)); },
    captureBrowseState() { captures++; return { category: 'music', gridScroll }; } });
  s.window.YTGamepad.focus(s.nodes[3]);
  const beforeScroll = { captures, keys };
  const grid = { matches: selector => selector === '[data-ytg-browse-grid]', scrollTop: 0 };
  for (let i = 0; i < 100; i++) {
    gridScroll = grid.scrollTop = i * 10;
    s.events.scroll({ target: grid });
  }
  s.flush();
  assert.deepEqual({ captures, keys }, beforeScroll, 'scrolling cannot capture categories or scan candidate identities');
  s.window.YTGamepad.focus(s.nodes[4]);
  assert.ok(captures > beforeScroll.captures, 'a new selection saves complete focus state');
  const beforeDeparture = captures;
  s.dispatch('yt-navigate-start');
  assert.ok(captures > beforeDeparture, 'departure saves the current list and category');
});

test('scrolling another container cannot overwrite the saved browse viewport', () => {
  const s = coreFixture(20);
  let restored;
  s.window.YTGamepad.registerSite({ selectors: 'cards', getSection: () => 'content',
    getKey: el => String(s.nodes.indexOf(el)), captureBrowseState: () => ({ category: 'music', gridScroll: 80 }),
    restoreBrowseState(saved) { restored = saved; return true; } });
  s.window.YTGamepad.focus(s.nodes[3]);
  s.events.scroll({ target: { matches: () => false, scrollTop: 900 } });
  s.context.location.search = '?other'; s.dispatch('yt-navigate-finish');
  s.context.location.search = ''; s.dispatch('yt-navigate-finish');
  assert.equal(restored.gridScroll, 80);
  assert.equal(s.window.YTGamepad.current, s.nodes[3]);
});

test('stable candidate indexes avoid peer reads and remeasure after a layout notification', () => {
  const s = coreFixture(); s.window.YTGamepad.navigate('down'); s.reset();
  s.window.YTGamepad.navigate('right');
  assert.equal(s.window.YTGamepad.current, s.nodes[1]);
  assert.ok(s.counts.rects <= 4, JSON.stringify(s.counts)); assert.ok(s.counts.queries <= 1);
  // Moving the former left neighbor to the right must affect the next action.
  s.nodes[0].getBoundingClientRect = () => ({ left: 600, right: 780, top: 0, bottom: 80, width: 180, height: 80 });
  s.mutate([{ type: 'attributes', attributeName: 'style', target: s.nodes[0] }]);
  s.window.YTGamepad.navigate('left');
  assert.equal(s.window.YTGamepad.current, s.nodes[1]);
});

test('player animation does no recovery work while mixed page mutations still coalesce', () => {
  const s = coreFixture(); s.window.YTGamepad.navigate('down'); s.reset();
  for (let i = 0; i < 3600; i++) s.playbackFrame();
  assert.equal(s.counts.frames, 0); assert.equal(s.counts.rects, 0);
  for (let i = 0; i < 100; i++) s.mutate([{ type: 'childList', target: s.document.body }]);
  s.flush(); assert.equal(s.counts.frames, 1);
  s.document.hidden = true;
  s.mutate([{ type: 'childList', target: s.document.body }]); s.flush();
  assert.equal(s.counts.frames, 1);
  s.document.hidden = false; s.events.visibilitychange(); s.flush();
  assert.equal(s.counts.frames, 2);
});

test('YouTube filters animated player subtrees while keeping native settings changes', () => {
  const window = {};
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window });
  const ignore = window.YTGamepadSite.createNavigationConfig({}).ignoreMutation;
  const target = { closest: selector => selector === '#movie_player' || selector.includes('caption') ? {} : null };
  assert.equal(ignore({ target }), true);
  assert.equal(ignore({ target: { closest: selector => selector === '#movie_player' ? {} : null } }), false);
  assert.equal(ignore({ target: { closest: () => null } }), false);
  const progress = { closest: selector => selector === '#movie_player' ? {} : selector === '.ytp-progress-bar' ? progress : null };
  assert.equal(ignore({ type: 'attributes', attributeName: 'hidden', target: progress }), false);
});

test('API surfaces ignore hidden native list mutations while native mode and dialogs remain observable', () => {
  const classes = new Set(['ytg-custom-browse']);
  let native = false;
  const window = {}, document = { documentElement: { classList: { contains: name => classes.has(name) }, hasAttribute: () => native } };
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window, document });
  const ignore = window.YTGamepadSite.createNavigationConfig({}).ignoreMutation;
  const browse = { closest: selector => selector.includes('ytd-page-manager') ? {} : null };
  assert.equal(ignore({ target: browse }), true);
  native = true; assert.equal(ignore({ target: browse }), false);
  native = false;
  const dialog = { closest: selector => selector.includes('[role="dialog"]') || selector.includes('ytd-page-manager') ? {} : null };
  assert.equal(ignore({ target: dialog }), false);
  classes.clear(); classes.add('ytg-watch-active');
  const related = { closest: selector => selector.includes('#secondary') ? {} : null };
  assert.equal(ignore({ target: related }), true);
  classes.clear(); assert.equal(ignore({ target: related }), false);
});

test('dictionary shards stay lazy and learned rankings invalidate cached results', () => {
  const parsed = [], window = {}, storage = new Map();
  const context = { window, JSON: { parse(value) { parsed.push(value.length); return JSON.parse(value); }, stringify: JSON.stringify },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  for (const file of ['src/search/pinyin-data.ts', 'src/search/pinyin.ts']) runInNewContext(moduleSource(file), context);
  const ime = window.YTGamepadPinyin;
  assert.equal(parsed.length, 0); ime.lookup(''); assert.equal(parsed.length, 0);
  const list = ime.lookup('ni'); assert.equal(parsed.length, 1);
  assert.equal(list[0].text, '你');
  list[0].text = 'corrupted'; assert.equal(ime.lookup('ni')[0].text, '你');
  ime.learn(ime.lookup('ni').find(item => item.key === 'ni' && item.text === '尼'));
  assert.equal(ime.lookup('ni')[0].text, '尼');
  ime.lookup('zhong'); assert.equal(parsed.length, 2);
  assert.equal(ime.lookup('constructor').length, 0);
});
