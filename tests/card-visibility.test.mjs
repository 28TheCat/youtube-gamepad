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
  s.events['yt-gamepad-input-mode']({ detail: { mode: 'gamepad' } }); s.flush();
  assert.equal(s.nodes[0].getBoundingClientRect().top, 144);
  assert.ok(s.nodes[0].getBoundingClientRect().bottom <= 784);
  baseTop = 300;
  s.mutate([{ type: 'attributes', attributeName: 'style', target: s.nodes[0] }]); s.flush();
  assert.equal(s.nodes[0].getBoundingClientRect().top, 144);
  gamepad = false; s.context.scrollY = 280;
  const beforeWheel = scrolls.length;
  s.events.scroll(); s.flush();
  s.events.resize(); s.flush();
  assert.equal(scrolls.length, beforeWheel);
  assert.equal(s.nodes[0].getBoundingClientRect().top, 20);
});
