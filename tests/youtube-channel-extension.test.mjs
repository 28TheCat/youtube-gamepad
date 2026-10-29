import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';

test('bundled channel adapter exposes tabs and sorting through the existing page bridge under CSP', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await context.addCookies([{ name: 'SAPISID', value: 'channel-fixture', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: {
      client: { clientName: 'WEB', clientVersion: 'browser-fixture' }, user: {}
    }, SESSION_INDEX: 2 })[key] };
  });
  const browse = params => ({ browseEndpoint: { browseId: 'UCcreator', params },
    commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/browse' } } });
  const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: id }, thumbnail: { thumbnails: [
    { url: `https://i.ytimg.com/vi/${id}/large.jpg`, width: 1280 }, { url: `https://i.ytimg.com/vi/${id}/small.jpg`, width: 120 }
  ] } } });
  const next = token => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: {
    token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE'
  } } } });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/youtubei/v1/')) {
      const body = request.postDataJSON();
      calls.push({ path, body, headers: await request.allHeaders() });
      let data;
      if (path.endsWith('resolve_url')) data = { endpoint: browse('videos') };
      else if (body.continuation || body.params === 'popular') data = { onResponseReceivedActions: [{
        appendContinuationItemsAction: { continuationItems: [video(body.continuation ? 'next' : 'popular'),
          ...(!body.continuation ? [next('private-next')] : [])] }
      }] };
      else data = { contents: { twoColumnBrowseResultsRenderer: { tabs: ['videos', 'shorts'].map(name => ({ tabRenderer: {
        title: name, selected: name === (body.params || 'videos'),
        endpoint: { ...browse(name), commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/browse', url: `/@creator/${name}` } } },
        content: { richGridRenderer: { header: { chipBarViewModel: { chips: [{ chipViewModel: {
          text: 'Popular', tapCommand: { innertubeCommand: browse('popular') }
        } }] } }, contents: [video(name)] } }
      } })) } } };
      await route.fulfill({ json: data });
    } else await route.fulfill({ contentType: 'text/html', headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'"
    }, body: '<!doctype html><html><body><ytd-app></ytd-app></body></html>' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/@creator/videos');
  const invoke = fields => page.evaluate(fields => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { document.removeEventListener('ytg-page-response-v1', receive); reject(Error('Bridge timeout')); }, 10000);
    function receive(event) {
      const response = JSON.parse(event.detail);
      if (response.id !== id) return;
      clearTimeout(timer); document.removeEventListener('ytg-page-response-v1', receive); resolve(response);
    }
    document.addEventListener('ytg-page-response-v1', receive);
    document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1, id, ...fields }) }));
  }), fields);
  const first = await invoke({ operation: 'requestBrowse', category: 'all' });
  assert.equal(first.ok, true);
  assert.equal(first.value.items[0].thumbnail, 'https://i.ytimg.com/vi/videos/large.jpg');
  const categories = await invoke({ operation: 'readBrowseCategories' });
  assert.deepEqual(categories.value.map(item => item.label), ['All', 'videos', 'shorts', 'Popular']);
  assert.equal(JSON.stringify(categories).includes('browseId'), false);
  const shorts = categories.value.find(item => item.label === 'shorts');
  const switched = await invoke({ operation: 'requestBrowse', category: shorts.id });
  assert.equal(switched.value.items[0].id, 'video:shorts');
  const updated = await invoke({ operation: 'readBrowseCategories' });
  const popular = updated.value.find(item => item.label === 'Popular');
  const sorted = await invoke({ operation: 'requestBrowse', category: popular.id });
  assert.equal(sorted.value.items[0].id, 'video:popular');
  assert.notEqual(sorted.value.nextPage, 'private-next');
  const second = await invoke({ operation: 'requestBrowse', category: popular.id, page: sorted.value.nextPage });
  assert.equal(second.value.items[0].id, 'video:next');
  assert.equal(calls.at(-1).body.continuation, 'private-next');
  assert.match(calls[1].headers.cookie, /SAPISID=channel-fixture/);
  assert.match(calls[1].headers.authorization, /^SAPISIDHASH /);
  assert.equal(calls[1].headers['x-goog-authuser'], '2');
  assert.deepEqual(errors, []);
});
