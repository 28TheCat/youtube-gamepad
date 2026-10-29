import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launchExtension, virtualPad } from './helpers/extension.mjs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';

test('page mode keeps our banner while switching the feed, persists and can switch back', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><style>body{margin:0}ytd-page-manager{display:block;padding-top:var(--ytd-masthead-height,56px)}ytd-rich-item-renderer{display:block;padding:24px}</style></head><body><ytd-app><ytd-masthead><input id="search"><button id="search-icon-legacy">Search</button><div id="end"><button id="avatar-btn">Account</button></div></ytd-masthead>
    <ytd-page-manager><ytd-browse><div id="native-categories" style="position:fixed;top:56px;left:240px;right:0;height:32px">All · Music · Gaming</div><div id="native-banner">Original YouTube</div>
    <ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=one">One</a></ytd-rich-item-renderer>
    </ytd-browse></ytd-page-manager></ytd-app></body></html>` }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const pad = await virtualPad(context, page); await pad({ connected: true });
  const custom = page.locator('#ytg-browse-root');
  const native = page.locator('#native-banner');
  const grid = custom.locator('[data-ytg-browse-grid]');
  const top = custom.locator('#ytg-browse-top');
  await top.locator('[data-ytg-page-mode]').waitFor();
  assert.equal(await top.locator('[data-ytg-page-mode]').getAttribute('aria-checked'), 'true');
  const gamepadHeader = await top.boundingBox();
  const gamepadSearch = await top.locator('.ytg-search-form').boundingBox();
  const gamepadSwitch = await top.locator('[data-ytg-page-mode]').boundingBox();
  await top.evaluate(node => { window.__sharedBrowseHeader = node; });
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/topbar-mode-gamepad.png' });
  await page.evaluate(() => {
    window.__nativeSearches = []; window.__accountClicks = 0;
    document.querySelector('#search-icon-legacy').onclick = () => window.__nativeSearches.push(document.querySelector('ytd-masthead input').value);
    document.querySelector('#avatar-btn').onclick = () => ++window.__accountClicks;
  });
  await top.getByRole('switch').press('Space');
  await grid.waitFor({ state: 'hidden' });
  await native.waitFor(); await page.locator('#native-banner').waitFor();
  assert.equal(await top.isVisible(), true);
  assert.equal(await page.locator('ytd-masthead').isVisible(), false);
  assert.equal(await top.locator('#ytg-search-host').isVisible(), true);
  assert.equal(await top.locator('[data-ytg-page-mode]').count(), 1);
  assert.equal(await page.locator('#ytg-browse-sidebar').isVisible(), false);
  assert.equal(await native.evaluate(node => document.elementFromPoint(500, 300)?.getRootNode() === document), true, 'banner shell must not intercept native content');
  assert.equal(await native.evaluate(node => node.getBoundingClientRect().top >= 56), true);
  const headerBounds = await top.boundingBox();
  assert.deepEqual(headerBounds, gamepadHeader, 'both modes share the same header geometry');
  assert.deepEqual(await top.locator('.ytg-search-form').boundingBox(), gamepadSearch, 'search layout does not change between modes');
  assert.deepEqual(await top.locator('[data-ytg-page-mode]').boundingBox(), gamepadSwitch, 'switch layout does not change between modes');
  assert.equal(await top.evaluate(node => window.__sharedBrowseHeader === node), true, 'switching modes retains the same header element');
  const categoryBounds = await page.locator('#native-categories').boundingBox();
  assert.equal(headerBounds.height, 56, 'native mode uses the original YouTube header height');
  assert.ok(headerBounds.y + headerBounds.height <= categoryBounds.y, 'our banner does not cover native categories');
  assert.equal(await page.evaluate(() => document.elementFromPoint(500, 65)?.id), 'native-categories',
    'native categories remain clickable below our banner');
  await top.getByRole('button', { name: 'Account', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__accountClicks), 1);
  await page.keyboard.press('Escape');
  await top.locator('[data-ytg-search-input]').fill('banner search');
  await top.locator('[data-ytg-search-input]').press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__nativeSearches), ['banner search']);
  await page.screenshot({ path: 'output/playwright/topbar-mode-youtube.png' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-custom-browse'));
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('browseMode')).browseMode), 'youtube');
  await page.locator('ytd-rich-item-renderer a#thumbnail').focus();
  await pad({ connected: true, button: 13 });
  await pad({ connected: true });
  await page.waitForFunction(() => {
    const ring = document.querySelector('#yt-gamepad-overlay')?.shadowRoot?.querySelector('#ring');
    return !!ring && getComputedStyle(ring).display === 'none';
  });
  await page.reload();
  await native.waitFor(); await page.locator('#native-banner').waitFor();
  assert.equal(await custom.isVisible(), true);
  assert.equal(await grid.isVisible(), false);
  assert.equal(await top.locator('[data-ytg-page-mode]').getAttribute('aria-checked'), 'false');
  const reconnected = await virtualPad(context, page); await reconnected({ connected: true });
  await top.locator('[data-ytg-page-mode]').focus();
  await reconnected({ connected: true, button: 0 });
  await grid.waitFor(); await native.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('ytg-browse-root').shadowRoot.activeElement?.hasAttribute('data-ytg-page-mode'));
  assert.equal(await top.locator('.ytg-mode-key').textContent(), 'A');
  await page.screenshot({ path: 'output/playwright/topbar-mode-gamepad-focus.png' });
  assert.equal(await page.locator('#native-banner').isVisible(), false);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('browseMode')).browseMode), 'gamepad');
  await reconnected({ connected: true });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await reconnected({ connected: true, button: 0 });
  await native.waitFor(); await grid.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('ytg-browse-root').shadowRoot.activeElement?.hasAttribute('data-ytg-page-mode'));
  await reconnected({ connected: true });
  await worker.evaluate(() => chrome.storage.local.set({ browseMode: 'gamepad' }));
  await grid.waitFor();
  await worker.evaluate(() => chrome.storage.local.set({ browseMode: 'youtube' }));
  await native.waitFor(); await grid.waitFor({ state: 'hidden' });
});

test('failed mode save restores the previous view and keeps a usable switch', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body><ytd-page-manager><ytd-browse><ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=a">A</a></ytd-rich-item-renderer></ytd-browse></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(() => {
    window.chrome = { storage: { local: { get: async () => ({ browseMode: 'gamepad' }), set: async () => { throw new Error('save failed'); } },
      onChanged: { addListener() {}, removeListener() {} } } };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', index: 0,
      axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  const top = page.locator('#ytg-browse-root #ytg-browse-top');
  await top.locator('[data-ytg-page-mode]').click();
  await top.getByRole('status').waitFor();
  assert.equal(await top.locator('[data-ytg-page-mode]').getAttribute('aria-checked'), 'true');
  assert.equal(await top.locator('[data-ytg-page-mode]').isEnabled(), true);
  assert.equal(await page.locator('#ytg-native-mode').isVisible(), false);
});


test('adapter failure keeps the client surface without changing the saved mode', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, browseMode: 'gamepad' }));
  await context.addInitScript(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'fixture' } } : undefined };
  });
  let requests = 0;
  await context.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) {
      if (route.request().url().includes('/browse')) requests++;
      return route.fulfill({ json: { unexpected: true } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><head><style>ytd-page-manager{display:block;padding-top:120px}</style></head><body><ytd-app><ytd-page-manager><a id="native-video" href="/watch?v=original">Original video</a></ytd-page-manager></ytd-app></body></html>' });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const retry = page.locator('#ytg-browse-root').getByRole('button', { name: /重试|Retry|Try again/i });
  await retry.waitFor();
  assert.equal(await page.locator('#native-video').isVisible(), false);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('browseMode'))).browseMode, 'gamepad');
  assert.equal(requests, 1);
  const mode = page.locator('#ytg-browse-root [data-ytg-page-mode]');
  assert.equal(await mode.getAttribute('aria-checked'), 'true');
  await retry.click();
  await page.waitForTimeout(200);
  await retry.waitFor();
  assert.equal(requests, 2);
  assert.equal(await page.locator('#native-video').isVisible(), false);
});

test('Off keeps the banner and native watch layout across navigation and mode changes', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, browseMode: 'youtube' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<html><body><ytd-app><ytd-masthead></ytd-masthead><ytd-page-manager><ytd-watch-flexy><div id="movie_player" style="width:640px;height:360px"><video></video><div class="ytp-chrome-bottom">Native controls</div></div><div id="below">Native description</div><div id="secondary">Native recommendations</div></ytd-watch-flexy></ytd-page-manager></ytd-app></body></html>` }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=original');
  const top = page.locator('#ytg-browse-root #ytg-browse-top');
  await top.waitFor();
  const assertNative = async () => {
    await page.waitForFunction(() => document.documentElement.dataset.ytgBrowseMode === 'youtube' && !document.documentElement.classList.contains('ytg-watch-layout'));
    assert.equal(await top.isVisible(), true);
    assert.equal(await page.locator('#below').isVisible(), true);
    assert.equal(await page.locator('#secondary').isVisible(), true);
    assert.equal(await page.locator('.ytp-chrome-bottom').isVisible(), true);
    assert.equal(await page.locator('#movie_player').evaluate(node => getComputedStyle(node).position), 'static');
    assert.equal(await page.locator('#ytg-watch').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-watch-active')), false);
  };
  await assertNative();
  await top.locator('[data-ytg-page-mode]').click();
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-watch-layout'));
  await worker.evaluate(() => chrome.storage.local.set({ browseMode: 'youtube' }));
  await assertNative();
  await page.reload();
  await top.waitFor();
  await assertNative();
});


