import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, fixture, ready, virtualPad } from './helpers/extension.mjs';

test('isolated application reads MAIN-only metadata and follows MAIN history without accepting page settings', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false }));
  const body = fixture.replace('</body>', `<div id="movie_player"><video class="html5-main-video"></video></div>
    <script>
      const player = document.querySelector('#movie_player');
      player.details = { videoId:'a', title:'MAIN private title A', author:'Private channel', isLive:false };
      player.getPlayerResponse = () => ({videoDetails:player.details});
      player.showControls = () => { player.dataset.controls = 'shown'; };
      player.hideControls = () => { player.dataset.controls = 'hidden'; };
      Object.defineProperty(document.querySelector('video'), 'duration', {value:100});
    </script></body>`);
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=a');
  await ready(page);
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'ready');
  await page.locator('#ytg-watch').getByRole('heading', { name: 'MAIN private title A', includeHidden: true }).waitFor({state:'attached'});
  const cdp = await context.newCDPSession(page);
  const worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await cdp.send('Runtime.enable');
  let isolated;
  for (const world of worlds.filter(world => !world.auxData?.isDefault)) {
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id,
      expression: 'typeof chrome !== "undefined" && !!chrome.runtime?.id' });
    if (result.result.value) { isolated = world; break; }
  }
  assert.ok(isolated, 'application runs in an actual extension isolated world');
  const evaluate = async expression => {
    const result = await cdp.send('Runtime.evaluate', { contextId: isolated.id, expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  assert.equal(await evaluate("typeof document.querySelector('#movie_player').getPlayerResponse"), 'undefined');
  assert.equal(await evaluate("Boolean(window[Symbol.for('yt-gamepad.main.dispose')])"), true);
  assert.equal(await page.evaluate(() => Boolean(window[Symbol.for('yt-gamepad.main.dispose')])), false);
  await page.evaluate(() => {
    window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin);
    window.postMessage({ source: 'yt-gamepad-open-settings' }, location.origin);
    document.dispatchEvent(new CustomEvent('ytg-page-request-v1', {detail: JSON.stringify({version:1,id:'forged',operation:'chrome.storage.local.set',values:{enabled:false}})}));
  });
  await page.waitForTimeout(100);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('enabled')).enabled), true);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-theater')), true);
  assert.equal(await page.locator('#yt-gamepad-menu [data-setting="general"]').count(), 0);
  await page.evaluate(() => {
    document.querySelector('#movie_player').details = {videoId:'b',title:'MAIN private title B',author:'Private channel'};
    history.pushState({}, '', '/watch?v=b');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.locator('#ytg-watch').getByRole('heading', { name: 'MAIN private title B', includeHidden: true }).waitFor({state:'attached'});
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-ytg-boot'));
  assert.deepEqual(errors, []);
});

async function setup(t) {
  const env = await launchExtension(t);
  await env.context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await env.context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught extension/page errors'));
  await page.goto('https://www.youtube.com/');
  await ready(page);
  assert.deepEqual(await page.evaluate(() => Object.keys(window).filter(name => name.startsWith('YTGamepad'))), [], 'production modules stay private');
  return { ...env, page };
}

test('bundled popup loads and persists its enable switch', { timeout: 60000 }, async t => {
  const { context, worker, id } = await launchExtension(t);
  const popup = await context.newPage();
  const errors = [];
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
  await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
  await popup.locator('#enabled').uncheck();
  await popup.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('enabled')).enabled), false);
  assert.deepEqual(errors, []);
});

