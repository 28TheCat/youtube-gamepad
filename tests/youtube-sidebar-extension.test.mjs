import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';
import { guideData } from './helpers/sidebar-data.mjs';
import { mkdirSync } from 'node:fs';

test('manifest sidebar uses guide API data under CSP and ignores native guide links', { timeout: 90000 }, async t => {
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
        document.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState({}, '', endpoint.commandMetadata.webCommandMetadata.url);
        document.dispatchEvent(new Event('yt-navigate-finish'));
      };
      document.querySelector('ytd-guide-renderer').addEventListener('click', () => { window.nativeGuideClicked = true; });
    });
  });
  const calls = []; let failing = false, emptyGuide = false;
  function subscriptionGuide(account) {
    if (emptyGuide) return { items: [] };
    const data = guideData(), items = data.items[3].guideSubscriptionsSectionRenderer.items;
    const personal = data.items[1].guideSectionRenderer.items[0].guideCollapsibleSectionEntryRenderer;
    const playlist = { guideEntryRenderer: { formattedTitle: { simpleText: account === '3' ? 'Account 3 playlist' : 'Account playlist' },
      navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: `/playlist?list=PLaccount${account}` } } } } };
    if (account === '3') personal.sectionItems = [playlist];
    else personal.sectionItems.push({ guideCollapsibleEntryRenderer: {
      expanderItem: { guideEntryRenderer: { formattedTitle: { simpleText: 'More playlists' } } }, expandableItems: [playlist]
    } });
    const entry = items[0].guideEntryRenderer;
    entry.navigationEndpoint.browseEndpoint.browseId = 'UCnew';
    entry.navigationEndpoint.commandMetadata.webCommandMetadata.url = '/channel/UCnew';
    entry.badges = { liveBroadcasting: false };
    entry.presentationStyle = 'GUIDE_ENTRY_PRESENTATION_STYLE_NEW_CONTENT';
    const live = structuredClone(items[0]);
    live.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId = 'UClive';
    live.guideEntryRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url = '/channel/UClive';
    live.guideEntryRenderer.formattedTitle.simpleText = 'Live creator';
    live.guideEntryRenderer.badges = [{ liveBroadcasting: true, newContent: true }];
    items.push(live);
    return data;
  }
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/youtubei/v1/guide') {
      calls.push({ body: request.postDataJSON(), headers: await request.allHeaders() });
      if (failing) return route.fulfill({ status: 400, json: { error: { code: 400 } } });
      return route.fulfill({ json: subscriptionGuide(calls.at(-1).headers['x-goog-authuser']) });
    }
    if (path.endsWith('/resolve_url')) return route.fulfill({ json: { endpoint: { browseEndpoint: { browseId: 'UCnew' } } } });
    if (path.endsWith('/browse') && request.postDataJSON().browseId === 'UCnew') return route.fulfill({ json: {
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { title: 'Videos', selected: true,
        endpoint: { browseEndpoint: { browseId: 'UCnew' } }, content: { richGridRenderer: { contents: [
          { videoRenderer: { videoId: 'channel1234', title: { simpleText: 'Channel video' } } }
        ] } } } }] } }
    } });
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [{ videoRenderer: {
      videoId: 'sidebar1234', title: { simpleText: 'Fixture video' }
    } }] } });
    return route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src https:"
    }, body: '<html><body><ytd-app></ytd-app><ytd-page-manager></ytd-page-manager><ytd-guide-renderer><ytd-guide-section-renderer><h3 id="guide-section-title">Explore</h3><a href="/feed/evil">DOM-only entry</a></ytd-guide-section-renderer><a href="/feed/subscriptions">Native subscription</a></ytd-guide-renderer></body></html>' });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/');
  const sidebar = page.locator('#ytg-browse-sidebar');
  await sidebar.locator('[data-sidebar-id="videos"][href="https://studio.youtube.com/channel/UCcreator/videos"]').waitFor();
  assert.equal(await sidebar.locator('[data-sidebar-id="subscriptions"]').getAttribute('aria-label'), 'Subscribed channels');
  assert.deepEqual(await sidebar.locator('[data-sidebar-section="section:1"] a > span').allTextContents(), ['You', 'History', 'Your videos', 'Account playlist']);
  assert.equal(await sidebar.locator('[href="/playlist?list=WL"]').count(), 0, 'absent account links are not invented');
  const more = sidebar.getByRole('button', { name: 'More playlists', exact: true });
  const playlist = sidebar.getByRole('link', { name: 'Account playlist', exact: true, includeHidden: true });
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  assert.equal(await playlist.isVisible(), false);
  await more.click(); await playlist.waitFor({ state: 'visible' });
  await more.click(); await playlist.waitFor({ state: 'hidden' });
  assert.equal(await sidebar.locator(`[id="${await more.getAttribute('aria-controls')}"]`).evaluate(node => node.inert), true);
  assert.equal(await sidebar.locator('[data-sidebar-section="subscriptions"] [data-sidebar-id^="subscription:"]').count(), 2);
  const subscriptionToggle = sidebar.locator('#ytg-sidebar-subscription-channels');
  const subscriptionLinks = sidebar.locator('#ytg-sidebar-subscription-channels-links');
  assert.equal(await subscriptionToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await subscriptionLinks.evaluate(node => node.inert), true);
  await subscriptionToggle.click();
  await subscriptionLinks.locator('[data-sidebar-id="subscription:UCnew"]').waitFor({ state: 'visible' });
  assert.equal(await subscriptionToggle.getAttribute('aria-expanded'), 'true');
  await subscriptionToggle.click();
  await subscriptionLinks.waitFor({ state: 'hidden' });
  assert.equal(await subscriptionLinks.evaluate(node => node.inert), true);
  assert.equal(await page.locator('#ytg-subscription-channels').count(), 0);
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/account-sidebar.png' });
  assert.deepEqual(await sidebar.locator('[data-sidebar-section="section:2"] a > span').allTextContents(), ['Musique régionale', 'Games']);
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
  assert.equal(await subscriptionToggle.getAttribute('aria-expanded'), 'false', 'route updates retain the collapsed state');
  const channels = page.locator('#ytg-subscription-channels');
  await channels.waitFor();
  assert.equal(await channels.locator('button[aria-expanded]').count(), 0);
  const updated = channels.locator('[data-subscription-id="UCnew"]');
  await updated.waitFor({ state: 'visible' });
  const live = channels.locator('[data-subscription-id="UClive"]');
  assert.match(await updated.getAttribute('aria-label'), /New content/);
  assert.equal(await updated.locator('[data-icon="material:new-content-fill"] path').count() > 0, true);
  const dot = updated.locator('.subscription-channel-new');
  assert.deepEqual(await dot.evaluate(node => ({ color: getComputedStyle(node).color, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
    { color: 'rgb(6, 95, 212)', width: 6, height: 6 });
  assert.match(await live.getAttribute('aria-label'), /Live/);
  assert.equal(await live.locator('[data-icon="material:live-line"] path').count() > 0, true);
  assert.equal(await live.locator('.subscription-channel-new').count(), 0);
  assert.equal(await live.locator('.subscription-channel-live').isVisible(), true);
  const bounds = await page.evaluate(() => {
    const root = document.querySelector('#ytg-browse-root').shadowRoot;
    const rail = root.querySelector('#ytg-browse-sidebar').getBoundingClientRect();
    const list = root.querySelector('#ytg-subscription-channels').getBoundingClientRect();
    const feed = root.querySelector('[data-ytg-browse-grid]').getBoundingClientRect();
    return { separate: list.left >= rail.right - 1, beside: feed.left >= list.right - 1 };
  });
  assert.deepEqual(bounds, { separate: true, beside: true });
  await updated.click();
  await page.waitForURL('**/channel/UCnew/videos');
  await page.waitForFunction(() => document.querySelector('#ytg-browse-root').shadowRoot
    .querySelector('[data-subscription-id="UCnew"]')?.getAttribute('aria-current') === 'page', null, { timeout: 5000 }).catch(async error => {
      t.diagnostic(JSON.stringify(await page.evaluate(() => {
        const root = document.querySelector('#ytg-browse-root').shadowRoot;
        return { url: location.href, status: root.querySelector('[data-ytg-shell-status]')?.textContent,
          channels: root.querySelector('#ytg-subscription-channels')?.outerHTML };
      })));
      t.diagnostic(JSON.stringify(errors)); throw error;
    });
  assert.equal(await channels.isVisible(), true);
  await channels.locator('[data-subscription-id="all"]').click();
  await page.waitForURL('**/feed/subscriptions');
  assert.equal(await updated.isVisible(), true);

  failing = true;
  await page.evaluate(() => {
    const previous = window.ytcfg.get;
    window.ytcfg.get = key => key === 'SESSION_INDEX' ? 3 : previous(key);
    window.dispatchEvent(new Event('focus'));
  });
  await sidebar.locator('[data-sidebar-id="videos"]').waitFor({ state: 'detached' });
  await sidebar.locator('[data-sidebar-section="primary"] [data-sidebar-id="home"]').waitFor();
  assert.deepEqual(await sidebar.locator('[data-sidebar-section="primary"] a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))),
    ['/', '/feed/subscriptions']);
  assert.equal(await sidebar.locator('[data-sidebar-id="history"]').count(), 0);
  assert.equal(await sidebar.getByText('DOM-only entry').count(), 0);
  failing = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sidebar.getByRole('link', { name: 'Account 3 playlist', exact: true }).waitFor();
  assert.equal(await sidebar.getByText('Account playlist', { exact: true }).count(), 0);
  assert.equal(await sidebar.locator('[data-sidebar-id="videos"]').count(), 0);
  assert.equal(calls.length, 3, 'an explicit reload recovers from an API failure');
  emptyGuide = true;
  await page.evaluate(() => {
    const previous = window.ytcfg.get;
    window.ytcfg.get = key => key === 'SESSION_INDEX' ? 4 : previous(key);
    window.dispatchEvent(new Event('focus'));
  });
  await sidebar.getByRole('link', { name: 'Account 3 playlist', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await sidebar.locator('[data-sidebar-section]').count(), 0, 'a valid empty guide does not use fallback links');
  assert.equal(await sidebar.locator('#ytg-sidebar-settings').isVisible(), true);
  assert.deepEqual(errors, []);
});