test('unsupported destinations keep the shell, navigation and explicit original-page exit', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad', autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body><ytd-app><ytd-page-manager><p id="native-content">Original page</p></ytd-page-manager></ytd-app></body></html>' }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/account_advanced');
  const shell = page.locator('#ytg-browse-root');
  await shell.locator('[data-ytg-shell-status]').waitFor();
  assert.equal(await page.locator('#native-content').isVisible(), false);
  await shell.locator('#ytg-browse-top').evaluate(node => window.__retainedHeader = node);
  await shell.locator('[data-sidebar-id="subscriptions"]').click();
  await page.waitForURL('**/feed/subscriptions');
  assert.equal(await shell.locator('#ytg-browse-top').evaluate(node => node === window.__retainedHeader), true);
  await page.goBack();
  await shell.locator('[data-ytg-shell-status]').waitFor();
  await shell.getByRole('button', { name: '打开 YouTube 原页面', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.ytgBrowseMode === 'youtube');
  await page.locator('#native-content').waitFor();
  assert.equal(new URL(page.url()).pathname, '/account_advanced');
});


test('watch adaptation failure keeps an actionable client error surface', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad', autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body><ytd-app><ytd-page-manager><ytd-watch-flexy><p id="native-details">Original details</p></ytd-watch-flexy></ytd-page-manager></ytd-app></body></html>' }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=missing');
  const notice = page.locator('#ytg-fallback-notice');
  await notice.waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#native-details').isVisible(), false);
  assert.equal(await page.locator('#ytg-browse-root #ytg-browse-top').isVisible(), true);
  assert.equal(await notice.getByRole('button').count(), 3);
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/shell-watch-error.png' });
  await notice.getByRole('button', { name: 'YouTube', exact: true }).click();
  await page.locator('#native-details').waitFor();
  await notice.waitFor({ state: 'hidden' });
});