test('settings categories preserve deep links, keyboard navigation and saved preferences', { timeout: 60000 }, async t => {
  const { options } = await launchExtension(t);
  assert.equal(await options.locator('#general').isVisible(), true);
  assert.equal(await options.locator('#diagnostics').isVisible(), false);
  await options.locator('[data-category-link="display"]').click();
  await options.locator('#display').waitFor();
  assert.equal(await options.locator('#display').isVisible(), true);
  assert.equal(await options.locator('#general').isVisible(), false);
  await options.locator('#theater').uncheck();
  await options.locator('#status').filter({ hasText: 'Saved' }).waitFor();
  await options.locator('[data-category-link="controller"]').click();
  await options.locator('#shortcuts').waitFor();
  assert.equal(await options.locator('#shortcuts').isVisible(), true);
  assert.equal(await options.locator('#gamepad').isVisible(), true);
  await options.reload();
  assert.equal(await options.locator('#shortcuts').isVisible(), true);
  await options.goBack();
  await options.locator('#display').waitFor();
  assert.equal(await options.locator('#display').isVisible(), true);
  assert.equal(await options.locator('#theater').isChecked(), false);
  await options.locator('[data-category-link="display"]').focus();
  await options.keyboard.press('ArrowDown');
  assert.equal(await options.locator('[data-category-link="controller"]').evaluate(node => node === document.activeElement), true);
  await options.keyboard.press('Enter');
  await options.locator('#shortcuts').waitFor();
  await options.screenshot({ path: 'output/playwright/settings-controller.png', fullPage: true });
  await options.locator('[data-category-link="help"]').click();
  await options.locator('#connectionHelp').waitFor();
  assert.equal(await options.locator('#connectionHelp').isVisible(), true);
  assert.equal(await options.locator('#diagnostics').isVisible(), true);
  await options.setViewportSize({ width: 390, height: 844 });
  await options.screenshot({ path: 'output/playwright/settings-mobile.png', fullPage: true });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await options.goto(options.url().split('#')[0] + '#gamepad');
  await options.locator('#gamepad').waitFor();
  assert.equal(await options.locator('#gamepad').isVisible(), true);
  assert.equal(await options.locator('[data-category-link="controller"]').getAttribute('aria-current'), 'page');
});

test('manifest worlds propagate real settings, persist across refresh and open inline settings through extension messages', { timeout: 60000 }, async t => {
  const { context, options, page, id } = await setup(t);
  await options.locator('#enabled').uncheck();
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'inactive');
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => document.documentElement.dataset.ytgAdaptation === 'inactive');
  assert.equal(await page.locator('#yt-gamepad-overlay').count(), 1);
  await options.locator('#enabled').check();
  assert.equal(await page.evaluate(() => (document.documentElement.dataset.ytgAdaptation === 'ready')), false);
  const pad = await virtualPad(context, page);
  await pad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await page.bringToFront();
  // A page message no longer opens extension pages. Use the trusted internal API.
  await options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'ytg-open-inline-settings' });
  });
  await page.locator('#yt-gamepad-menu [data-setting="general"]').waitFor();
});

test('custom controller shortcuts cross extension worlds and survive reload', { timeout: 60000 }, async t => {
  const { context, options, page } = await setup(t);
  await options.locator('[data-category-link="controller"]').click();
  await options.locator('[data-binding-layout="browse"]').click();
  await options.locator('#binding-search').selectOption('8');
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('[data-ytg-key="Y"]').textContent === 'Select');
  await options.reload();
  await options.locator('[data-binding-layout="browse"]').click();
  await options.waitForFunction(() => !document.querySelector('#binding-search').disabled);
  assert.equal(await options.locator('#binding-search').inputValue(), '8');
  await page.reload(); await ready(page);
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('[data-ytg-key="Y"]').textContent === 'Select');
  const pad = await virtualPad(context, page);
  await page.bringToFront();
  await pad({ connected: true });
  await page.waitForFunction(() => window.__testConnected);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await pad({ connected: true, button: 8 });
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-menu').hasAttribute('data-search'));
  await options.locator('#resetBindings').click();
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('[data-ytg-key="Y"]').textContent === 'Y');
});

