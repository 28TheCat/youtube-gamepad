import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { settingsPage } from './helpers/bundles.mjs';

test('actual MAIN and ISOLATED worlds load Vue categories through YouTube API and preserve preferences', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false,
    browseCategories: { order: ['all', 'gaming', 'music'], hidden: ['music'] } }));
  const requests = [];
  await context.route('https://i.ytimg.com/**', route => route.abort());
  await context.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/v1/')) {
      const body = route.request().postDataJSON(); requests.push(body);
      return route.fulfill({ json: { ...{chips:['All','Music','Gaming'].map((label,index)=>({chipCloudChipRenderer:{
        text:{simpleText:label},isSelected:index===0,navigationEndpoint:{browseEndpoint:{browseId:index===0?'FEwhat_to_watch':label.toLowerCase()}}
      }}))},  contents: [{ videoRenderer: { videoId: body.browseId === 'FEwhat_to_watch' ? 'all' : body.browseId,
        title: { simpleText: 'API video ' + body.browseId } } }] } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<html><head><style>
      body{margin:0}ytd-masthead{display:block;height:56px}ytd-feed-filter-chip-bar-renderer{display:block;height:48px}
      yt-chip-cloud-chip-renderer{display:inline-block;padding:8px}
      </style><script>
      window.ytcfg={get:key=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}})[key]};
      window.nativeClicks=0;
      </script></head><body><ytd-masthead></ytd-masthead><ytd-feed-filter-chip-bar-renderer>
      <yt-chip-cloud-chip-renderer selected><button onclick="window.nativeClicks++">All</button></yt-chip-cloud-chip-renderer>
      </ytd-feed-filter-chip-bar-renderer><ytd-page-manager></ytd-page-manager></body></html>` });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto('https://www.youtube.com/');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.locator('#ytg-browse-grid [data-browse-id="video:all"]').waitFor();
  await page.waitForFunction(() => getComputedStyle(window.__pageDOM.querySelector('[data-ytg-category][aria-label="Music"]')).display === 'none');
  await setPad({ connected: true, button: 5 });
  await page.locator('#ytg-browse-grid [data-browse-id="video:gaming"]').waitFor();
  await setPad({ connected: true });
  assert.equal(await page.evaluate(() => window.nativeClicks), 0);
  assert.ok(requests.some(body => body.browseId === 'gaming'));
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await page.locator('#ytg-browse-grid').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('yt-chip-cloud-chip-renderer').evaluate(node => getComputedStyle(node).visibility), 'visible');
});
import { launchExtension, virtualPad } from './helpers/extension.mjs';

test('category settings persist visibility and order, sync externally, and recover after a failed save', { timeout: 30000 }, async t => {
  const page = await settingsPage(t, { hash: '#display', stored: { uiLanguage: 'zh-CN' } });
  const panel = page.locator('.category-settings');
  const music = panel.getByRole('switch', { name: '显示音乐', exact: true });
  await music.click();
  await page.waitForFunction(() => window.testStorage.browseCategories?.hidden.includes('music'));
  assert.equal(await music.getAttribute('aria-checked'), 'false');
  await panel.getByRole('button', { name: '上移播客', exact: true }).click();
  await page.waitForFunction(() => window.testStorage.browseCategories?.order[1] === 'podcasts');
  await page.evaluate(async () => {
    const saved = await chrome.storage.local.get('browseCategories');
    await chrome.storage.local.set(saved);
  });
  assert.equal(await music.getAttribute('aria-checked'), 'false');
  assert.equal(await panel.locator('li').nth(1).getAttribute('data-category-id'), 'podcasts');
  await page.evaluate(() => { window.testSaveFailure = true; });
  await music.click();
  await panel.getByRole('status').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await music.getAttribute('aria-checked'), 'false', 'failed writes keep saved state');
  await page.evaluate(async () => {
    window.testSaveFailure = false;
    await chrome.storage.local.set({ browseCategoryCatalog: [{ label: '手工艺品' }] });
  });
  await panel.getByRole('switch', { name: '显示手工艺品' }).waitFor();
  await panel.getByRole('button', { name: '重置' }).click();
  await page.waitForFunction(() => window.testStorage.browseCategories?.hidden.length === 0 && window.testStorage.browseCategories?.order.length === 0);
  assert.equal(await music.getAttribute('aria-checked'), 'true');
  assert.equal(await panel.getByRole('switch', { name: '显示全部', exact: true }).isDisabled(), true);
  await panel.locator('[data-category-id="podcasts"] .category-drag').dragTo(panel.locator('[data-category-id="music"]'));
  await page.waitForFunction(() => window.testStorage.browseCategories?.order[1] === 'podcasts');
  mkdirSync('output/playwright', { recursive: true });
  await panel.screenshot({ path: 'output/playwright/category-settings.png' });
});

test('API category order drives shoulders while native chips remain untouched', { timeout: 60000 }, async t => {
  const { context, worker, options } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'zh-CN',
    browseCategories: { order: ['all', 'podcasts', 'gaming', 'music'], hidden: ['music'] } }));
  await context.route('https://i.ytimg.com/**', route => route.fulfill({ status: 204 }));
  await context.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('/youtubei/')) {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { ...{chips:['All','Music','Podcasts','Gaming'].map((label,index)=>({chipCloudChipRenderer:{
        text:{simpleText:label},isSelected:index===0,navigationEndpoint:{browseEndpoint:{browseId:index===0?'FEwhat_to_watch':label.toLowerCase()}}
      }}))},  contents: [{ videoRenderer: { videoId: body.browseId, title: { simpleText: body.browseId } } }] } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<html><head><script>
      window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientName:'WEB',clientVersion:'test'}}:undefined};
      window.nativeClicks=0;
      </script></head><body><ytd-masthead></ytd-masthead>
      <ytd-feed-filter-chip-bar-renderer><yt-chip-cloud-chip-renderer><button onclick="window.nativeClicks++">Music</button></yt-chip-cloud-chip-renderer></ytd-feed-filter-chip-bar-renderer>
      <ytd-page-manager></ytd-page-manager></body></html>` });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto('https://www.youtube.com/');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.locator('[data-browse-id="video:FEwhat_to_watch"]').waitFor();
  await page.waitForFunction(() => window.__pageDOM.querySelector('[data-ytg-category][aria-label="Music"]')?.hasAttribute('data-ytg-category-hidden'));
  await setPad({ connected: true, button: 5 });
  await page.locator('[data-browse-id="video:podcasts"]').waitFor();
  await setPad({ connected: true });
  await page.waitForTimeout(100);
  await setPad({ connected: true, button: 5 });
  await page.locator('[data-browse-id="video:gaming"]').waitFor();
  await setPad({ connected: true });
  await options.locator('[data-category-link="display"]').click();
  await options.getByRole('switch', { name: '显示音乐', exact: true }).click();
  await page.waitForFunction(() => !window.__pageDOM.querySelector('[data-ytg-category][aria-label="Music"]')?.hasAttribute('data-ytg-category-hidden'));
  assert.equal(await page.locator('yt-chip-cloud-chip-renderer').getAttribute('data-ytg-category-hidden'), null);
  assert.equal(await page.locator('yt-chip-cloud-chip-renderer').getAttribute('data-ytg-category-order'), null);
  assert.equal(await page.evaluate(() => window.nativeClicks), 0);
});
