import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, virtualPad } from './helpers/extension.mjs';

test('search retains controller prompts across echoed keys, jitter, page focus and reload while deliberate keyboard and mouse input take over', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage(); await page.goto('https://www.youtube.com/');
  const menu = page.locator('#yt-gamepad-menu'); await menu.waitFor({ state: 'attached' });
  let pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true }); await page.waitForTimeout(120);
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  const press = async button => {
    await pad({ connected: true }); await page.waitForTimeout(80);
    await pad({ connected: true, button }); await page.waitForTimeout(65); await pad({ connected: true });
  };
  await press(9); await press(0); await menu.locator('[data-vue-search]').waitFor(); await page.waitForTimeout(80);
  const input = menu.locator('#query');
  await press(0);
  assert.equal(await input.inputValue(), 'A');
  await page.keyboard.press('Enter');
  assert.equal(await input.inputValue(), 'A', 'a matching keyboard echo cannot type the selected letter twice');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'gamepad');
  await page.mouse.move(300, 300);
  // A new physical pointer position deliberately takes over; then return to controller input.
  await page.waitForTimeout(80); await press(15); await page.waitForTimeout(80);
  await page.mouse.move(304, 300);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'gamepad');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('yt-navigate-start'));
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'gamepad');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await menu.waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'gamepad', 'same-tab reload preserves the prompt owner');
  pad = await virtualPad(context, page); await pad({ connected: true }); await page.waitForTimeout(120);
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await press(9); await press(0); await menu.locator('[data-vue-search]').waitFor();
  await input.focus(); await page.keyboard.type('hello');
  assert.match(await input.inputValue(), /hello/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'keyboard');
  await page.mouse.wheel(0, 1);
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'mouse');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'keyboard');
  await menu.locator('#query').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'mouse');
});
