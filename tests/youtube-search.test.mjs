import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent',
  build: { write: false, minify: false, target: 'es2022', lib: {
    entry: fileURLToPath(new URL('../src/sites/youtube-feed.ts', import.meta.url)),
    formats: ['iife'], name: 'SearchFixture'
  } } });
const code = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code;
const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: `Title ${id}` },
  ownerText: { runs: [{ text: 'Creator', navigationEndpoint: { browseEndpoint: { browseId: 'UCtest' } } }] },
  thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 }] },
  navigationEndpoint: { watchEndpoint: { videoId: id } } } });
const continuation = token => ({ continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
  continuationEndpoint: { commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/search' } },
    continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_SEARCH' } } } });
function response(items, token, next = false) {
  const contents = [{ itemSectionRenderer: { contents: items } }, ...(token ? [continuation(token)] : [])];
  return next ? { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: contents } }] }
    : { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents } } } } };
}
function fixture({ handler, authenticated = false, pathname = '/results', search = '?search_query=music&sp=filter-token' } = {}) {
  const calls = [], states = [];
  const location = { pathname, search,
    origin: 'https://www.youtube.com' };
  const context = { client: { clientName: 'WEB', clientVersion: 'real-page-version', hl: 'zh-CN', gl: 'TW', visitorData: 'visitor' },
    user: { lockedSafetyMode: false } };
  const sandbox = { URL, URLSearchParams, AbortController, Request, Response, Headers, structuredClone, TextEncoder,
    crypto: webcrypto, setTimeout, clearTimeout, console, location,
    history: { state: {}, replaceState(value) { this.state = value; states.push(value); } },
    document: { cookie: authenticated ? 'SAPISID=test-session' : '',
      querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: { get ytInitialData() { throw Error('Startup JSON read'); }, ytcfg: { get: key => ({ INNERTUBE_CONTEXT: context,
      INNERTUBE_CONTEXT_CLIENT_NAME: 1, SESSION_INDEX: authenticated ? 2 : undefined,
      DELEGATED_SESSION_ID: authenticated ? 'brand-account' : undefined })[key] } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body });
      const raw = await (handler ? handler(body, calls.length, options) : response([video(body.continuation ? 'second' : 'first')], body.continuation ? undefined : 'next', !!body.continuation));
      return { ok: true, json: async () => raw };
    } };
  vm.runInNewContext(code, Object.assign(sandbox, { Headers, Request, Response }));
  return { ...sandbox.SearchFixture, sandbox, context, location, calls, states };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('legacy video author thumbnails reach browse cards and skip unusable avatar URLs', async () => {
  const withAvatar = video('avatar');
  withAvatar.videoRenderer.channelThumbnailSupportedRenderers = { channelThumbnailWithLinkRenderer: {
    thumbnail: { thumbnails: [
      { url: 'http://example.com/insecure.jpg', width: 176, height: 176 },
      { url: 'https://yt3.ggpht.com/creator=s88', width: 88, height: 88 }
    ] }
  } };
  const service = fixture({ handler: () => response([withAvatar, video('no-avatar')]) }).createYouTubeFeedService();
  const result = await service.request('all');
  assert.equal(result.items[0].channelAvatar, 'https://yt3.ggpht.com/creator=s88');
  assert.equal(result.items[0].channel, 'Creator');
  assert.equal(result.items[1].channelAvatar, undefined);
});

