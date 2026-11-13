import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreFixture } from '../scripts/performance.mjs';

test('controller entry and layout changes reveal the whole card below banners; wheel scrolling stays free', () => {
  const s = coreFixture(1), scrolls = [];
  let gamepad = false, baseTop = 400;
  s.document.documentElement.classList.contains = name => name === 'ytg-gamepad-input' && gamepad;
  s.context.scrollY = 380;
  s.nodes[0].getBoundingClientRect = () => {
    const top = baseTop - s.context.scrollY;
    return { top, bottom: top + 240, left: 100, right: 400, width: 300, height: 240 };
  };
  s.window.scrollTo = ({ top }) => { scrolls.push(top); s.context.scrollY = top; };
  s.window.YTGamepad.registerSite({ selectors: 'cards', getSection: () => 'content',
    sections: { content: { layout: 'grid' } }, getViewport: () => ({ top: 144, bottom: 784 }) });
  s.window.YTGamepad.focus(s.nodes[0]);
  assert.equal(scrolls.length, 0);
  gamepad = true;
  s.dispatch('yt-gamepad-input-mode', { detail: { mode: 'gamepad' } }); s.flush();
  assert.equal(s.nodes[0].getBoundingClientRect().top, 144);
  assert.ok(s.nodes[0].getBoundingClientRect().bottom <= 784);
  baseTop = 300;
  s.mutate([{ type: 'attributes', attributeName: 'style', target: s.nodes[0] }]); s.flush();
  assert.equal(s.nodes[0].getBoundingClientRect().top, 144);
  gamepad = false; s.context.scrollY = 280;
  const beforeWheel = scrolls.length;
  s.dispatch('scroll'); s.flush();
  s.events.resize(); s.flush();
  assert.equal(scrolls.length, beforeWheel);
  assert.equal(s.nodes[0].getBoundingClientRect().top, 20);
});

test('vertical card navigation centers the destination and clamps to the feed edges', () => {
  const s = coreFixture(3), [first, middle, last] = s.nodes;
  const scrolls = [];
  const grid = {
    scrollTop: 0, scrollHeight: 1000, clientHeight: 400,
    getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    scrollTo({ top }) { scrolls.push(top); this.scrollTop = top; }
  };
  s.context.CustomEvent = CustomEvent;
  let target;
  for (const [index, card] of s.nodes.entries()) {
    card.dataset.browseId = String(index);
    card.closest = selector => ['[data-ytg-browse-grid]', '[data-ytg-indexed-feed]'].includes(selector) ? grid : null;
    card.getBoundingClientRect = () => {
      const top = 100 + [0, 300, 920][index] - grid.scrollTop;
      return { top, bottom: top + 80, left: 0, right: 180, width: 180, height: 80 };
    };
    card.dispatchEvent = event => { event.detail.focus(target); return false; };
  }
  s.window.YTGamepad.focus(first);
  target = middle; s.window.YTGamepad.navigate('down');
  target = last; s.window.YTGamepad.navigate('down');
  target = first; s.window.YTGamepad.navigate('up');
  assert.deepEqual(scrolls, [140, 600, 0]);
  grid.scrollTop = 77;
  s.dispatch('scroll', { target: grid }); s.flush();
  assert.equal(grid.scrollTop, 77);
});
