import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, virtualPad } from './helpers/extension.mjs';

test('unsupported routes preserve native chrome and restore the custom surface without saving a mode change', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, browseMode: 'gamepad', autoFullscreen: false }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><body><ytd-app><ytd-masthead style="display:block;height:56px"><button>Native search</button></ytd-masthead>
    <ytd-guide-renderer style="display:block"><a href="/">Home</a></ytd-guide-renderer>
    <ytd-page-manager style="display:block"><button id="native-action">Downloads</button></ytd-page-manager>
    </ytd-app></body></html>` }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/feed/downloads');
  await page.waitForFunction(() => document.documentElement.dataset.ytgRouteMode === 'native');
  const pad = await virtualPad(context, page); await pad({ connected: true });
  for (const selector of ['ytd-masthead', 'ytd-guide-renderer', '#native-action'])
    assert.equal(await page.locator(selector).isVisible(), true);
  assert.equal(await page.locator('#ytg-browse-root').isVisible(), false);
  assert.equal(await page.locator('html').getAttribute('data-ytg-boot'), null);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState(null, '', '/');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-browse'));
  assert.equal(await page.locator('#ytg-browse-root').isVisible(), true);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState(null, '', '/future-page');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => document.documentElement.dataset.ytgRouteMode === 'native');
  assert.equal(await page.locator('#ytg-browse-root').isVisible(), false);
  assert.equal(await page.locator('ytd-masthead').isVisible(), true);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('browseMode')).browseMode), 'gamepad');
});
