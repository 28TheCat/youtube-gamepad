import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('component search bar bridges native search, IME, voice, gamepad editing and teardown', { timeout: 60000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><ytd-masthead style="display:block;height:56px">
      <div id="center" style="width:650px;margin:auto;padding-top:8px">
        <div><input id="search" placeholder="搜索" value="existing"><button id="search-icon-legacy">Search</button></div>
        <div id="voice-search-button"><button>Voice</button></div>
      </div></ytd-masthead><ytd-page-manager><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=one">Video</a></ytd-rich-item-renderer></ytd-page-manager>
    </body></html>` }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.submissions = [];
    document.querySelector('#search-icon-legacy').onclick = () => window.submissions.push(document.querySelector('#search').value);
    document.querySelector('#voice-search-button button').onclick = () => window.voiceClicked = true;
    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    window.__searchPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  const host = page.locator('#ytg-search-host');
  const input = host.locator('input');
  await host.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'existing');
  assert.equal(await page.locator('#search').isVisible(), false);
  await input.fill('  component search  ');
  assert.equal(await page.locator('#search').inputValue(), '  component search  ');
  await input.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.submissions), ['component search']);
  await input.fill('中文');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  assert.equal(await page.evaluate(() => window.submissions.length), 1);
  await input.dispatchEvent('compositionend');
  await host.locator('button[type=submit]').click();
  assert.deepEqual(await page.evaluate(() => window.submissions), ['component search', '中文']);
  await host.getByRole('button', { name: 'Voice search' }).click();
  assert.equal(await page.evaluate(() => window.voiceClicked), true);
  // Same input event used by the gamepad adapter must update both Vue and YouTube.
  await input.evaluate(node => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, 'Gamepad');
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  });
  assert.equal(await page.locator('#search').inputValue(), 'Gamepad');
  await input.focus();
  mkdirSync('output/search-bar', { recursive: true });
  await host.screenshot({ path: 'output/search-bar/desktop.png' });
  await page.setViewportSize({ width: 390, height: 720 });
  await page.locator('#center').evaluate(node => node.style.width = '100%');
  assert.ok(await host.evaluate(node => node.scrollWidth <= innerWidth));
  await host.screenshot({ path: 'output/search-bar/mobile.png' });
  await page.evaluate(() => {
    document.querySelector('#search').value = 'new route';
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  assert.equal(await input.inputValue(), 'new route');
  await page.evaluate(() => window.YTGamepadMenu.openSearch());
  const keyboardQuery = page.locator('#yt-gamepad-menu').locator('#query');
  await keyboardQuery.waitFor();
  assert.equal(await keyboardQuery.inputValue(), 'new route');
  await keyboardQuery.fill('from gamepad keyboard');
  assert.equal(await input.inputValue(), 'from gamepad keyboard');
  await keyboardQuery.press('Enter');
  assert.equal(await page.evaluate(() => window.submissions.at(-1)), 'from gamepad keyboard');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'hidden' });
  await page.evaluate(() => document.documentElement.classList.add('ytg-gamepad-input'));
  const entry = host.locator('[data-ytg-search-entry]');
  await entry.waitFor();
  assert.equal(await input.isVisible(), false);
  assert.equal(await host.locator('button:visible,input:visible').count(), 1);
  assert.equal(await entry.locator('.ytg-search-key').textContent(), 'Y');
  await entry.focus();
  await page.evaluate(() => window.YTGamepad.act('confirm'));
  await keyboardQuery.waitFor();
  assert.equal(await keyboardQuery.inputValue(), 'from gamepad keyboard');
  await page.evaluate(() => window.YTGamepadMenu.close());
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-ytg-search-entry'));
  await page.evaluate(() => { window.__searchPad.buttons[3].pressed = true; });
  await keyboardQuery.waitFor();
  await page.evaluate(() => { window.__searchPad.buttons[3].pressed = false; });
  await page.evaluate(() => window.YTGamepadMenu.close());
  await page.evaluate(() => {
    window.YTGamepadControllerStyle.use({ id: 'DualSense' });
    window.YTGamepadControllerStyle.configureBindings({ search: 2, playPause: 3 });
  });
  assert.equal(await entry.locator('.ytg-search-key').textContent(), '□');
  await page.evaluate(() => document.documentElement.classList.remove('ytg-gamepad-input'));
  await input.waitFor();
  await page.evaluate(() => window.YTGamepadRuntime.destroy());
  assert.equal(await host.count(), 0);
  assert.equal(await page.locator('#search').isVisible(), true);
});