for (const [pathname, search, browseId] of [
  ['/', '', 'FEwhat_to_watch'], ['/feed/subscriptions', '', 'FEsubscriptions'],
  ['/feed/history', '', 'FEhistory'], ['/playlist', '?list=WL', 'VLWL']
]) test(`YouTube.js normalizes ${browseId} first page and continuation with the page account`, async () => {
  const card = id => {
    const item = video(id);
    item.videoRenderer.thumbnail.thumbnails = [
      { url: `https://i.ytimg.com/vi/${id}/large.jpg`, width: 1280 },
      { url: `https://i.ytimg.com/vi/${id}/small.jpg`, width: 120 }
    ];
    if (browseId !== 'VLWL') return { richItemRenderer: { content: item } };
    const data = item.videoRenderer;
    data.title.accessibility = { accessibilityData: { label: id } };
    data.navigationEndpoint.watchEndpoint = { videoId: id, playlistId: 'WL', index: id === 'first' ? 0 : 1 };
    data.isPlayable = true;
    return { playlistVideoRenderer: data };
  };
  const s = fixture({ pathname, search, authenticated: true, handler: body => {
    const contents = [card(body.continuation ? 'second' : 'first'), ...(!body.continuation ? [continuation('browse-next')] : [])];
    return body.continuation ? { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: contents } }] }
      : { contents: { twoColumnBrowseResultsRenderer: { tabs: [
        { tabRenderer: { selected: false, content: { richGridRenderer: { contents: [card('hidden'), continuation('hidden-next')] } } } },
        { tabRenderer: { selected: true, content: browseId === 'VLWL' ?
          { playlistVideoListRenderer: { playlistId: 'WL', contents } } : { richGridRenderer: { contents } } } }
      ] } } };
  } });
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].thumbnail, 'https://i.ytimg.com/vi/first/large.jpg');
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].thumbnail, 'https://i.ytimg.com/vi/second/large.jpg');
  assert.equal(s.calls[0].body.browseId, browseId);
  assert.equal(s.calls[1].body.continuation, 'browse-next');
  assert.ok(s.calls.every(call => call.url === '/youtubei/v1/browse'));
  assert.equal(s.calls[0].options.headers['x-goog-authuser'], '2');
  if (browseId === 'VLWL') {
    assert.match(first.items[0].href, /list=WL&index=1/);
    assert.match(second.items[0].href, /list=WL&index=2/);
  }
});

test('home API response and movies with missing overlays use library parsing', async () => {
  const item = video('startup');
  item.videoRenderer.thumbnail.thumbnails = [
    { url: 'https://i.ytimg.com/vi/startup/large.jpg', width: 1280 },
    { url: 'https://i.ytimg.com/vi/startup/small.jpg', width: 120 }
  ];
  const initial = { contents: { richGridRenderer: { contents: [
    { richItemRenderer: { content: item } },
    { movieRenderer: { videoId: 'fallback', title: { simpleText: 'Fallback' } } }, continuation('startup-next')
  ] } } };
  const s = fixture({ pathname: '/', search: '', handler: () => initial });
  const result = await s.createYouTubeFeedService().request('all');
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:startup', 'video:fallback']);
  assert.equal(result.items[0].thumbnail, 'https://i.ytimg.com/vi/startup/large.jpg');
  assert.ok(result.nextPage);
  assert.equal(s.calls.length, 1);
});

test('actual YouTube.js search and next page match existing cards; preserve filter and page context', async () => {
  const s = fixture();
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  assert.deepEqual(Array.from(first.items, item => [item.id, item.title, item.channel, item.href]), [['video:first', 'Title first', 'Creator', '/watch?v=first']]);
  assert.equal(s.calls[0].body.query, 'music');
  assert.equal(s.calls[0].body.params, 'filter-token');
  assert.deepEqual(s.calls[0].body.context, s.context);
  assert.equal(s.calls[0].options.credentials, 'same-origin');
  const next = await service.request('all', first.nextPage);
  assert.deepEqual(Array.from(next.items, item => [item.id, item.title, item.href]), [['video:second', 'Title second', '/watch?v=second']]);
  assert.equal(s.calls[1].body.continuation, 'next');
  assert.equal(next.nextPage, undefined);
  assert.ok(s.calls.every(call => call.url === '/youtubei/v1/search'));
  assert.ok(first.nextPage !== 'next', 'UI receives opaque page IDs');
  assert.equal(s.calls[0].options.headers.authorization, undefined);
});

test('signed-in request preserves selected account and SAPISID authentication without passing cookies to the library', async () => {
  const s = fixture({ authenticated: true });
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  await service.request('all', first.nextPage);
  for (const { options, body } of s.calls) {
    assert.match(options.headers.authorization, /^SAPISIDHASH \d+_[a-f0-9]{40}$/);
    assert.equal(options.headers['x-goog-authuser'], '2');
    assert.equal(options.headers['x-goog-pageid'], 'brand-account');
    assert.equal(options.headers.Cookie, undefined);
    assert.deepEqual(body.context, s.context);
  }
});

