import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';

const entry = fileURLToPath(new URL('./helpers/navigation-scroll-entry.ts', import.meta.url));
const built = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'ScrollFixture' } }
});
const code = (Array.isArray(built) ? built[0] : built).output.find(item => item.type === 'chunk').code;

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`row navigation reveals the whole row only when needed (${reducedMotion})`, async t => {
    const page = await browserPage(t);
    await page.emulateMedia({ reducedMotion });
    await page.setContent(`<style>
      #grid{height:300px;width:400px;overflow:auto;scroll-padding:20px}
      .virtual-row{display:flex;height:100px;gap:10px}
      button{width:160px;height:60px;flex:none}
      .virtual-row:nth-child(4){height:180px}
      .virtual-row:nth-child(4) button:last-child{height:180px}
    </style><div id="grid" data-ytg-browse-grid data-ytg-indexed-feed>
      ${Array.from({ length: 8 }, (_, row) => `<div class="virtual-row">${[0, 1].map(col =>
        `<button data-browse-id="${row}:${col}">${row}:${col}</button>`).join('')}</div>`).join('')}
    </div>`);
    await page.addScriptTag({ content: code });
    await page.evaluate(() => {
      const core = ScrollFixture.YTGamepadCoreModule.create({ runtime: ScrollFixture.YTGamepadRuntime,
        navigation: ScrollFixture.YTGamepadNavigation,
        controllerStyle: { css: '', hint() {}, register: () => () => {} } });
      const grid = document.querySelector('#grid');
      core.registerSite({ selectors: '#grid button', getKey: el => el.dataset.browseId, getSection: () => 'content',
        sections: { content: { layout: 'grid' } } });
      grid.addEventListener('ytg-browse-direction', event => {
        const [row, col] = event.target.dataset.browseId.split(':').map(Number);
        const next = event.detail.direction === 'down' ? `${row + 1}:${col}` : `${row}:${1 - col}`;
        event.preventDefault();
        event.detail.focus(grid.querySelector(`[data-browse-id="${next}"]`));
      });
      window.scrollCore = core;
      window.rowScrolls = [];
      const scroll = grid.scrollTo.bind(grid);
      grid.scrollTo = options => { window.rowScrolls.push(options); scroll(options); };
      core.focus(grid.querySelector('button'));
      core.navigate('down');
    });
    assert.deepEqual(await page.evaluate(() => window.rowScrolls), [], 'a fully visible next row stays still');
    await page.evaluate(() => { window.scrollCore.navigate('down'); window.scrollCore.navigate('down'); });
    assert.equal(await page.evaluate(() => window.rowScrolls.at(-1).behavior), reducedMotion === 'reduce' ? 'instant' : 'smooth');
    await page.waitForFunction(() => {
      const grid = document.querySelector('#grid'), row = grid.querySelectorAll('.virtual-row')[3];
      const bounds = grid.getBoundingClientRect(), target = row.getBoundingClientRect();
      return target.top >= bounds.top + 19 && target.bottom <= bounds.bottom - 19;
    });
    // The row can be fully visible one pixel before the smooth scroll finishes.
    await page.waitForFunction(() => Math.abs(document.querySelector('#grid').scrollTop - window.rowScrolls.at(-1).top) < .5);
    const before = await page.evaluate(() => ({ top: document.querySelector('#grid').scrollTop, calls: window.rowScrolls.length }));
    await page.evaluate(() => window.scrollCore.navigate('right'));
    assert.deepEqual(await page.evaluate(() => ({ top: document.querySelector('#grid').scrollTop, calls: window.rowScrolls.length })), before,
      'horizontal movement preserves the row position, including a taller neighbour');
    await page.evaluate(() => { window.scrollCore.destroy(); ScrollFixture.YTGamepadRuntime.destroy(); });
  });
}

