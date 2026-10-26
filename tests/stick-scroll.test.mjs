import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('right stick scrolls the owning list or dialog while keeping selection and background stationary', { timeout: 60000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { contents: Array.from({ length: 80 }, (_, i) => ({ videoRenderer: {
      videoId: `scroll${i}`, title: { simpleText: `Scroll video ${i}` }
    } })) } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead><input id="search"></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  for (const file of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined };
    window.scrollPad = { index: 0, id: 'Scroll controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.scrollPad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  const grid = page.locator('[data-ytg-browse-grid]');
  const first = grid.locator('[data-browse-id="video:scroll0"]');
  await first.waitFor();
  await first.evaluate(node => { window.YTGamepad.focus(node); window.initialScrollSelection = node; });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
  const stick = value => page.evaluate(value => { window.scrollPad.axes[3] = value; }, value);
  await settle();
  await stick(1);
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-ytg-browse-grid]').scrollTop > 180);
  assert.equal(await page.evaluate(() => window.YTGamepadInput.mode), 'gamepad');
  assert.equal(await page.evaluate(() => window.YTGamepad.current === window.initialScrollSelection), true);
  assert.equal(await grid.evaluate(node => node.style.getPropertyValue('scroll-snap-type')), 'none', 'snap points do not defeat small analog deltas');
  await stick(0); await settle();
  const stopped = await grid.evaluate(node => node.scrollTop);
  await settle();
  assert.equal(await grid.evaluate(node => node.scrollTop), stopped);
  assert.equal(await grid.evaluate(node => node.style.getPropertyValue('scroll-snap-type')), '', 'release restores the authored scrolling behavior');

  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.id = 'stick-native-dialog'; dialog.role = 'dialog';
    dialog.style.cssText = 'position:fixed;inset:100px auto auto 100px;z-index:99999;width:300px;height:200px;overflow:auto;background:white';
    const button = document.createElement('button'); button.textContent = 'Dialog action';
    const text = document.createElement('div'); text.style.height = '2000px';
    dialog.append(button, text); document.body.append(dialog); window.YTGamepad.focus(button);
  });
  await settle();
  const background = await grid.evaluate(node => node.scrollTop);
  await stick(1);
  await page.waitForFunction(() => document.querySelector('#stick-native-dialog').scrollTop > 120);
  assert.equal(await grid.evaluate(node => node.scrollTop), background, 'native dialogs own the scroll');
  await page.locator('#stick-native-dialog').evaluate(node => node.scrollTop = node.scrollHeight);
  await settle();
  assert.equal(await grid.evaluate(node => node.scrollTop), background, 'the end of a dialog cannot scroll its background');
  await stick(0); await settle();
  await page.locator('#stick-native-dialog').evaluate(node => node.remove());
  await settle();

  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  const section = page.locator('#yt-gamepad-menu section');
  await section.waitFor();
  await section.evaluate(node => {
    const content = document.createElement('div'); content.style.height = '2000px'; node.append(content);
    node.querySelector('button').focus();
  });
  await settle();
  const menuBackground = await grid.evaluate(node => node.scrollTop);
  await stick(1);
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('section').scrollTop > 120);
  assert.equal(await grid.evaluate(node => node.scrollTop), menuBackground, 'menu scrolling cannot reach the feed');
  await stick(0); await settle();
  await page.evaluate(() => { window.YTGamepadMenu.close(); window.YTGamepadMenu.openSearch(); });
  await page.locator('#yt-gamepad-menu #query').waitFor();
  await stick(1); await settle();
  assert.equal(await grid.evaluate(node => node.scrollTop), menuBackground, 'search keyboard consumes the spare stick without moving the page');
  await stick(0); await settle();
  await page.evaluate(() => { window.YTGamepadMenu.close(); window.YTGamepadRuntime.destroy(); });
  assert.equal(await page.locator('#ytg-browse-root').count(), 0);
});
