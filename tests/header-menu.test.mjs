import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('compact header exposes refresh and persisted interface mode through the quick menu', { timeout: 45000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  let batches = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await page.route('https://www.youtube.com/**', async route => {
    if (new URL(route.request().url()).pathname === '/youtubei/v1/browse') {
      const batch = ++batches;
      if (batch === 3) await gate;
      return route.fulfill({ json: { contents: [{ videoRenderer: { videoId: `batch${batch}`, title: { simpleText: `Batch ${batch}` } } }] } });
    }
    if (route.request().url().includes('/youtubei/')) return route.fulfill({ json: {} });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app><ytd-masthead></ytd-masthead><ytd-page-manager><ytd-browse><p id="native-feed">Original feed</p></ytd-browse></ytd-page-manager></ytd-app></body></html>' });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' } } : undefined };
    const listeners = new Set(); window.__savedModes = [];
    window.chrome = { storage: { local: {
      get: async () => ({ browseMode: 'gamepad' }),
      set: async values => {
        if (window.__failModeSave) throw Error('Storage unavailable');
        window.__savedModes.push(values.browseMode);
        for (const listener of listeners) listener({ browseMode: { newValue: values.browseMode } }, 'local');
      }
    }, onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) } } };
    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__headerPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true, uiLanguage: 'en' } }, location.origin));
  await page.locator('[data-browse-id="video:batch1"]').waitFor();
  const top = page.locator('#ytg-browse-top'), entry = top.locator('.client-menu');
  const menu = page.locator('#yt-gamepad-menu');
  const mode = menu.locator('[data-ytg-page-mode]');
  const refresh = menu.locator('[data-menu-action="refreshHome"]');
  assert.equal(await top.locator('.client-refresh,[data-ytg-page-mode]').count(), 0);
  await top.locator('#ytg-client-search input').waitFor();
  await top.locator('.notification-entry').waitFor();
  await top.locator('.client-account').waitFor();
  mkdirSync('output/playwright', { recursive: true });
  await top.screenshot({ path: 'output/playwright/compact-header.png' });
  await entry.click();
  await mode.getByText('Switch to YouTube', { exact: true }).waitFor();
  assert.equal(await mode.getAttribute('aria-checked'), 'true');
  assert.equal(await refresh.isEnabled(), true);
  await mode.click();
  await page.waitForFunction(() => document.documentElement.dataset.ytgBrowseMode === 'youtube');
  assert.equal(await mode.getAttribute('aria-checked'), 'false');
  assert.equal(await refresh.count(), 0);
  await page.locator('#native-feed').waitFor();
  await mode.getByText('Switch to Gamepad', { exact: true }).waitFor();
  await mode.click();
  await page.waitForFunction(() => document.documentElement.dataset.ytgBrowseMode === 'gamepad');
  assert.deepEqual(await page.evaluate(() => window.__savedModes), ['youtube', 'gamepad']);
  await menu.getByRole('button', { name: 'Back', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate(node => node.getRootNode().activeElement === node), true);
  await entry.click(); await refresh.click();
  await page.locator('[data-browse-id="video:batch2"]').waitFor();
  await menu.waitFor({ state: 'hidden' });
  await entry.click(); await refresh.click();
  await page.locator('.home-loading-line').waitFor();
  await menu.waitFor({ state: 'hidden' });
  await entry.click();
  assert.equal(await refresh.isDisabled(), true);
  assert.equal(batches, 3);
  release();
  await page.locator('[data-browse-id="video:batch3"]').waitFor();
  await page.waitForFunction(() => !document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('[data-menu-action="refreshHome"]').disabled);
  await page.evaluate(() => { window.__failModeSave = true; });
  await mode.click();
  await menu.getByRole('status').getByText('Could not save page mode. Try again.', { exact: true }).waitFor();
  assert.equal(await mode.getAttribute('aria-checked'), 'true');
  assert.equal(await mode.isEnabled(), true);
  assert.equal(await mode.evaluate(node => node.getRootNode().activeElement === node), true);
  await page.screenshot({ path: 'output/playwright/compact-header-menu.png' });
  await menu.getByRole('button', { name: 'Back', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  const press = async button => {
    await page.evaluate(button => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('yt-gamepad-action', done); reject(Error('Gamepad input not sampled')); }, 5000);
      function done() { clearTimeout(timer); window.removeEventListener('yt-gamepad-action', done); window.__headerPad.buttons[button].pressed = false; resolve(); }
      window.addEventListener('yt-gamepad-action', done);
      window.__headerPad.buttons[button].pressed = true;
    }), button);
    await page.waitForTimeout(80);
  };
  await press(9);
  await menu.locator('[data-vue-quick-menu]').waitFor();
  await press(13);
  assert.equal(await menu.locator('[data-menu-action="playPause"]').evaluate(node => node.getRootNode().activeElement === node), true);
  await press(1);
  await menu.waitFor({ state: 'hidden' });
  assert.equal(await entry.evaluate(node => node.getRootNode().activeElement === node), true);
});