test('browse confirm feedback never delays clicks, stacks animations, or ignores reduced motion', async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent('<div id="ytg-browse-grid"><button id="confirm">Confirm</button></div>');
  await page.addScriptTag({ content: code });
  const pressed = await page.evaluate(() => {
    window.core = ScrollFixture.YTGamepadCoreModule.create({ runtime: ScrollFixture.YTGamepadRuntime,
      navigation: ScrollFixture.YTGamepadNavigation,
      interaction: { dispatch: () => ({ effects: [{ value: 'region' }] }) },
      controllerStyle: { css: '', hint() {}, register: () => () => {} } });
    const button = document.querySelector('#confirm');
    window.clicks = 0; button.onclick = () => window.clicks++;
    core.registerSite({ selectors: '#confirm' }); core.focus(button);
    core.act('confirm'); core.act('confirm');
    return { clicks, animations: button.getAnimations().filter(a => a.id === 'ytg-press').length };
  });
  assert.deepEqual(pressed, { clicks: 2, animations: 1 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await page.evaluate(() => {
    const button = document.querySelector('#confirm'); button.getAnimations().forEach(a => a.cancel());
    core.act('confirm');
    const result = { clicks, animations: button.getAnimations().length };
    core.destroy(); ScrollFixture.YTGamepadRuntime.destroy(); return result;
  }), { clicks: 3, animations: 0 });
});

test('boundary feedback keeps focus, does not stack, and respects reduced motion', async t => {
  const page = await browserPage(t);
  await page.goto('about:blank');
  await page.setContent('<button id="only">Only item</button>');
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    window.core = ScrollFixture.YTGamepadCoreModule.create({ runtime: ScrollFixture.YTGamepadRuntime,
      navigation: ScrollFixture.YTGamepadNavigation,
      controllerStyle: { css: '', hint() {}, register: () => () => {} } });
    core.registerSite({ selectors: '#only' });
    core.focus(document.querySelector('#only'));
  });
  const feedback = await page.evaluate(() => {
    core.navigate('right'); core.navigate('right');
    const ring = document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
    const animations = ring.getAnimations().filter(a => a.effect.getKeyframes().some(frame => frame.translate));
    return { count: animations.length, duration: animations[0]?.effect.getTiming().duration,
      selected: core.current.id, direction: animations[0]?.effect.getKeyframes()[1].translate };
  });
  assert.deepEqual(feedback, { count: 1, duration: 200, selected: 'only', direction: '4px' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => {
    const ring = document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
    ring.getAnimations().forEach(a => a.cancel());
    core.navigate('left');
    const count = ring.getAnimations().length;
    core.destroy(); ScrollFixture.YTGamepadRuntime.destroy();
    return count;
  });
  assert.equal(reduced, 0);
});

test('native menu navigation reuses indexed targets and rejects same-turn disabled, removed and hidden controls', async t => {
  const page = await browserPage(t);
  await page.setContent('<style>#settings{width:200px}#settings button{display:block;width:180px;height:28px}</style><div id="movie_player"><section id="settings" role="dialog"></section></div><button id="outside">Outside</button>');
  await page.addScriptTag({ content: code });
  const result = await page.evaluate(async () => {
    const menu = document.querySelector('#settings'), outside = document.querySelector('#outside');
    const buttons = Array.from({ length: 12 }, (_, i) => {
      const button = document.createElement('button'); button.textContent = String(i); menu.append(button); return button;
    });
    const core = ScrollFixture.YTGamepadCoreModule.create({ runtime: ScrollFixture.YTGamepadRuntime,
      navigation: ScrollFixture.YTGamepadNavigation,
      controllerStyle: { css: '', hint() {}, register: () => () => {} } });
    core.registerSite({ selectors: '#outside', overlays: '#settings', overlayItems: 'button', getKey: el => el.textContent,
      getOverlayView: () => menu.firstChild?.textContent });
    core.focus(buttons[0]); core.navigate('down'); core.navigate('up');
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const counts = { queries: 0, peers: 0 }, rect = Element.prototype.getBoundingClientRect, query = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function(selector) { if (this === menu && selector === 'button') counts.queries++; return query.call(this, selector); };
    Element.prototype.getBoundingClientRect = function() { if (buttons.slice(2).includes(this)) counts.peers++; return rect.call(this); };
    for (let i = 0; i < 20; i++) core.navigate(i % 2 ? 'up' : 'down');
    const stable = { ...counts };
    // Do not yield: MutationObserver callbacks have not run yet.
    buttons[1].disabled = true; core.navigate('down');
    const skippedDisabled = core.current === buttons[2];
    buttons[2].remove(); core.navigate('up');
    const skippedRemoved = core.current === buttons[0];
    menu.hidden = true; core.navigate('down');
    const escapedHidden = core.current === outside;
    menu.hidden = false;
    const quality = document.createElement('button'); quality.textContent = 'Quality';
    menu.replaceChildren(quality); core.navigate('down');
    const replacedMenu = core.current === quality;
    core.destroy(); ScrollFixture.YTGamepadRuntime.destroy();
    return { stable, skippedDisabled, skippedRemoved, escapedHidden, replacedMenu };
  });
  assert.deepEqual(result.stable, { queries: 0, peers: 0 });
  assert.equal(result.skippedDisabled, true);
  assert.equal(result.skippedRemoved, true);
  assert.equal(result.escapedHidden, true);
  assert.equal(result.replacedMenu, true);
});

