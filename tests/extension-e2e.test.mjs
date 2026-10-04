import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, ready, virtualPad } from './helpers/extension.mjs';

async function setup(t) {
  const env = await launchExtension(t);
  await env.context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await env.context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught extension/page errors'));
  await page.goto('https://www.youtube.com/');
  await ready(page);
  return { ...env, page };
}

test('manifest worlds propagate real settings, persist across refresh and open options via worker', { timeout: 60000 }, async t => {
  const { context, options, page, id } = await setup(t);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled === false);
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled === false);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  await options.locator('#enabled').check();
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled === true);
  await page.bringToFront();
  // MAIN -> postMessage -> ISOLATED -> runtime -> background -> options UI.
  await options.close();
  const opened = context.waitForEvent('page');
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-open-settings' }, location.origin));
  const settings = await opened;
  await settings.waitForURL(`chrome-extension://${id}/options.html`);
  await settings.waitForFunction(() => !document.querySelector('fieldset').disabled);
});

test('virtual controller traverses both worlds: fullscreen, hidden tab, disconnect and reconnect', { timeout: 60000 }, async t => {
  const { context, options, page, worker } = await setup(t);
  await options.locator('#autoFullscreen').check();
  await page.bringToFront();
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  const windowState = () => worker.evaluate(async () => (await chrome.windows.getAll())[0].state);
  await waitUntil(async () => (await windowState()) === 'fullscreen');
  await pad({ connected: true, button: 15 });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  const other = await context.newPage();
  await other.goto('https://www.youtube.com/results?search_query=test');
  await ready(other);
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  const selected = await page.evaluate(() => window.YTGamepad.current?.getAttribute('href'));
  await page.waitForTimeout(600); // exceeds repeat delay: a held input must stay stopped
  assert.equal(await page.evaluate(() => window.YTGamepad.current?.getAttribute('href')), selected);
  assert.equal(await page.evaluate(() => window.YTGamepadInput.mode), 'mouse');
  await pad({ connected: true });
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden && document.hasFocus());
  await page.waitForTimeout(100); // allow neutral input to be sampled
  await pad({ connected: true, button: 14 });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  await pad({ connected: false });
  await page.waitForFunction(() => !window.YTGamepadInput.connected && window.YTGamepadInput.mode === 'mouse');
  await waitUntil(async () => (await windowState()) === 'normal');
  await pad({ connected: true });
  await waitUntil(async () => (await windowState()) === 'fullscreen');
  await options.locator('#enabled').uncheck();
  await waitUntil(async () => (await windowState()) === 'normal');
});

test('stopped MV3 worker wakes through bridge and restores session-owned fullscreen', { timeout: 60000 }, async t => {
  const { context, page, options, id } = await setup(t);
  await options.locator('#autoFullscreen').check();
  await page.bringToFront();
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
  const state = () => options.evaluate(async () => ({
    records: (await chrome.storage.session.get('ytg-fullscreen-windows'))['ytg-fullscreen-windows'],
    window: (await chrome.windows.getAll())[0].state
  }));
  await waitUntil(async () => (await state()).window === 'fullscreen');
  const before = (await state()).records;
  assert.equal(Object.keys(before).length, 1);
  const cdp = await context.newCDPSession(page);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => updates.forEach(v => versions.set(v.versionId, v)));
  await cdp.send('ServiceWorker.enable');
  await waitUntil(() => [...versions.values()].some(v => v.scriptURL === `chrome-extension://${id}/background.js` && v.runningStatus === 'running'));
  const version = [...versions.values()].find(v => v.scriptURL === `chrome-extension://${id}/background.js` && v.runningStatus === 'running');
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await waitUntil(() => versions.get(version.versionId)?.runningStatus === 'stopped');
  assert.deepEqual((await state()).records, before, 'session state survives actual worker stop');
  await pad({ connected: false }); // real ISOLATED polling sends runtime message and wakes worker
  await waitUntil(async () => (await state()).window === 'normal');
  assert.deepEqual((await state()).records, {});
  await waitUntil(() => [...versions.values()].some(v => v.scriptURL === version.scriptURL && v.runningStatus === 'running'));
});

async function waitUntil(predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Extension state did not converge within 15 seconds');
}
