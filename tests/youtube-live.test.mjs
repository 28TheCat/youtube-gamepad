import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, ready } from './helpers/extension.mjs';

test('live YouTube loads actual manifest worlds and retains storage bridge after refresh', { timeout: 90000 }, async t => {
  const { context, options } = await launchExtension(t);
  const page = await context.newPage();
  // No routing, fixture, addScriptTag or virtual controller in live smoke.
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('ytd-app').waitFor({ timeout: 20000 });
  await ready(page);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => !window.YTGamepadCoordinator.state.enabled);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => !window.YTGamepadCoordinator.state.enabled);
  await options.locator('#enabled').check();
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled);
  await page.screenshot({ path: 'output/playwright/youtube-live.png', fullPage: true });
});
