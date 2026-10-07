import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, ready } from './helpers/extension.mjs';

async function observeSettings(page) {
  await page.addInitScript(() => {
    window.liveSettings = null;
    window.addEventListener('message', event => {
      if (event.source === window && event.origin === location.origin && event.data?.source === 'yt-gamepad-settings') {
        window.liveSettings = event.data.values;
      }
    });
  });
}

test('live YouTube retains storage bridge after refresh and stays inactive without a controller', { timeout: 90000 }, async t => {
  const { context, options } = await launchExtension(t);
  const page = await context.newPage();
  // No routing, fixture, addScriptTag or virtual controller in live smoke.
  // Observe the real storage bridge on every document, including after refresh.
  await observeSettings(page);
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('ytd-app').waitFor({ timeout: 20000 });
  await ready(page);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  assert.equal(await page.evaluate(() => window.YTGamepadInput.connected), false);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => window.liveSettings?.enabled === false);
  await page.waitForFunction(() => !window.YTGamepadCoordinator.state.enabled);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => window.liveSettings?.enabled === false);
  await page.waitForFunction(() => !window.YTGamepadCoordinator.state.enabled);
  await options.locator('#enabled').check();
  await page.waitForFunction(() => window.liveSettings?.enabled === true);
  assert.deepEqual(await page.evaluate(() => ({
    connected: window.YTGamepadInput.connected,
    enabled: window.YTGamepadCoordinator.state.enabled
  })), { connected: false, enabled: false });
  await page.screenshot({ path: 'output/playwright/youtube-live.png', fullPage: true });
});
