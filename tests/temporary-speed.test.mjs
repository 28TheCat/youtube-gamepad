import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';

function setup(rate = 1.5) {
  const video = { duration: 100, playbackRate: rate, paused: false, ended: false, currentSrc: 'first', isConnected: true };
  let current = video;
  const listeners = new Map();
  const listen = (target, type, fn) => { const key = target + type; listeners.set(key, [...(listeners.get(key) || []), fn]); };
  const window = { addEventListener: (type, fn) => listen('window', type, fn) };
  const document = { hidden: false, querySelector: () => current, addEventListener: (type, fn) => listen('document', type, fn) };
  const location = { pathname: '/watch', search: '?v=first' };
  runInNewContext(moduleSource('src/sites/youtube.ts'), { window, document, location });
  return { video, document, location, site: window.YTGamepadSite,
    replace(next) { current = next; },
    event(type, target = video, surface = 'document') { for (const fn of listeners.get(surface + type) || []) fn({ target }); } };
}

test('temporary 2x restores the exact saved rate, including repeated holds', () => {
  for (const rate of [.75, 1, 1.5, 1.75]) {
    const s = setup(rate);
    for (let i = 0; i < 2; i++) {
      assert.equal(s.site.temporarySpeed(true), 2); assert.equal(s.video.playbackRate, 2);
      assert.equal(s.site.temporarySpeed(true), 2);
      s.site.temporarySpeed(false); assert.equal(s.video.playbackRate, rate);
    }
  }
});

test('speed refuses paused, ended, unknown duration and already faster playback', () => {
  for (const props of [{ paused: true }, { ended: true }, { duration: Infinity }, { duration: NaN }, { playbackRate: 2 }, { playbackRate: 3 }]) {
    const s = setup(); Object.assign(s.video, props);
    const original = s.video.playbackRate;
    assert.equal(s.site.temporarySpeed(true), false); assert.equal(s.video.playbackRate, original);
  }
});

test('video or route replacement restores the old player and leaves the new one untouched', () => {
  for (const replace of [s => { s.location.search = '?v=next'; },
    s => { s.video.currentSrc = 'next'; }, s => { s.video.isConnected = false; },
    s => s.replace({ ...s.video, playbackRate: 1.25 })]) {
    const s = setup(); s.site.temporarySpeed(true); replace(s);
    assert.equal(s.site.temporarySpeed(true), false); assert.equal(s.video.playbackRate, 1.5);
    assert.equal(s.site.temporarySpeed(true), false, 'interrupted hold stays cancelled');
  }
});

test('pause, navigation, source changes and page lifecycle restore speed before another poll', () => {
  for (const [event, surface] of [['pause', 'document'], ['ended', 'document'], ['emptied', 'document'],
    ['loadstart', 'document'], ['yt-navigate-start', 'document'], ['yt-navigate-finish', 'document'],
    ['blur', 'window'], ['pagehide', 'window'], ['popstate', 'window'], ['visibilitychange', 'document']]) {
    const s = setup(); s.site.temporarySpeed(true); s.document.hidden = true; s.event(event, s.video, surface);
    assert.equal(s.video.playbackRate, 1.5, event);
    assert.equal(s.site.temporarySpeed(true), false, event + ' cannot restart the held press');
  }
  const s = setup(); s.site.temporarySpeed(true); s.site.destroy(); assert.equal(s.video.playbackRate, 1.5);
});

test('user speed changes take precedence over restoring the saved speed', () => {
  const s = setup(); s.site.temporarySpeed(true);
  s.video.playbackRate = 1.25; s.event('ratechange');
  assert.equal(s.site.temporarySpeed(true), false);
  s.site.temporarySpeed(false); assert.equal(s.video.playbackRate, 1.25);
  assert.equal(s.site.temporarySpeed(true), 2);
  s.site.temporarySpeed(false); assert.equal(s.video.playbackRate, 1.25);
});