test('YouTube account flows keep their native content without changing the saved interface', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    '<html><body><ytd-app><ytd-page-manager><button id="native-account-flow">Continue account selection</button></ytd-page-manager></ytd-app></body></html>' }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/channel_switcher');
  await page.locator('#native-account-flow').waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.ytgBrowseMode === 'gamepad');
  assert.equal(await page.locator('#native-account-flow').isVisible(), true);
  assert.equal(await page.locator('[data-ytg-shell-status]').count(), 0);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('browseMode'))).browseMode, 'gamepad');
});


test('failed search retains its keyword, sidebar and retry inside the shell', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad', autoFullscreen: false }));
  await context.addInitScript(() => { window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'fixture' } } : undefined }; });
  await context.route('https://www.youtube.com/**', route => route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { unexpected: true } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app><ytd-page-manager><p id="native-results">Native results</p></ytd-page-manager></ytd-app></body></html>' }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/results?search_query=retained+query');
  const shell = page.locator('#ytg-browse-root');
  await shell.getByRole('button', { name: /重试|Retry|Try again/i }).waitFor();
  assert.equal(await shell.locator('[data-ytg-search-input]').inputValue(), 'retained query');
  assert.equal(await shell.locator('#ytg-browse-sidebar').isVisible(), true);
  assert.equal(await page.locator('#native-results').isVisible(), false);
  assert.equal(await shell.locator('[data-ytg-page-mode]').getAttribute('aria-checked'), 'true');
});


test('external links retain their requested new-tab behavior', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-app></ytd-app><ytd-page-manager></ytd-page-manager></body></html>' }));
  await context.route('https://external.example/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>External destination</body></html>' }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/unsupported');
  await page.locator('[data-ytg-shell-status]').waitFor();
  await page.evaluate(() => {
    const link = document.createElement('a'); link.href = 'https://external.example/'; link.target = '_blank'; link.textContent = 'External destination';
    document.getElementById('ytg-browse-root').shadowRoot.querySelector('[data-ytg-shell-status]').append(link);
  });
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'External destination', exact: true }).click();
  const external = await opened; await external.waitForURL('https://external.example/');
  assert.equal(new URL(page.url()).pathname, '/unsupported');
  assert.equal(await page.locator('[data-ytg-shell-status]').isVisible(), true);
});
