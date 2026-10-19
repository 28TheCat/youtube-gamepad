import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('browse shadow isolates styles, fills the viewport, follows theme and cleans up', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><style>button{color:rgb(255,0,255)!important;background:rgb(0,255,0)!important;font-size:88px!important}.cards{display:none!important}</style>
    <button id="native-probe" class="client-brand"><svg></svg>Native</button>
    <ytd-masthead><input id="search"><button id="search-icon-legacy">Search</button></ytd-masthead>
    <ytd-page-manager><ytd-browse>${['a', 'b', 'c'].map(id => `<ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=${id}">${id}</a></ytd-rich-item-renderer>`).join('')}</ytd-browse></ytd-page-manager></body></html>` }));
  await page.goto('https://www.youtube.com/feed/custom');
  for (const file of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.testPad = { connected: true, mapping: 'standard', index: 0,
      id: 'test', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  const shell = page.locator('#ytg-browse-root');
  await shell.waitFor();
  await shell.locator('[data-browse-id="video:a"]').waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-browse-grid')), null, 'page selectors cannot reach the isolated tree');
  assert.deepEqual(await shell.boundingBox(), { x: 0, y: 0, width: 1280, height: 900 });
  assert.deepEqual(await shell.locator('.client-brand').evaluate(node => {
    const style = getComputedStyle(node); return [style.color, style.fontSize];
  }), ['rgb(15, 15, 15)', '20px']);
  assert.equal(await shell.locator('.cards').evaluate(node => getComputedStyle(node).display), 'grid');
  const card = id => shell.locator(`[data-browse-id="video:${id}"]`);
  const outline = id => card(id).locator('.card-cover').evaluate(node => getComputedStyle(node).outlineStyle);
  await card('a').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await card('b').evaluate(node => node.classList.contains('ytg-selected')), true);
  assert.equal(await outline('b'), 'solid', 'keyboard selection has a blue thumbnail frame');
  await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'gamepad');
  await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
  assert.equal(await card('c').evaluate(node => node.classList.contains('ytg-selected')), true);
  assert.equal(await outline('c'), 'solid', 'gamepad navigation keeps the same blue frame after switching input');
  const brand = shell.locator('.client-brand');
  await brand.evaluate(node => window.YTGamepad.focus(node));
  assert.equal(await brand.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
  assert.equal(await brand.evaluate(node => {
    const style = getComputedStyle(node);
    return parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
  }), 0, 'header ring stays inside the button');
  // Keep the fixture on the list while exercising a real pointer click.
  await brand.evaluate(node => node.addEventListener('click', event => {
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, once: true }));
  await brand.click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'mouse');
  assert.equal(await brand.evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'pointer takeover hides the selected header ring');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await brand.evaluate(node => node.getRootNode().activeElement === node), true);
  assert.equal(await brand.evaluate(node => getComputedStyle(node).outlineStyle), 'solid', 'Tab navigation restores the keyboard focus ring');
  assert.equal(await page.locator('#native-probe').evaluate(node => getComputedStyle(node).fontSize), '88px');
  assert.notEqual(await page.locator('#native-probe svg').evaluate(node => getComputedStyle(node).width), '36px', 'component rules do not leak into native DOM');
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  await page.waitForFunction(() => {
    const root = document.getElementById('ytg-browse-root').shadowRoot;
    return getComputedStyle(root.querySelector('.client-brand')).color === 'rgb(241, 241, 241)';
  });
  await page.setViewportSize({ width: 600, height: 800 });
  assert.deepEqual(await shell.boundingBox(), { x: 0, y: 0, width: 600, height: 800 });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await shell.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.YTGamepadRuntime.destroy());
  assert.equal(await shell.count(), 0);
});
