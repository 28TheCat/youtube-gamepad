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
      return route.fulfill({ json: { contents: [{ videoRenderer: { videoId: body.browseId === 'FEwhat_to_watch' ? 'all' : body.browseId,
        title: { simpleText: 'API video ' + body.browseId } } }] } });
    }
    return route.fulfill({ contentType: 'text/html', body: `<html><head><style>
      body{margin:0}ytd-masthead{display:block;height:56px}ytd-feed-filter-chip-bar-renderer{display:block;height:48px}
      yt-chip-cloud-chip-renderer{display:inline-block;padding:8px}
      </style><script>
      window.ytcfg={get:key=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'test'}}})[key]};
      window.ytInitialData={chips:['All','Music','Gaming'].map((label,index)=>({chipCloudChipRenderer:{
        text:{simpleText:label},isSelected:index===0,navigationEndpoint:{browseEndpoint:{browseId:index===0?'FEwhat_to_watch':label.toLowerCase()}}
      }}))};window.nativeClicks=0;
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
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-ytg-category][aria-label="Music"]')).display === 'none');
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
  const page = await settingsPage(t, { hash: '#display' });
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

test('actual extension applies category preferences to native chips and gamepad shoulders follow visual order', { timeout: 60000 }, async t => {
  const { context, worker, options } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false,
    browseCategories: { order: ['all', 'podcasts', 'gaming', 'music'], hidden: ['music'] } }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta charset="utf-8"><style>body{margin:0}ytd-masthead{display:block;height:56px}
    #chips{display:flex}yt-chip-cloud-chip-renderer{display:block;margin:8px}
    button{padding:12px}ytd-rich-item-renderer{display:block;width:300px;height:180px}</style></head><body>
    <ytd-masthead></ytd-masthead><ytd-feed-filter-chip-bar-renderer><div id="chips">
    <yt-chip-cloud-chip-renderer selected><button aria-pressed="true">全部</button></yt-chip-cloud-chip-renderer>
    <yt-chip-cloud-chip-renderer><button>音乐</button></yt-chip-cloud-chip-renderer>
    <yt-chip-cloud-chip-renderer><button>播客</button></yt-chip-cloud-chip-renderer>
    <yt-chip-cloud-chip-renderer><button>游戏</button></yt-chip-cloud-chip-renderer>
    </div></ytd-feed-filter-chip-bar-renderer><ytd-page-manager><ytd-rich-item-renderer>
    <a id="thumbnail" href="/watch?v=a">Video</a></ytd-rich-item-renderer></ytd-page-manager></body></html>` }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.goto('https://www.youtube.com/');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    for (const chip of document.querySelectorAll('yt-chip-cloud-chip-renderer')) chip.querySelector('button').addEventListener('click', () => {
      for (const other of document.querySelectorAll('yt-chip-cloud-chip-renderer')) {
        other.toggleAttribute('selected', other === chip);
        other.querySelector('button').setAttribute('aria-pressed', String(other === chip));
      }
    });
  });
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-browse'));
  try {
    await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('yt-chip-cloud-chip-renderer')[1]).display === 'none', undefined, { timeout: 5000 });
  } catch (error) {
    t.diagnostic(JSON.stringify({ errors, saved: await worker.evaluate(() => chrome.storage.local.get('browseCategories')),
      chips: await page.locator('yt-chip-cloud-chip-renderer').evaluateAll(nodes => nodes.map(node => ({ html: node.outerHTML, display: getComputedStyle(node).display }))) }));
    throw error;
  }
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('yt-chip-cloud-chip-renderer')]
    .filter(node => getComputedStyle(node).display !== 'none').sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    .map(node => node.textContent)), ['全部', '播客', '游戏']);
  await setPad({ connected: true, button: 5 });
  await page.waitForFunction(() => document.querySelector('yt-chip-cloud-chip-renderer[selected]')?.textContent === '播客');
  await setPad({ connected: true });
  await page.waitForTimeout(100);
  await setPad({ connected: true, button: 5 });
  await page.waitForFunction(() => document.querySelector('yt-chip-cloud-chip-renderer[selected]')?.textContent === '游戏');
  await setPad({ connected: true });
  await options.locator('[data-category-link="display"]').click();
  await options.getByRole('switch', { name: '显示音乐', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('yt-chip-cloud-chip-renderer')[1]).display !== 'none');
  await page.bringToFront();
  await page.reload();
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'attached' });
  const setPadAgain = await virtualPad(context, page);
  await setPadAgain({ connected: true });
  try {
    await page.waitForFunction(() => document.querySelectorAll('yt-chip-cloud-chip-renderer')[2]?.dataset.ytgCategoryOrder === '1');
  } catch (error) {
    t.diagnostic(JSON.stringify({ errors, stored: await worker.evaluate(() => chrome.storage.local.get('browseCategories')),
      state: await page.evaluate(() => ({ root: document.documentElement.outerHTML.slice(0, 600), focused: document.hasFocus(), hidden: document.hidden,
        chips: [...document.querySelectorAll('yt-chip-cloud-chip-renderer')].map(node => node.outerHTML) })) }));
    throw error;
  }
  await worker.evaluate(() => chrome.storage.local.set({ theater: false }));
  await page.waitForFunction(() => !document.querySelector('[data-ytg-category-order]'));
  assert.equal(await page.locator('.ytg-category-list').count(), 0, 'native order and visibility return when adaptation stops');
});
