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

test('settings categories preserve deep links, keyboard navigation and saved preferences', { timeout: 60000 }, async t => {
  const { options } = await launchExtension(t);
  assert.equal(await options.locator('#general').isVisible(), true);
  assert.equal(await options.locator('#diagnostics').isVisible(), false);
  await options.locator('[data-category-link="display"]').click();
  assert.equal(await options.locator('#display').isVisible(), true);
  assert.equal(await options.locator('#general').isVisible(), false);
  await options.locator('#theater').uncheck();
  await options.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  await options.locator('[data-category-link="controller"]').click();
  assert.equal(await options.locator('#shortcuts').isVisible(), true);
  assert.equal(await options.locator('#gamepad').isVisible(), true);
  await options.reload();
  assert.equal(await options.locator('#shortcuts').isVisible(), true);
  await options.goBack();
  assert.equal(await options.locator('#display').isVisible(), true);
  assert.equal(await options.locator('#theater').isChecked(), false);
  await options.locator('[data-category-link="display"]').focus();
  await options.keyboard.press('ArrowDown');
  assert.equal(await options.locator('[data-category-link="controller"]').evaluate(node => node === document.activeElement), true);
  await options.keyboard.press('Enter');
  await options.locator('#shortcuts').waitFor();
  await options.screenshot({ path: 'output/playwright/settings-controller.png', fullPage: true });
  await options.locator('[data-category-link="help"]').click();
  assert.equal(await options.locator('#connectionHelp').isVisible(), true);
  assert.equal(await options.locator('#diagnostics').isVisible(), true);
  await options.setViewportSize({ width: 390, height: 844 });
  await options.screenshot({ path: 'output/playwright/settings-mobile.png', fullPage: true });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await options.goto(options.url().split('#')[0] + '#gamepad');
  assert.equal(await options.locator('#gamepad').isVisible(), true);
  assert.equal(await options.locator('[data-category-link="controller"]').getAttribute('aria-current'), 'page');
});

test('manifest worlds propagate real settings, persist across refresh and open options via worker', { timeout: 60000 }, async t => {
  const { context, options, page, id } = await setup(t);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled === false);
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled === false);
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  await options.locator('#enabled').check();
  assert.equal(await page.evaluate(() => window.YTGamepadCoordinator.state.enabled), false);
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
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

test('custom controller shortcuts cross extension worlds and survive reload', { timeout: 60000 }, async t => {
  const { context, options, page } = await setup(t);
  await options.locator('[data-category-link="controller"]').click();
  await options.locator('#binding-search').selectOption('8');
  await page.waitForFunction(() => window.YTGamepadControllerStyle.format('Y') === 'Select');
  await options.reload();
  await options.waitForFunction(() => !document.querySelector('#binding-search').disabled);
  assert.equal(await options.locator('#binding-search').inputValue(), '8');
  await page.reload(); await ready(page);
  await page.waitForFunction(() => window.YTGamepadControllerStyle.format('Y') === 'Select');
  const pad = await virtualPad(context, page);
  await page.bringToFront();
  await pad({ connected: true });
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await pad({ connected: true, button: 8 });
  await page.waitForFunction(() => window.YTGamepadMenu.opened && window.YTGamepadMenu.state.view === 'search');
  await options.locator('#resetBindings').click();
  await page.waitForFunction(() => window.YTGamepadControllerStyle.format('Y') === 'Y');
});

test('quick menu edits settings inline with physical icons and hierarchical gamepad back', { timeout: 60000 }, async t => {
  const { context, page, worker } = await setup(t);
  const pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true });
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  const pages = context.pages().length;
  const menu = page.locator('#yt-gamepad-menu');
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await menu.getByRole('button', { name: 'All settings', exact: true }).click();
  await menu.getByRole('button', { name: 'Display & layout', exact: true }).click();
  await menu.locator('[data-setting="theater"]').click();
  await menu.locator('[data-setting="theater"][aria-pressed="false"]').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('theater')).theater), false);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.getByRole('button', { name: 'Gamepad & buttons', exact: true }).click();
  await menu.locator('[data-setting="confirm"]').click();
  await menu.locator('[data-setting="1"]').click();
  await menu.locator('[data-setting="1"][aria-pressed="true"]:not(:disabled)').waitFor();
  assert.deepEqual(await worker.evaluate(async () => {
    const saved = await chrome.storage.local.get(['bindings', 'bindingLayouts']);
    const bindings = saved.bindingLayouts?.browse || saved.bindings;
    return [bindings.confirm, bindings.back];
  }), [1, 0]);
  const icon = menu.locator('[data-setting="1"] [data-inline-key]');
  assert.equal(await icon.getAttribute('data-ytg-first-key'), 'B');
  assert.match(await icon.evaluate(node => getComputedStyle(node).backgroundImage), /data:image\/svg\+xml;base64/);
  await page.screenshot({ path: 'output/playwright/inline-settings-buttons.png' });
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.locator('[data-setting="resetBindings"]').click();
  await page.waitForFunction(() => window.YTGamepadControllerStyle.format('A') === 'A');
  await menu.locator('[data-setting="repeatDelay-+"]').click();
  await menu.locator('[data-setting="repeatDelay-+"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('repeatDelay')).repeatDelay), 360);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.getByRole('button', { name: 'Help & diagnostics', exact: true }).click();
  await menu.locator('[data-setting="clearDiagnostics"]').click();
  await menu.locator('#message').filter({ hasText: 'Diagnostic records cleared' }).waitFor();
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await page.screenshot({ path: 'output/playwright/inline-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/inline-settings-mobile.png' });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.getByRole('button', { name: 'All settings', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.YTGamepadMenu.opened), true);
  assert.equal(context.pages().length, pages, 'settings do not open a new tab');
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  assert.equal(await page.evaluate(() => window.YTGamepadMenu.opened), false);
  await page.reload(); await ready(page);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('repeatDelay')).repeatDelay), 360);
});

test('virtual controller traverses both worlds: fullscreen, hidden tab, disconnect and reconnect', { timeout: 60000 }, async t => {
  const { context, options, page, worker } = await setup(t);
  await options.locator('[data-category-link="display"]').click();
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
  await options.locator('[data-category-link="general"]').click();
  await options.locator('#enabled').uncheck();
  await waitUntil(async () => (await windowState()) === 'normal');
});

test('trusted Escape exits browser fullscreen without navigating or disconnecting the controller', { timeout: 60000 }, async t => {
  const { context, options, page, worker } = await setup(t);
  await options.locator('[data-category-link="display"]').click();
  await options.locator('#autoFullscreen').check();
  await page.bringToFront();
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
  const windowState = () => worker.evaluate(async () => (await chrome.windows.getAll())[0].state);
  await waitUntil(async () => (await windowState()) === 'fullscreen');
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  await page.evaluate(() => window.YTGamepadMenu.openSearch());
  const url = page.url();
  await page.keyboard.press('Escape');
  await waitUntil(async () => (await windowState()) === 'normal');
  assert.equal(page.url(), url);
  assert.equal(await page.evaluate(() => window.YTGamepadInput.connected), true);
  assert.equal(await page.evaluate(() => window.YTGamepadMenu.opened), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.YTGamepadMenu.opened);
  await page.reload(); await ready(page);
  await pad({ connected: true });
  await page.waitForTimeout(700);
  assert.equal(await windowState(), 'normal');
});

test('stopped MV3 worker wakes through bridge and restores session-owned fullscreen', { timeout: 60000 }, async t => {
  const { context, page, options, id } = await setup(t);
  await options.locator('[data-category-link="display"]').click();
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
