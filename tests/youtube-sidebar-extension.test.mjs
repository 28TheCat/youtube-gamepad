import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';
import { guideData } from './helpers/sidebar-data.mjs';

test('manifest sidebar uses guide API data under CSP and ignores native guide links', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addCookies([{ name: 'SAPISID', value: 'sidebar-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} },
      LOGGED_IN: true, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand' })[key] };
    Object.defineProperty(window, 'ytInitialData', { get() { throw Error('Page data read'); } });
    window.addEventListener('DOMContentLoaded', () => {
      document.querySelector('ytd-app').navigate_ = endpoint => {
        window.sidebarEndpoint = endpoint;
        history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
        document.dispatchEvent(new Event('yt-navigate-finish'));
      };
      document.querySelector('ytd-guide-renderer').addEventListener('click', () => { window.nativeGuideClicked = true; });
    });
  });
  const calls = []; let failing = false;
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/youtubei/v1/guide') {
      calls.push({ body: request.postDataJSON(), headers: await request.allHeaders() });
      if (failing) return route.fulfill({ status: 400, json: { error: { code: 400 } } });
      return route.fulfill({ json: guideData() });
    }
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [] } });
    return route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src https:"
    }, body: '<html><body><ytd-app></ytd-app><ytd-page-manager></ytd-page-manager><ytd-guide-renderer><ytd-guide-section-renderer><h3 id="guide-section-title">Explore</h3><a href="/feed/evil">DOM-only entry</a></ytd-guide-section-renderer><a href="/feed/subscriptions">Native subscription</a></ytd-guide-renderer></body></html>' });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/');
  const sidebar = page.locator('#ytg-browse-sidebar');
  await sidebar.locator('[data-sidebar-id="videos"][href="https://studio.youtube.com/channel/UCcreator/videos"]').waitFor();
  await page.locator('#ytg-sidebar-explore').click();
  assert.deepEqual(await sidebar.locator('#ytg-sidebar-explore-links a span').allTextContents(), ['Musique régionale', 'Games']);
  assert.equal(await sidebar.getByText('DOM-only entry').count(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-goog-authuser'], '2');
  assert.equal(calls[0].headers['x-goog-pageid'], 'brand');
  assert.match(calls[0].headers.authorization, /^SAPISIDHASH /);
  await sidebar.locator('[data-sidebar-id="subscriptions"]').click();
  assert.equal(new URL(page.url()).pathname, '/feed/subscriptions');
  assert.equal(await page.evaluate(() => window.sidebarEndpoint.browseEndpoint.browseId), 'FEsubscriptions');
  assert.equal(await page.evaluate(() => !!window.nativeGuideClicked), false);
  assert.equal(calls.length, 1, 'SPA navigation reuses the cached guide');
  failing = true;
  await page.evaluate(() => {
    const previous = window.ytcfg.get;
    window.ytcfg.get = key => key === 'SESSION_INDEX' ? 3 : previous(key);
    window.dispatchEvent(new Event('focus'));
  });
  await sidebar.locator('[data-sidebar-id="videos"][href="https://studio.youtube.com/"]').waitFor();
  assert.equal(await sidebar.getByText('DOM-only entry').count(), 0);
  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sidebar.locator('[data-sidebar-id="videos"][href="https://studio.youtube.com/channel/UCcreator/videos"]').waitFor();
  assert.equal(calls.length, 3, 'an explicit reload recovers from an API failure');
  assert.deepEqual(errors, []);
});
