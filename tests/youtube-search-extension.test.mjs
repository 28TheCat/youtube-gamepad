import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';

for (const [path, endpoint, browseId] of [
  ['/results?search_query=music', 'search'], ['/', 'browse', 'FEwhat_to_watch'],
  ['/feed/subscriptions', 'browse', 'FEsubscriptions'], ['/feed/history', 'browse', 'FEhistory'],
  ['/playlist?list=WL', 'browse', 'VLWL'], ['/feed/playlists', 'browse', 'FEplaylist_aggregation']
]) test(`bundled ${path} uses same-origin browser cookies under CSP and crosses the bridge with cards only`, { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await context.addCookies([{ name: 'SAPISID', value: 'fixture-session', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({
      INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'browser-fixture', hl: 'en', gl: 'US' }, user: {} },
      INNERTUBE_CONTEXT_CLIENT_NAME: 1, SESSION_INDEX: 2
    })[key] };
  });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request();
    if (new URL(request.url()).pathname === `/youtubei/v1/${endpoint}`) {
      const body = request.postDataJSON();
      calls.push({ body, headers: await request.allHeaders() });
      const id = body.continuation ? 'second' : 'first';
      const card = {
        videoId: id, title: { simpleText: id, accessibility: { accessibilityData: { label: id } } },
        ...(browseId === 'VLWL' ? { isPlayable: true,
          navigationEndpoint: { watchEndpoint: { videoId: id, playlistId: 'WL', index: body.continuation ? 1 : 0 } } } : {}),
        thumbnail: { thumbnails: [
          { url: `https://i.ytimg.com/vi/${id}/large.jpg`, width: 1280 },
          { url: `https://i.ytimg.com/vi/${id}/small.jpg`, width: 120 }
        ] }
      };
      const directory = browseId === 'FEplaylist_aggregation';
      const entry = directory ? { playlistRenderer: { playlistId: `PL${id}`, title: { simpleText: id },
        thumbnails: [{ thumbnails: card.thumbnail.thumbnails }] } } : { [browseId === 'VLWL' ? 'playlistVideoRenderer' : 'videoRenderer']: card };
      const items = [{ itemSectionRenderer: { contents: [entry] } }, ...(!body.continuation ? [{ continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: 'private-next', request: 'CONTINUATION_REQUEST_TYPE_SEARCH' } }
      } }] : [])];
      const data = body.continuation ? { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: items } }] }
        : endpoint === 'search' ? { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: items } } } } }
        : { contents: { sectionListRenderer: { contents: items } } };
      await route.fulfill({ json: data });
    } else {
      await route.fulfill({ contentType: 'text/html',
        headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'" },
        body: '<!doctype html><html><body><ytd-app></ytd-app></body></html>' });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://www.youtube.com${path}`);
  const request = fields => page.evaluate(fields => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { document.removeEventListener('ytg-page-response-v1', receive); reject(new Error('Bridge timeout')); }, 10000);
    function receive(event) {
      const response = JSON.parse(event.detail);
      if (response.id !== id) return;
      clearTimeout(timer);
      document.removeEventListener('ytg-page-response-v1', receive);
      resolve(response);
    }
    document.addEventListener('ytg-page-response-v1', receive);
    document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1, id, operation: 'requestBrowse', category: 'all', ...fields }) }));
  }), fields);
  const first = await request({});
  assert.equal(first.ok, true);
  assert.equal(first.value.items[0].thumbnail, 'https://i.ytimg.com/vi/first/large.jpg');
  assert.notEqual(first.value.nextPage, 'private-next');
  const second = await request({ page: first.value.nextPage });
  assert.equal(second.ok, true);
  if (browseId === 'VLWL') {
    assert.match(second.value.items[0].href, /v=second&list=WL&index=2/);
  } else if (browseId === 'FEplaylist_aggregation') {
    assert.equal(second.value.items[0].id, 'playlist:PLsecond');
    assert.equal(second.value.items[0].href, '/playlist?list=PLsecond');
    assert.equal(second.value.items[0].isPlaylist, true);
  } else assert.equal(second.value.items[0].id, 'video:second');
  assert.equal(calls.length, 2);
  if (browseId) assert.equal(calls[0].body.browseId, browseId);
  assert.equal(calls[1].body.continuation, 'private-next');
  for (const call of calls) {
    assert.match(call.headers.cookie, /SAPISID=fixture-session/);
    assert.match(call.headers.authorization, /^SAPISIDHASH /);
    assert.equal(call.headers['x-goog-authuser'], '2');
  }
  assert.equal(JSON.stringify(first).includes('fixture-session'), false);
  if (browseId === 'FEplaylist_aggregation') {
    const opened = await page.evaluate(() => new Promise(resolve => {
      document.querySelector('ytd-app').navigate_ = endpoint => resolve(endpoint);
      document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1,
        id: 'open-playlist', operation: 'openBrowseVideo', href: '/playlist?list=PLfirst' }) }));
    }));
    assert.equal(opened.browseEndpoint.browseId, 'VLPLfirst');
    assert.equal(opened.watchEndpoint, undefined);
  }
  assert.deepEqual(errors, []);
});