test('continuations survive service recreation, fail for another route and remain retryable after errors', async () => {
  let fail = true;
  const s = fixture({ handler: (body) => {
    if (body.continuation && fail) { fail = false; return { error: { code: 400 } }; }
    return response([video(body.continuation ? 'second' : 'first')], body.continuation ? undefined : 'next', !!body.continuation);
  } });
  const first = await s.createYouTubeFeedService().request('all');
  const service = s.createYouTubeFeedService();
  await assert.rejects(service.request('all', first.nextPage), /response/);
  assert.equal((await service.request('all', first.nextPage)).items[0].id, 'video:second');
  s.location.search = '?search_query=other';
  await assert.rejects(service.request('all', first.nextPage), /unavailable/);
});

test('cancellation and navigation discard pending library search responses', async () => {
  for (const navigate of [false, true]) {
    let release;
    const s = fixture({ handler: () => new Promise(resolve => { release = resolve; }) });
    const service = s.createYouTubeFeedService();
    const pending = service.request('all');
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    if (navigate) s.location.search = '?search_query=other'; else service.cancel();
    release(response([video('stale')], 'next'));
    await assert.rejects(pending, /cancelled/);
    assert.equal(s.states.length, 0);
  }
});

test('default search requests fresh results without opt-in and empty library searches terminate', async () => {
  const s = fixture();
  assert.equal((await s.createYouTubeFeedService().request('all')).items[0].id, 'video:first');
  assert.equal(s.calls.length, 1);
  const empty = fixture({ handler: () => response([]) });
  assert.deepEqual(plain(await empty.createYouTubeFeedService().request('all')), { items: [] });
});

test('parsed mixed search results retain order, playlist context and Shorts destinations', async () => {
  const playlist = { playlistRenderer: { playlistId: 'PLtest', title: { simpleText: 'Playlist' },
    thumbnails: [{ thumbnails: [{ url: 'https://i.ytimg.com/vi/list/hqdefault.jpg', width: 480 }] }],
    navigationEndpoint: { watchEndpoint: { videoId: 'list', playlistId: 'PLtest', index: 2 } } } };
  const short = { reelItemRenderer: { videoId: 'short', headline: { simpleText: 'Short' },
    thumbnail: { thumbnails: [] }, navigationEndpoint: { reelWatchEndpoint: { videoId: 'short' } } } };
  const raw = response([video('first'), playlist, short, video('first')]);
  const s = fixture({ handler: () => raw });
  const result = await s.createYouTubeFeedService().request('all');
  assert.deepEqual(Array.from(result.items, item => item.href), ['/watch?v=first', '/watch?v=list&list=PLtest&index=3', '/shorts/short']);
  assert.equal(result.items[1].isPlaylist, true);
});

test('library normalization selects the largest thumbnail even when it is not last', async () => {
  const item = video('sizes');
  item.videoRenderer.thumbnail.thumbnails = [
    { url: 'https://i.ytimg.com/vi/sizes/large.jpg', width: 1280 },
    { url: 'https://i.ytimg.com/vi/sizes/small.jpg', width: 120 }
  ];
  const s = fixture({ handler: () => response([item]) });
  const result = await s.createYouTubeFeedService().request('all');
  assert.equal(result.items[0].thumbnail, 'https://i.ytimg.com/vi/sizes/large.jpg');
  assert.equal(s.calls.length, 1);
});

test('flat API response contents parse directly without refetching or losing pagination', async () => {
  const raw = { contents: [video('fallback'), continuation('fallback-next')] };
  const s = fixture({ handler: () => raw });
  const result = await s.createYouTubeFeedService().request('all');
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:fallback']);
  assert.ok(result.nextPage);
  assert.equal(s.calls.length, 1);
});

test('pagination ignores header reload continuations', async () => {
  const s = fixture({ handler: (body, count) => {
    if (count === 1) return response([video('first')], 'next');
    if (count === 2) {
      const raw = response([video('second')], 'body-next', true);
      raw.onResponseReceivedCommands.unshift({ reloadContinuationItemsCommand: {
        slot: 'RELOAD_CONTINUATION_SLOT_HEADER', continuationItems: [continuation('header-next')]
      } });
      return raw;
    }
    assert.equal(body.continuation, 'body-next');
    return response([video('third')], undefined, true);
  } });
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].id, 'video:second');
  assert.equal((await service.request('all', second.nextPage)).items[0].id, 'video:third');
});
