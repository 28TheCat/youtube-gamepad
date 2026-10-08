import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  let now = 0, count = 0, playerId = 'first', sourceReady = true, scrolls = 0;
  const classes = new Set(), location = { pathname: '/watch', search: '?v=first' };
  const below = { get scrollTop() { return 0; }, set scrollTop(value) { scrolls++; },
    getBoundingClientRect: () => ({ top: 0 }) };
  const source = { querySelector: () => null, getBoundingClientRect: () => ({ top: 120 }),
    scrollIntoView() { throw new Error('must not scroll the page'); } };
  const document = { documentElement: { classList: {
    toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name)
  } }, querySelector(selector) {
    if (selector === '#movie_player') return { getPlayerResponse: () => ({ videoDetails: { videoId: playerId } }) };
    if (selector === 'ytd-comments') return sourceReady ? source : null;
    if (selector === '#below') return below;
    return null;
  }, querySelectorAll: () => Array.from({ length: count }, () => ({ querySelector: () => ({ textContent: 'loaded' }) })) };
  const window = {};
  runInNewContext(moduleSource('src/sites/youtube.ts'),
    { window, document, location, URLSearchParams, Date: { now: () => now } });
  return { classes, location, sync: window.YTGamepadSite.syncCommentPreload,
    get scrolls() { return scrolls; }, count(value) { count = value; }, player(value) { playerId = value; },
    source(value) { sourceReady = value; }, advance(ms = 1000) { now += ms; } };
}

test('preload warms one native batch without scrolling the page, then stays stopped', () => {
  const s = setup(); s.sync(true);
  assert.equal(s.classes.has('ytg-comments-preload'), true); assert.equal(s.scrolls, 1);
  s.sync(true); assert.equal(s.scrolls, 1);
  s.count(20); s.advance(); s.sync(true);
  assert.equal(s.classes.has('ytg-comments-preload'), false);
  s.count(0); s.advance(); s.sync(true); assert.equal(s.scrolls, 1);
});

test('missing or disabled comments stop after bounded retries; foreground loading remains available', () => {
  const s = setup(); s.source(false);
  for (let i = 0; i < 11; i++) { s.sync(true); s.advance(); }
  assert.equal(s.classes.has('ytg-comments-preload'), false); assert.equal(s.scrolls, 0);
  s.source(true); s.sync(true); assert.equal(s.scrolls, 0);
});

test('navigation and disable clean up; a new video gets its own preload after player data updates', () => {
  const s = setup(); s.sync(true); s.sync(false);
  assert.equal(s.classes.has('ytg-comments-preload'), false);
  s.location.search = '?v=second'; s.advance(); s.sync(true);
  assert.equal(s.classes.has('ytg-comments-preload'), false); assert.equal(s.scrolls, 1);
  s.player('second'); s.sync(true); assert.equal(s.scrolls, 2);
  s.classes.add('ytg-comments'); s.advance(); s.sync(true);
  assert.equal(s.classes.has('ytg-comments-preload'), false); assert.equal(s.scrolls, 2);
  s.location.pathname = '/'; s.sync(true);
  assert.equal(s.classes.has('ytg-comments-preload'), false);
});
