import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';

test('bundled next parser preserves queue positions and return cache under CSP', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await context.addInitScript(() => {
    window.ytcfg = { get: key => key === 'INNERTUBE_CONTEXT' ? {
      client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {}
    } : undefined };
  });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request();
    if (new URL(request.url()).pathname !== '/youtubei/v1/next') {
      return route.fulfill({ contentType: 'text/html', headers: {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'"
      }, body: '<!doctype html><html><body><ytd-app></ytd-app></body></html>' });
    }
    const body = request.postDataJSON(); calls.push(body);
    const image = { thumbnails: [
      { url: 'https://i.ytimg.com/vi/same/large.jpg', width: 1280 },
      { url: 'https://i.ytimg.com/vi/same/small.jpg', width: 120 }
    ] };
    await route.fulfill({ json: { contents: { twoColumnWatchNextResults: {
      secondaryResults: { secondaryResults: { results: [{ compactVideoRenderer: {
        videoId: 'related', title: { simpleText: 'Related' }, thumbnail: image,
        thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '12:34' }, style: 'DEFAULT' } }]
      } }] } },
      playlist: { playlist: { playlistId: 'PLtest', contents: [1, 4].map(index => ({ playlistPanelVideoRenderer: {
        videoId: 'same', title: { simpleText: 'Repeated' }, thumbnail: image, selected: index === 1,
        navigationEndpoint: { watchEndpoint: { videoId: 'same', playlistId: 'PLtest', index, params: 'mix', startRadio: true } }
      } })) } }
    } } } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=current&list=PLtest&index=2');
  await page.evaluate(() => {
    window.readNextFixture = () => {
      const id = crypto.randomUUID(); let snapshot;
      const receive = event => {
        const reply = JSON.parse(event.detail);
        if (reply.id === id && reply.ok) snapshot = reply.value;
      };
      document.addEventListener('ytg-page-response-v1', receive);
      document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1, id, operation: 'readWatchNext' }) }));
      document.removeEventListener('ytg-page-response-v1', receive);
      return snapshot;
    };
  });
  await page.waitForFunction(() => window.readNextFixture()?.queue.length === 2);
  const first = await page.evaluate(() => window.readNextFixture());
  assert.equal(first.recommendations[0].duration, '12:34');
  assert.equal(first.recommendations[0].thumbnail, 'https://i.ytimg.com/vi/same/large.jpg');
  assert.notEqual(first.queue[0].key, first.queue[1].key);
  assert.equal(first.queue[0].selected, true);
  assert.match(first.queue[0].href, /index=2/);
  assert.match(first.queue[1].href, /index=5/);
  assert.match(first.queue[1].href, /params=mix/);
  await page.evaluate(() => {
    const original = location.pathname + location.search;
    history.pushState({}, '', '/watch?v=other');
    history.pushState({}, '', original);
  });
  assert.deepEqual(await page.evaluate(() => window.readNextFixture()), first);
  assert.equal(calls.length, 1, 'return restores the original queue without refetching');
  assert.deepEqual(errors, []);
});