for (const shadow of [false, true]) {
  test(`native scrolling keeps the focus ring aligned without scanning 1000 cards (shadow: ${shadow})`, async t => {
    const page = await browserPage(t);
    await page.goto('about:blank');
    await page.evaluate(code);
    const result = await page.evaluate(async shadow => {
      const host = document.createElement('div'); host.id = 'ytg-browse-root'; document.body.append(host);
      const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
      const style = document.createElement('style');
      style.textContent = '#cards{display:grid;grid-template-columns:repeat(5,100px);gap:10px}#cards button{height:60px}';
      const grid = document.createElement('div'); grid.id = 'cards'; grid.setAttribute('data-ytg-browse-grid', '');
      if (shadow) { grid.style.height = '300px'; grid.style.overflow = 'auto'; }
      const cards = Array.from({ length: 1000 }, (_, i) => {
        const button = document.createElement('button'); button.textContent = String(i); grid.append(button); return button;
      });
      root.append(style, grid);
      const core = ScrollFixture.YTGamepadCoreModule.create({ runtime: ScrollFixture.YTGamepadRuntime,
        navigation: ScrollFixture.YTGamepadNavigation,
        controllerStyle: { css: '', hint() {}, register: () => () => {} } });
      core.registerSite({ selectors: '#cards button', getKey: el => el.textContent, getSection: () => 'content' });
      core.focus(cards[20]);
      const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
      await settle();
      const counts = { rects: 0, otherCardRects: 0, styles: 0, candidateQueries: 0 };
      const originalRect = Element.prototype.getBoundingClientRect, originalStyle = window.getComputedStyle;
      Element.prototype.getBoundingClientRect = function() {
        counts.rects++; if (this.parentElement === grid && this !== cards[20]) counts.otherCardRects++;
        return originalRect.call(this);
      };
      window.getComputedStyle = (...args) => { counts.styles++; return originalStyle(...args); };
      for (const prototype of [Document.prototype, ShadowRoot.prototype]) {
        const query = prototype.querySelectorAll;
        prototype.querySelectorAll = function(selector) {
          if (selector === '#cards button') counts.candidateQueries++;
          return query.call(this, selector);
        };
      }
      if (shadow) grid.scrollTop = 140; else window.scrollTo(0, 140);
      for (let i = 0; i < 100; i++) (shadow ? grid : window).dispatchEvent(new Event('scroll'));
      const synchronous = { ...counts };
      await settle();
      const measured = { ...counts }, selected = core.current === cards[20];
      const rect = originalRect.call(cards[20]);
      const ring = document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
      const matrix = new DOMMatrixReadOnly(ring.style.transform);
      const aligned = Math.abs(matrix.m41 - (rect.left - 3)) < 1 && Math.abs(matrix.m42 - (rect.top - 3)) < 1;
      core.destroy(); ScrollFixture.YTGamepadRuntime.destroy();
      return { synchronous, measured, selected, aligned };
    }, shadow);
    assert.deepEqual(result.synchronous, { rects: 0, otherCardRects: 0, styles: 0, candidateQueries: 0 });
    assert.equal(result.measured.otherCardRects, 0);
    assert.equal(result.measured.candidateQueries, 0);
    assert.ok(result.measured.rects <= 4, JSON.stringify(result));
    assert.ok(result.measured.styles <= 4, JSON.stringify(result));
    assert.equal(result.selected, true); assert.equal(result.aligned, true);
  });
}
