import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { accountData } from './helpers/account-data.mjs';

async function fixture(t, { signedIn = true, failing = false, withSearch = false } = {}) {
  const page = await browserPage(t), calls = [];
  const state = { failing, selected: 0 };
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route('https://yt3.ggpht.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#369"/></svg>' }));
  await page.route('https://www.youtube.com/**', route => {
    if (new URL(route.request().url()).pathname === '/youtubei/v1/account/accounts_list') {
      calls.push(route.request().postDataJSON());
      return state.failing ? route.fulfill({ status: 500, json: { error: {} } }) : route.fulfill({ json: accountData(state.selected) });
    }
    if (route.request().url().includes('/youtubei/')) return route.fulfill({ json: { contents: withSearch ?
      [{ videoRenderer: { videoId: 'focus-card', title: { simpleText: 'Focus test' } } }] : [] } });
    return route.fulfill({ contentType: 'text/html', body: `<html><body>${withSearch ? '<ytd-masthead><input id="search"><button id="search-icon-legacy">Search</button></ytd-masthead>' : ''}<ytd-page-manager></ytd-page-manager></body></html>` });
  });
  await page.goto('https://www.youtube.com/');
  await page.evaluate(signedIn => {
    window.accountIndex = 0;
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' }, user: {} },
      LOGGED_IN: signedIn, SESSION_INDEX: window.accountIndex })[key] };
    Object.defineProperty(window, 'ytInitialData', { get() { throw Error('Page startup data read'); } });
  }, signedIn);
  for (const file of ['src/ui/theme.css', 'src/app/browse.css'])
    await page.addStyleTag({ content: readFileSync(new URL('../' + file, import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await mainFixture() });
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: true, theater: true } }, location.origin));
  await page.locator('.client-account').waitFor();
  return { page, calls, state };
}

test('API profile and account list render without a native avatar or menu, trap focus and restore it', { timeout: 45000 }, async t => {
  const { page, calls, state } = await fixture(t);
  const button = page.locator('.client-account');
  await button.locator('img').waitFor();
  assert.equal(await button.getAttribute('title'), 'Example Creator');
  assert.equal(await button.locator('img').getAttribute('src'), 'https://yt3.ggpht.com/account-0');
  assert.equal(await page.evaluate(() => window.__testUi.focus('account')), true);
  assert.equal(await page.evaluate(() => window.__testUi.openPanel('account')), true);
  const panel = page.locator('#ytg-account-page');
  await panel.locator('.account-list-item').first().waitFor();
  assert.equal(await panel.locator('[data-account-close] svg').getAttribute('data-icon'), 'mingcute:left-line');
  assert.equal(await panel.locator('.account-chevron[data-icon="mingcute:right-line"]').count(), 3);
  assert.equal(await panel.locator('.account-profile h2').textContent(), 'Example Creator');
  assert.equal(await panel.locator('.account-profile p').textContent(), '@example');
  assert.equal(await panel.locator('.account-list-item').count(), 2);
  assert.equal(await panel.locator('.account-list-item img').count(), 2);
  assert.equal(await panel.locator('.account-list-item strong').nth(1).textContent(), '<img> Other creator');
  assert.equal(await panel.locator('.account-list-item[aria-current="true"]').count(), 1);
  assert.ok(calls.every(body => body.requestType === 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER'));
  assert.equal(await page.locator('ytd-popup-container,#avatar-btn').count(), 0);
  await panel.locator('[data-account-close]').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => window.__pageDOM.activeElement.textContent.trim()), 'YouTube settings');
  await page.keyboard.press('Tab');
  assert.equal(await panel.locator('[data-account-close]').evaluate(node => node === node.getRootNode().activeElement), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  assert.equal(await button.evaluate(node => node === node.getRootNode().activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-account-open')), false);
  for (const id of ['settings', 'search']) {
    assert.equal(await page.evaluate(id => window.__testUi.openPanel(id), id), true);
    assert.equal(await page.evaluate(() => window.__testUi.openPanel('account')), false);
    assert.equal(await page.evaluate(() => window.__testUi.closePanel()), true);
  }
  state.selected = 1;
  await page.evaluate(() => { window.accountIndex = 1; document.dispatchEvent(new Event('yt-page-data-updated')); });
  await page.waitForFunction(() => window.__pageDOM.querySelector('.client-account')?.title === '<img> Other creator');
  assert.equal(await page.evaluate(() => window.__testUi.openPanel('account')), true);
  await panel.getByRole('button', { name: 'Switch account', exact: true }).click();
  await page.waitForURL('**/channel_switcher');
});

test('API account errors offer a retry and a late response cannot reopen a closed account page', { timeout: 45000 }, async t => {
  const { page, state } = await fixture(t, { failing: true });
  await page.locator('.client-account').click();
  const panel = page.locator('#ytg-account-page');
  await panel.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(await panel.locator('.account-list-item').count(), 0);
  state.failing = false;
  await panel.getByRole('button', { name: 'Retry', exact: true }).click();
  await panel.locator('.account-list-item').first().waitFor();
  await panel.locator('[data-account-close]').click();
  await panel.waitFor({ state: 'detached' });
  await page.evaluate(() => document.dispatchEvent(new Event('yt-page-data-updated')));
  assert.equal(await panel.count(), 0);
});

test('signed-out account view provides official sign-in navigation without reading native controls', { timeout: 45000 }, async t => {
  const { page, calls } = await fixture(t, { signedIn: false });
  await page.locator('.client-account').click();
  assert.equal(await page.locator('.account-avatar-fallback').getAttribute('data-icon'), 'mingcute:person-line');
  await page.locator('#ytg-account-page').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/signin?next=%2F');
  assert.equal(calls.length, 0);
});

test('semantic UI focus reaches the existing navigation owners and respects modal layers', { timeout: 45000 }, async t => {
  const { page } = await fixture(t, { withSearch: true });
  await page.locator('[data-browse-id="video:focus-card"]').waitFor();
  await page.locator('#ytg-client-search input').waitFor();
  for (const id of ['search', 'categories', 'content', 'sidebar', 'account'])
    assert.equal(await page.evaluate(id => window.__testUi.focus(id), id), true, id);
  assert.equal(await page.evaluate(() => window.__testUi.openPanel('account')), true);
  assert.equal(await page.evaluate(() => window.__testUi.focus('content')), false);
  assert.equal(await page.evaluate(() => window.__testUi.closePanel()), true);
  assert.equal(await page.evaluate(() => window.__testUi.focus('content')), true);
});
