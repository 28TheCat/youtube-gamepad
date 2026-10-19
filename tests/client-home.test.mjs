import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { accountData } from './helpers/account-data.mjs';

test('client home aligns its shell, supports account actions and adapts to narrow screens', { timeout: 30000 }, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1440, height: 960 });
  const titles = ['A new perspective on everyday design', 'A weekend away from the city', 'How great animations come together', 'Exploring the places around us', 'Games worth playing with friends', 'Something delicious for the weekend'];
  await page.route('https://i.ytimg.com/**', route => {
    const colors = ['#315c70', '#5c4573', '#786143', '#38645c', '#485c86', '#86505b'];
    const i = Number(new URL(route.request().url()).pathname.match(/client(\d+)/)?.[1] || 0);
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${colors[i % 6]}"/><circle cx="530" cy="70" r="180" fill="#ffffff12"/><circle cx="90" cy="350" r="210" fill="#00000018"/><path d="m288 140 70 40-70 40z" fill="#ffffffaa"/><text x="32" y="312" fill="#fff" font-size="25" font-family="Arial" font-weight="700">STUDIO ${i + 1}</text></svg>` });
  });
  await page.route('https://www.youtube.com/**', route => new URL(route.request().url()).pathname === '/youtubei/v1/account/accounts_list'
    ? route.fulfill({ json: accountData() }) : route.request().url().includes('/youtubei/')
    ? route.fulfill({ json: { ...{ chips: ['All', 'Music', 'Gaming', 'Design', 'Travel', 'Cooking', 'Live'].map((label, i) => ({ chipCloudChipRenderer: {
      text: { simpleText: label }, isSelected: i === 0, navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } }
    } })) },  contents: Array.from({ length: 18 }, (_, i) => ({ videoRenderer: {
      videoId: `client${i}`, title: { simpleText: titles[i % 6] }, ownerText: { runs: [{ text: ['Studio Notes', 'Slow Travel', 'Motion Lab'][i % 3] }] }
    } })) } })
    : route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-masthead><div id="center"><input id="search" placeholder="Search"><button id="search-icon-legacy">Search</button></div></ytd-masthead><ytd-page-manager></ytd-page-manager></body></html>' }));
  await page.goto('https://www.youtube.com/');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' } }, LOGGED_IN: true })[key] };


    const pad = { connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
  });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  await page.locator('#ytg-client-search input').waitFor();
  await page.locator('[data-browse-id="video:client0"] img').waitFor();
  await page.waitForFunction(() => [...window.__pageDOM.querySelectorAll('#ytg-browse-grid img')].slice(0, 6).every(img => img.complete && img.naturalWidth));
  await page.locator('.client-account').click();
  await page.locator('#ytg-account-page .account-profile h2').filter({ hasText: 'Example Creator' }).waitFor();
  await page.locator('#ytg-account-page [data-account-close]').click();
  await page.locator('[data-browse-id="video:client0"]').focus();
  mkdirSync('output/playwright', { recursive: true });
  for (const dark of [false, true]) {
    await page.evaluate(dark => { document.documentElement.toggleAttribute('dark', dark); document.documentElement.classList.add('ytg-gamepad-input'); window.YTGamepad.refresh(); }, dark);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#ytg-browse-sidebar [data-sidebar-id="subscriptions"]').evaluate(node => getComputedStyle(node).color), dark ? 'rgb(241, 241, 241)' : 'rgb(15, 15, 15)');
    await page.screenshot({ path: `output/playwright/client-home-${dark ? 'dark' : 'light'}.png` });
  }
  const entry = page.locator('[data-ytg-search-entry]');
  await entry.waitFor();
  await entry.focus();
  await page.evaluate(() => window.YTGamepad.act('left'));
  assert.ok(await page.evaluate(() => !!window.__pageDOM.activeElement.closest('[data-ytg-category]')));
  await page.locator('[data-ytg-category]').last().evaluate(node => { window.YTGamepad.focus(node); });
  await page.evaluate(() => window.YTGamepad.act('right'));
  assert.ok(await page.evaluate(() => window.__pageDOM.activeElement.hasAttribute('data-ytg-search-entry')));
  await page.evaluate(() => window.YTGamepad.act('down'));
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement.getAttribute('data-browse-id')), 'video:client0');
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(250);
    const bounds = await page.evaluate(() => {
      const header = window.__pageDOM.querySelector('#ytg-browse-top').getBoundingClientRect();
      const sidebar = window.__pageDOM.querySelector('#ytg-browse-sidebar').getBoundingClientRect();
      const grid = window.__pageDOM.querySelector('[data-ytg-browse-grid]').getBoundingClientRect();
      const search = window.__pageDOM.querySelector('#ytg-search-host').getBoundingClientRect();
      const cards = window.__pageDOM.querySelector('#ytg-browse-grid .cards');
      return { aligned: sidebar.top === header.bottom && sidebar.right === grid.left,
        searchFits: search.right <= innerWidth && search.left >= 0, feedFits: cards.scrollWidth <= cards.clientWidth,
        columns: getComputedStyle(cards).gridTemplateColumns.split(' ').length };
    });
    assert.ok(bounds.aligned && bounds.searchFits && bounds.feedFits, JSON.stringify({ width, bounds }));
    await page.keyboard.press('Tab');
    await page.locator('#ytg-browse-sidebar [data-sidebar-id="home"]').focus();
    await page.waitForTimeout(250);
    const expanded = await page.evaluate(() => {
      const right = window.__pageDOM.querySelector('#ytg-browse-sidebar').getBoundingClientRect().right;
      return { right, categories: window.__pageDOM.querySelector('#ytg-browse-categories').getBoundingClientRect().left,
        card: window.__pageDOM.querySelector('[data-browse-id]').getBoundingClientRect().left };
    });
    assert.ok(expanded.right > 80 && Math.abs(expanded.right - expanded.categories) < 1 && expanded.card >= expanded.right,
      JSON.stringify({ width, expanded }));
    await page.locator('[data-browse-id]').first().focus();
    await page.waitForTimeout(250);
    if (width === 390) {
      assert.equal(bounds.columns, 1);
      await page.getByRole('link', { name: 'Home', exact: true }).waitFor();
      await page.screenshot({ path: 'output/playwright/client-home-mobile.png' });
    }
  }
});
