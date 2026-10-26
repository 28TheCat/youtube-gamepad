import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';
import { accountData } from './helpers/account-data.mjs';

test('manifest account bridge loads API avatars and identities under CSP without native account DOM', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addCookies([{ name: 'SAPISID', value: 'account-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} },
      LOGGED_IN: true, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand' })[key] };
    Object.defineProperty(window, 'ytInitialData', { get() { throw Error('Page data read'); } });
  });
  const calls = [];
  await context.route('https://yt3.ggpht.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"/>' }));
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/youtubei/v1/account/accounts_list') {
      calls.push({ body: request.postDataJSON(), headers: await request.allHeaders() });
      return route.fulfill({ json: accountData() });
    }
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [] } });
    return route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src https:"
    }, body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/');
  const button = page.locator('.client-account');
  await button.locator('img').waitFor();
  assert.equal(await button.getAttribute('title'), 'Example Creator');
  await button.click();
  await page.locator('.account-list-item').first().waitFor();
  assert.equal(await page.locator('.account-list-item').count(), 2);
  assert.equal(await page.locator('#avatar-btn,ytd-popup-container').count(), 0);
  assert.equal(calls[0].headers['x-goog-authuser'], '2');
  assert.equal(calls[0].headers['x-goog-pageid'], 'brand');
  assert.match(calls[0].headers.authorization, /^SAPISIDHASH /);
  assert.match(calls[0].headers.cookie, /SAPISID=account-fixture/);
  assert.equal(await page.locator('#ytg-account-page').evaluate(node => node.textContent.includes('never-cross-the-bridge')), false);
  await page.locator('[data-account-close]').click();
  await page.locator('#ytg-sidebar-settings').click();
  await page.locator('[data-setting="display"]').click();
  await page.locator('[data-setting="playback-wide"]').click();
  await page.waitForFunction(() => document.querySelector('#yt-gamepad-menu')?.shadowRoot?.querySelector('[data-setting="playback-wide"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('playbackLayout')).playbackLayout), 'wide');
  assert.equal(await page.evaluate(() => 'ui' in window), false);
  assert.deepEqual(errors, []);
});
