import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { coreFixture } from '../scripts/performance.mjs';

test('long-list actions share reads but remeasure after the next DOM update', () => {
  const s = coreFixture(); s.window.YTGamepad.navigate('down'); s.reset();
  s.window.YTGamepad.navigate('right');
  assert.equal(s.window.YTGamepad.current, s.nodes[1]);
  assert.ok(s.counts.rects <= 1002); assert.ok(s.counts.queries <= 2);
  // Moving the former left neighbor to the right must affect the next action.
  s.nodes[0].getBoundingClientRect = () => ({ left: 600, right: 780, top: 0, bottom: 80, width: 180, height: 80 });
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
  runInNewContext(moduleSource('sites/youtube.js'), { window });
  const ignore = window.YTGamepadSite.createNavigationConfig({}).ignoreMutation;
  const target = { closest: selector => selector === '#movie_player' || selector.includes('caption') ? {} : null };
  assert.equal(ignore({ target }), true);
  assert.equal(ignore({ target: { closest: selector => selector === '#movie_player' ? {} : null } }), false);
  assert.equal(ignore({ target: { closest: () => null } }), false);
  const progress = { closest: selector => selector === '#movie_player' ? {} : selector === '.ytp-progress-bar' ? progress : null };
  assert.equal(ignore({ type: 'attributes', attributeName: 'hidden', target: progress }), false);
});

test('dictionary shards stay lazy and learned rankings invalidate cached results', () => {
  const parsed = [], window = {}, storage = new Map();
  const context = { window, JSON: { parse(value) { parsed.push(value.length); return JSON.parse(value); }, stringify: JSON.stringify },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  for (const file of ['pinyin-data.js', 'pinyin.js']) runInNewContext(moduleSource(file), context);
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