test('quick menu edits settings inline with physical icons and hierarchical gamepad back', { timeout: 60000 }, async t => {
  const { context, page, worker } = await setup(t);
  const pad = await virtualPad(context, page);
  await page.bringToFront(); await pad({ connected: true });
  await page.waitForFunction(() => window.__testConnected);
  const pages = context.pages().length;
  const menu = page.locator('#yt-gamepad-menu');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'help' } })));
  await menu.getByRole('button', { name: 'All settings', exact: true }).click();
  await menu.getByRole('button', { name: 'Display & layout', exact: true }).click();
  await menu.locator('[data-setting="theater"]').click();
  await menu.locator('[data-setting="theater"][aria-pressed="false"]').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('theater')).theater), false);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
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
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
  await menu.locator('[data-setting="resetBindings"]').click();
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('[data-ytg-key="A"]').textContent === 'A');
  await menu.locator('[data-setting="repeatDelay-+"]').click();
  await menu.locator('[data-setting="repeatDelay-+"]:not(:disabled)').waitFor();
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('repeatDelay')).repeatDelay), 360);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
  await menu.getByRole('button', { name: 'Help & diagnostics', exact: true }).click();
  await menu.locator('[data-setting="clearDiagnostics"]').click();
  await menu.locator('#message').filter({ hasText: 'Diagnostic records cleared' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
  await page.screenshot({ path: 'output/playwright/inline-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/inline-settings-mobile.png' });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
  await menu.getByRole('button', { name: 'All settings', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (getComputedStyle(document.querySelector('#yt-gamepad-menu')).display !== 'none')), true);
  assert.equal(context.pages().length, pages, 'settings do not open a new tab');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } })));
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => (getComputedStyle(document.querySelector('#yt-gamepad-menu')).display !== 'none')), false);
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
  await page.waitForFunction(() => window.__testConnected);
  const windowState = () => worker.evaluate(async () => (await chrome.windows.getAll())[0].state);
  await waitUntil(async () => (await windowState()) === 'fullscreen');
  await pad({ connected: true, button: 15 });
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'gamepad');
  const other = await context.newPage();
  await other.goto('https://www.youtube.com/results?search_query=test');
  await ready(other);
  await other.bringToFront();
  await page.waitForFunction(() => document.hidden);
  const selected = await page.evaluate(() => document.querySelector('.ytg-selected a[href],a.ytg-selected[href]')?.getAttribute('href'));
  await page.waitForTimeout(600); // exceeds repeat delay: a held input must stay stopped
  assert.equal(await page.evaluate(() => document.querySelector('.ytg-selected a[href],a.ytg-selected[href]')?.getAttribute('href')), selected);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'mouse');
  await pad({ connected: true });
  await page.bringToFront();
  await page.waitForFunction(() => !document.hidden && document.hasFocus());
  await page.waitForTimeout(100); // allow neutral input to be sampled
  await pad({ connected: true, button: 14 });
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'gamepad');
  await pad({ connected: false });
  await page.waitForFunction(() => !window.__testConnected && document.documentElement.dataset.ytgInputMode === 'mouse');
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
  await page.waitForFunction(() => window.__testConnected);
  // Resume the input owner through a physical gamepad action after connection.
  await page.waitForTimeout(100);
  await pad({ connected: true, button: 15 });
  await page.waitForFunction(() => document.documentElement.dataset.ytgInputMode === 'gamepad');
  await pad({ connected: true });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'search' } })));
  const url = page.url();
  await page.keyboard.press('Escape');
  await waitUntil(async () => (await windowState()) === 'normal');
  assert.equal(page.url(), url);
  assert.equal(await page.evaluate(() => window.__testConnected), true);
  assert.equal(await page.evaluate(() => (getComputedStyle(document.querySelector('#yt-gamepad-menu')).display !== 'none')), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(getComputedStyle(document.querySelector('#yt-gamepad-menu')).display !== 'none'));
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
  await waitUntil(() => [...versions.values()].some(v => v.scriptURL === `chrome-extension://${id}/bundles/background.js` && v.runningStatus === 'running'));
  const version = [...versions.values()].find(v => v.scriptURL === `chrome-extension://${id}/bundles/background.js` && v.runningStatus === 'running');
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
