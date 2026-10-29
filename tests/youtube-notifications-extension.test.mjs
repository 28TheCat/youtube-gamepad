import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, virtualPad } from './helpers/extension.mjs';

test('notification API count, menu, pagination, navigation and gamepad back', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addInitScript(() => { window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} }, LOGGED_IN: true })[key] }; });
  const requests = [];
  const notification = (id, text) => ({ notificationRenderer: { notificationId: id, shortMessage: { simpleText: text }, sentTimeText: { simpleText: 'Now' }, read: false,
    navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=' + id, webPageType: 'WEB_PAGE_TYPE_WATCH' } }, watchEndpoint: { videoId: id } } } });
  const menu = items => ({ actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ multiPageMenuNotificationSectionRenderer: { items } }] } } } }] });
  await context.route('https://www.youtube.com/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/youtubei/v1/notification/get_unseen_count') return route.fulfill({ json: { unseenCount: 4 } });
    if (path === '/youtubei/v1/notification/get_notification_menu') {
      const body = request.postDataJSON(); requests.push(body);
      const items = body.fetchCommentsParams?.continuation ? [notification('second', 'Second video')] : [notification('first', 'First video'),
        { continuationItemRenderer: { continuationEndpoint: { commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/notification/get_notification_menu' } }, continuationCommand: { token: 'page-two', request: 'CONTINUATION_REQUEST_TYPE_COMMENTS_NOTIFICATION_MENU' } } } }];
      return route.fulfill({ json: menu(items) });
    }
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [] } });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const entry = page.locator('.notification-entry');
  await entry.waitFor();
  await entry.locator('.notification-count').getByText('4').waitFor();
  await entry.click();
  const panel = page.locator('#ytg-notifications-page');
  await panel.getByRole('button', { name: /First video/ }).waitFor();
  await panel.getByRole('button', { name: 'Load more' }).click();
  await panel.getByRole('button', { name: /Second video/ }).waitFor();
  assert.equal(requests[1].fetchCommentsParams.continuation, 'page-two');
  const setPad = await virtualPad(context, page);
  await setPad({ connected: true }); await page.waitForTimeout(150);
  await setPad({ connected: true, button: 1 });
  await panel.waitFor({ state: 'detached' });
  await setPad({ connected: true });
  assert.equal(await entry.evaluate(node => node.getRootNode().activeElement === node), true);
  await entry.click();
  await panel.getByRole('button', { name: /First video/ }).waitFor();
  assert.equal(await panel.getByRole('button', { name: /First video/ }).isEnabled(), true);
  await Promise.all([page.waitForURL('**/watch?v=first'), panel.getByRole('button', { name: /First video/ }).click()]);
});

test('notifications show a retry on failure and a sign-in state when logged out', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, theater: true, autoFullscreen: false, uiLanguage: 'en' }));
  await context.addInitScript(() => {
    window.testSignedIn = true;
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} }, LOGGED_IN: window.testSignedIn })[key] };
  });
  let fail = true;
  await context.route('https://www.youtube.com/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/youtubei/v1/notification/get_unseen_count') return route.fulfill({ json: { unseenCount: 0 } });
    if (path === '/youtubei/v1/notification/get_notification_menu') return fail ? route.fulfill({ status: 500, json: { error: {} } }) :
      route.fulfill({ json: { actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ multiPageMenuNotificationSectionRenderer: { items: [] } }] } } } }] } });
    if (path.startsWith('/youtubei/')) return route.fulfill({ json: { contents: [] } });
    return route.fulfill({ contentType: 'text/html', body: '<html><body><ytd-page-manager></ytd-page-manager></body></html>' });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/');
  const entry = page.locator('.notification-entry'); await entry.waitFor(); await entry.click();
  const panel = page.locator('#ytg-notifications-page');
  await panel.getByText('Could not load notifications.').waitFor();
  fail = false;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await panel.getByText('No notifications yet.').waitFor();
  await panel.getByRole('button', { name: 'Back' }).click();
  await page.evaluate(() => { window.testSignedIn = false; });
  await entry.click();
  await panel.getByText('Sign in to see notifications.').waitFor();
});
