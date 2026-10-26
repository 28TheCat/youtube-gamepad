import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
import * as YouTubeJs from 'youtubei.js/web';

const modules = {};
function load(file, context = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, URL, URLSearchParams, structuredClone, require: name => name === 'youtubei.js/web' ? YouTubeJs : name === './youtube-request' ? load('sites/youtube-request', context) : modules[name], ...context });
  return exports;
}
modules['../shared/browse-categories'] = load('shared/browse-categories');
modules['../shared/watch-link'] = load('shared/watch-link');
modules['../shared/playlist-colors'] = load('shared/playlist-colors');
modules['../shared/explore-pages'] = load('shared/explore-pages');
modules['./youtube-parser'] = load('sites/youtube-parser');
modules['./youtube-search'] = load('sites/youtube-search');
modules['./youtube-channel'] = load('sites/youtube-channel');
const { parseYouTubeJsBrowse } = modules['./youtube-search'];
const { listEndpoint } = modules['./youtube-parser'];

test('attributed metadata defaults command ranges without losing text or channel links', t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const onTap = { innertubeCommand: { browseEndpoint: { browseId: 'UCcreator' } } };
  for (const command of [{ length: 7, onTap }, { startIndex: 0, onTap }, { onTap }]) {
    const text = Object.freeze({ content: 'Creator', commandRuns: Object.freeze([Object.freeze(command)]) });
    const node = YouTubeJs.Parser.parseItem({ contentMetadataViewModel: {
      metadataRows: [{ metadataParts: [{ text }] }]
    } });
    const parsed = node.metadata_rows[0].metadata_parts[0].text;
    assert.equal(parsed.toString(), 'Creator');
    assert.equal(parsed.runs[0].endpoint.payload.browseId, 'UCcreator');
    assert.equal(text.commandRuns[0], command);
  }
  const suffix = YouTubeJs.Misc.Text.fromAttributed({ content: 'By Creator', commandRuns: [{ startIndex: 3, onTap }] });
  assert.equal(suffix.toString(), 'By Creator');
  assert.equal(suffix.runs[0].endpoint, undefined);
  assert.equal(suffix.runs[1].endpoint.payload.browseId, 'UCcreator');
  assert.equal(warnings.mock.callCount(), 0);
});

test('attributed commands spanning styled text retain formatting and endpoints', t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const data = { content: '频道😀 Creator', styleRuns: [{ startIndex: 2, length: 2, weightLabel: 'FONT_WEIGHT_BOLD' }],
    commandRuns: [{ startIndex: 0, length: 12, onTap: { browseEndpoint: { browseId: 'UCcreator' } } }] };
  const original = structuredClone(data);
  const text = YouTubeJs.Misc.Text.fromAttributed(data);
  assert.equal(text.toString(), data.content);
  assert.deepEqual(text.runs.map(run => run.text), ['频道', '😀', ' Creator']);
  assert.equal(text.runs[1].bold, true);
  assert.equal(text.runs[0].bold, false);
  assert.ok(text.runs.every(run => run.endpoint.payload.browseId === 'UCcreator'));
  assert.deepEqual(data, original);
  assert.equal(warnings.mock.callCount(), 0);
});

test('overlapping attributed commands preserve links outside the overlap', t => {
  const warnings = t.mock.method(console, 'warn', () => {});
  const text = YouTubeJs.Misc.Text.fromAttributed({ content: 'abcdef', commandRuns: [
    { startIndex: 0, length: 4, onTap: { browseEndpoint: { browseId: 'UCfirst' } } },
    { startIndex: 2, length: 4, onTap: { browseEndpoint: { browseId: 'UCsecond' } } }
  ] });
  assert.equal(text.toString(), 'abcdef');
  assert.deepEqual(text.runs.map(run => [run.text, run.endpoint.payload.browseId]),
    [['ab', 'UCfirst'], ['cd', 'UCsecond'], ['ef', 'UCsecond']]);
  assert.equal(warnings.mock.callCount(), 0);
});

test('unsupported routes never discover feeds through native DOM or startup JSON', async () => {
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/feed/custom', search: '', origin: 'https://www.youtube.com' },
    AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined },
      ytInitialData: { videoRenderer: { videoId: 'native', title: { simpleText: 'Native' } }, nextContinuationData: { continuation: 'native-next' } } },
    fetch() { throw new Error('unsupported route request'); }
  });
  const service = createYouTubeFeedService();
  assert.equal(service.categories().length, 0);
  await assert.rejects(service.request('all'), /Category unavailable/);
});

test('Shorts renderers keep portrait thumbnails, deduplicate and reject external destinations', () => {
  const modern = { shortsLockupViewModel: {
    overlayMetadata: { primaryText: { content: 'Modern short' } },
    thumbnail: { sources: [{ url: 'https://i.ytimg.com/vi/modern/portrait.jpg' }] },
    onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'modern' } } }
  } };
  const result = parseYouTubeJsBrowse({ contents: [
    { reelItemRenderer: { videoId: 'legacy', headline: { simpleText: 'Legacy short' } } }, modern, modern,
    { reelItemRenderer: { videoId: 'unsafe', headline: { simpleText: 'Unsafe' }, navigationEndpoint: {
      commandMetadata: { webCommandMetadata: { url: 'https://evil.test/shorts/unsafe' } }
    } } }
  ] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['short:legacy', 'short:modern']);
  assert.equal(result.items[1].href, '/shorts/modern');
  assert.equal(result.items[1].thumbnail, 'https://i.ytimg.com/vi/modern/portrait.jpg');
  assert.equal(result.items[0].thumbnailFallback, 'https://i.ytimg.com/vi/legacy/hqdefault.jpg');
});

for (const [pathname, search, browseId] of [
  ['/feed/subscriptions', '', 'FEsubscriptions'],
  ['/playlist', '?list=PLordinary', 'VLPLordinary'],
  ['/playlist', '?list=WL', 'VLWL']
]) test(`${browseId} first page and pagination do not read native DOM`, async () => {
  const calls = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname, search, origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      return { ok: true, json: async () => ({ contents: [
        { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'Video' } } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
      ] }) };
    }
  });
  const service = createYouTubeFeedService();
  const first = await service.request('all');
  const second = await service.request('all', first.nextPage);
  assert.equal(first.items[0].id, 'video:first');
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(calls[0].body.browseId, browseId);
  assert.equal(calls[1].body.continuation, 'next');
  assert.ok(calls.every(call => call.url === '/youtubei/v1/browse'));
});

for (const pathname of ['/@creator/videos', '/channel/UCcreator/shorts', '/c/Creator/streams', '/user/Creator'])
test(`channel ${pathname} resolves its endpoint and tab params without native DOM`, async () => {
  const calls = [];
  const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: id } } });
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname, search: '', origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      if (url.endsWith('/resolve_url')) return { ok: true, json: async () => ({
        endpoint: { browseEndpoint: { browseId: 'UCcreator', params: 'opaque-tab-params' } }
      }) };
      return { ok: true, json: async () => body.continuation ? video('second') : ({ contents: { twoColumnBrowseResultsRenderer: { tabs: [
        { tabRenderer: { selected: false, content: { sectionListRenderer: { contents: [video('wrong-tab'), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'wrong-next' } } } }] } } } },
        { tabRenderer: { selected: true, content: { sectionListRenderer: { contents: [video('first'), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'channel-next' } } } }] } } } }
      ] } } }) };
    }
  });
  const service = createYouTubeFeedService();
  const first = await service.request('all');
  assert.deepEqual(Array.from(first.items, item => item.id), ['video:first']);
  assert.equal(calls[0].body.url, `https://www.youtube.com${pathname}`);
  assert.equal(calls[1].body.browseId, 'UCcreator');
  assert.equal(calls[1].body.params, 'opaque-tab-params');
  const next = await service.request('all', first.nextPage);
  assert.equal(next.items[0].id, 'video:second');
  assert.equal(calls[2].body.continuation, 'channel-next');
  assert.equal(calls.length, 3, 'pagination must not resolve the channel again');
});

test('a channel navigation during URL resolution prevents a stale browse request', async () => {
  const location = { pathname: '/@creator/videos', search: '', origin: 'https://www.youtube.com' };
  const calls = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async url => {
      calls.push(url); location.pathname = '/feed/subscriptions';
      return { ok: true, json: async () => ({ endpoint: { browseEndpoint: { browseId: 'UCcreator' } } }) };
    }
  });
  await assert.rejects(createYouTubeFeedService().request('all'), /cancelled/);
  assert.equal(calls.length, 1);
});

test('personal feeds ignore stale homepage filter endpoints in startup JSON', async () => {
  let requestBody;
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/feed/subscriptions', search: '', origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw new Error('native DOM read'); }, querySelectorAll() { throw new Error('native DOM read'); } },
    window: {
      ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined },
      ytInitialData: { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true,
        navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } } } }
    },
    fetch: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ contents: [] }) }; }
  });
  await createYouTubeFeedService().request('all');
  assert.equal(requestBody.browseId, 'FEsubscriptions');
});

test('feed parses legacy videos and modern lockups, deduplicates IDs and keeps continuation', () => {
  const response = { onResponseReceivedActions: [{ reloadContinuationItemsCommand: { continuationItems: [
    { richItemRenderer: { content: { videoRenderer: { videoId: 'legacy', title: { runs: [{ text: 'Legacy title' }] },
      ownerText: { simpleText: 'Creator' }, thumbnail: { thumbnails: [{ url: 'javascript:alert(1)' }] } } } } },
    { videoRenderer: { videoId: 'legacy', title: { simpleText: 'Updated title' } } },
    { lockupViewModel: { contentId: 'modern', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      metadata: { lockupMetadataViewModel: { title: { content: 'Modern title' } } },
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/modern/mqdefault.jpg' }] } } } } },
    { videoRenderer: { videoId: '../unsafe', title: { simpleText: 'Invalid' } } },
    { lockupViewModel: { contentId: 'playlist', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
    { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }
  ] } }] };
  const result = parseYouTubeJsBrowse(response);
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:legacy', 'video:modern']);
  assert.equal(result.items[0].title, 'Updated title');
  assert.equal(result.items[0].thumbnail, 'https://i.ytimg.com/vi/legacy/hqdefault.jpg');
  assert.equal(result.items[1].title, 'Modern title');
  assert.equal(result.continuation, 'next');
});

test('category endpoints accept browse/search fields and reject arbitrary commands', () => {
  const browse = listEndpoint(new YouTubeJs.YTNodes.NavigationEndpoint({ browseEndpoint: { browseId: 'FEwhat_to_watch', params: 'filter', injected: 'ignored' } }));
  assert.equal(browse.path, 'browse');
  assert.deepEqual(Object.keys(browse.body), ['browseId', 'params']);
  const search = listEndpoint(new YouTubeJs.YTNodes.NavigationEndpoint({ searchEndpoint: { query: 'music', params: 'filter' } }));
  assert.equal(search.path, 'search');
  assert.equal(search.body.query, 'music');
  assert.equal(listEndpoint(new YouTubeJs.YTNodes.NavigationEndpoint({ commandMetadata: { webCommandMetadata: { apiUrl: 'https://evil.test/' } }, arbitraryEndpoint: {} })), undefined);
});

test('watch later parses playlist videos, retains queue positions and skips unavailable entries', () => {
  const { items } = parseYouTubeJsBrowse({ contents: [
    { playlistVideoRenderer: { videoId: 'saved', title: { simpleText: 'Saved video' },
      shortBylineText: { simpleText: 'Creator' }, isPlayable: true,
      navigationEndpoint: { watchEndpoint: { videoId: 'saved', playlistId: 'WL', index: 3 } } } },
    { playlistVideoRenderer: { videoId: 'private', title: { simpleText: 'Private video' }, isPlayable: false } }
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'playlist:WL:saved');
  assert.equal(items[0].href, '/watch?v=saved&list=WL&index=4');
  assert.equal(items[0].channel, 'Creator');
});

for (const [pathname, search, browseId, label] of [
  ['/feed/subscriptions', '', 'FEsubscriptions', '订阅'],
  ['/feed/history', '', 'FEhistory', '历史记录'],
  ['/playlist', '?list=WL', 'VLWL', '稍后观看']
]) {
  test(`personal feed ${browseId} loads and paginates without filter chips`, async () => {
    const bodies = [];
    const { createYouTubeFeedService } = load('sites/youtube-feed', {
      location: { pathname, search, origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
      document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
      window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
      fetch: async (_url, options) => {
        const body = JSON.parse(options.body); bodies.push(body);
        return { ok: true, json: async () => ({ contents: [
          { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'Video' } } },
          ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
        ] }) };
      }
    });
    const service = createYouTubeFeedService();
    assert.equal(service.categories()[0].label, label);
    const first = await service.request('all');
    assert.equal(first.items[0].id, 'video:first');
    assert.equal(bodies[0].browseId, browseId);
    const second = await service.request('all', first.nextPage);
    assert.equal(second.items[0].id, 'video:second');
    assert.equal(bodies[1].continuation, 'next');
    assert.equal(second.nextPage, undefined);
  });
}

test('mixes and playlists retain their playback queue and coexist with the same standalone video', () => {
  const { items } = parseYouTubeJsBrowse({ contents: [
    { videoRenderer: { videoId: 'first', title: { simpleText: 'Single video' } } },
    { radioRenderer: { playlistId: 'RDfirst', title: { simpleText: 'Mix' },
      navigationEndpoint: { watchEndpoint: { videoId: 'first', playlistId: 'RDfirst', startRadio: true } } } },
    { lockupViewModel: { contentId: 'PLmusic', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
      rendererContext: { commandContext: { onTap: { innertubeCommand: {
        watchEndpoint: { videoId: 'first', playlistId: 'PLmusic', index: 2, params: 'queue-token' }
      } } } },
      metadata: { lockupMetadataViewModel: { title: { content: 'Playlist' } } },
      contentImage: { collectionThumbnailViewModel: { stackColor: { lightTheme: 0xc6a1a1, darkTheme: 0x805858 }, primaryThumbnail: { thumbnailViewModel: {
        image: { sources: [{ url: 'https://i.ytimg.com/vi/first/mqdefault.jpg' }] }
      } } } } } },
    { playlistRenderer: { playlistId: 'PLlegacy', title: { simpleText: 'Legacy playlist' },
      videos: [{ childVideoRenderer: { videoId: 'first' } }],
      navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'PLlegacy' } } } },
    { lockupViewModel: { contentId: 'PLurl', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
      metadata: { lockupMetadataViewModel: { title: { content: 'URL playlist' } } },
      rendererContext: { commandContext: { onTap: { innertubeCommand: { commandMetadata: {
        webCommandMetadata: { url: '/watch?v=first&list=PLurl&index=2' }
      } } } } } } },
    { playlistRenderer: { playlistId: 'PLmissing', title: { simpleText: 'No playable video' } } },
    { radioRenderer: { title: { simpleText: 'Unsafe' }, navigationEndpoint: {
      commandMetadata: { webCommandMetadata: { url: 'https://evil.test/watch?v=first&list=RDfirst' } }
    } } }
  ] });
  assert.deepEqual(Array.from(items, item => item.id), [
    'video:first', 'playlist:RDfirst:first', 'playlist:PLmusic:first', 'playlist:PLlegacy:first', 'playlist:PLurl:first'
  ]);
  assert.equal(items[1].href, '/watch?v=first&list=RDfirst&start_radio=1');
  assert.equal(items[2].href, '/watch?v=first&list=PLmusic&index=3&params=queue-token');
  assert.equal(items[2].thumbnail, 'https://i.ytimg.com/vi/first/mqdefault.jpg');
  assert.equal(items[2].stackColorLight, '#c6a1a1');
  assert.equal(items[2].stackColorDark, '#805858');
  assert.equal(items[3].href, '/watch?v=first&list=PLlegacy');
  assert.equal(items[4].href, '/watch?v=first&list=PLurl&index=2');
});

test('playlist colors preserve black, normalize ARGB and reject invalid CSS values', () => {
  const { playlistColor } = modules['../shared/playlist-colors'];
  assert.equal(playlistColor(0), '#000000');
  assert.equal(playlistColor(0xffc6a1a1), '#c6a1a1ff');
  for (const invalid of [-1, 1.5, NaN, Infinity, 0x100000000, 'url(https://evil.test)', '#fff', null])
    assert.equal(playlistColor(invalid), undefined);
});

test('cached pagination survives SPA return and cannot be used on a different route', async () => {
  const location = { pathname: '/', search: '', origin: 'https://www.youtube.com' };
  const bodies = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', { location, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientName: 'WEB', clientVersion: 'test' } } : undefined },
      ytInitialData: { chipCloudChipRenderer: { text: { simpleText: 'All' }, isSelected: true } } },
    fetch: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({
      continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'cached-next' } } }
    }) }; }
  });
  const service = createYouTubeFeedService();
  const first = await service.request('all');
  location.pathname = '/feed/subscriptions';
  await assert.rejects(service.request('all', first.nextPage), /Category unavailable/);
  location.pathname = '/';
  await service.request('all', first.nextPage);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].continuation, 'cached-next');
});

test('first page, filters and continuations only use API responses', async () => {
  const bodies = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/', search: '', origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector() { throw Error('Native DOM read'); }, querySelectorAll() { throw Error('Native DOM read'); } },
    window: { get ytInitialData() { throw Error('Startup JSON read'); },
      ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      return { ok: true, json: async () => ({ contents: [
        { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'API video' } } },
        { chipCloudChipRenderer: { text: { simpleText: 'Music' }, navigationEndpoint: { browseEndpoint: { browseId: 'music' } } } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'api-next' } } } }] : [])
      ] }) };
    }
  });
  const service = createYouTubeFeedService();
  assert.deepEqual(Array.from(service.categories(), item => item.id), ['all']);
  const first = await service.request('all');
  assert.equal(first.items[0].id, 'video:first');
  assert.equal(bodies[0].browseId, 'FEwhat_to_watch');
  assert.deepEqual(Array.from(service.categories(), item => item.id), ['all', 'music']);
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(bodies[1].continuation, 'api-next');
  await service.request('music');
  assert.equal(bodies[2].browseId, 'music');
  await service.request('all');
  assert.equal(bodies[3].browseId, 'FEwhat_to_watch');
});

for (const [pathname, search, path] of [['/', '', 'browse'], ['/results', '?search_query=music&sp=original', 'search']]) {
  test(`${path} first page, response filters and pagination never inspect native DOM`, async () => {
    const calls = [];
    const location = { pathname, search, origin: 'https://www.youtube.com' };
    const { createYouTubeFeedService } = load('sites/youtube-feed', {
      location, AbortController, setTimeout, clearTimeout,
      document: { cookie: '', querySelector() { throw new Error('Native page data read'); },
        querySelectorAll() { throw new Error('Native category scan'); } },
      window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
      fetch: async (url, options) => {
        const body = JSON.parse(options.body); calls.push({ url, body });
        return { ok: true, json: async () => ({ contents: [
          { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'Video' } } },
          { chipCloudChipRenderer: { text: { simpleText: 'Music' }, navigationEndpoint: path === 'browse' ?
            { browseEndpoint: { browseId: 'music', params: 'filtered' } } :
            { searchEndpoint: { query: 'music', params: 'filtered' } } } },
          ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
        ] }) };
      }
    });
    const service = createYouTubeFeedService();
    assert.equal(service.categories()[0].id, 'all');
    const first = await service.request('all');
    assert.equal(first.items[0].id, 'video:first');
    assert.equal(calls[0].url, `/youtubei/v1/${path}`);
    if (path === 'search') assert.equal(calls[0].body.params, 'original');
    assert.deepEqual(Array.from(service.categories(), item => item.id), ['all', 'music']);
    await service.request('music');
    assert.equal(calls[1].body.params, 'filtered');
    const second = await service.request('all', first.nextPage);
    assert.equal(second.items[0].id, 'video:second');
    assert.equal(calls[2].body.continuation, 'next');
    assert.equal(second.nextPage, undefined);
    location.pathname = '/results'; location.search = '?search_query=different';
    assert.deepEqual(Array.from(service.categories(), item => item.id), ['all']);
    await assert.rejects(service.request('all', first.nextPage), /Category unavailable/);
    location.pathname = pathname; location.search = search;
    assert.deepEqual(Array.from(service.categories(), item => item.id), ['all', 'music']);
  });
}

test('home starts from session config without native data and discovers response filters', async () => {
  const bodies = [];
  const location = { pathname: '/', search: '', origin: 'https://www.youtube.com' };
  let context;
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? context : undefined } },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      return { ok: true, json: async () => ({ contents: [
        { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'Video' } } },
        { chipCloudChipRenderer: { text: { simpleText: 'Music' },
          navigationEndpoint: { browseEndpoint: { browseId: 'music' } } } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next' } } } }] : [])
      ] }) };
    }
  });
  const service = createYouTubeFeedService();
  assert.equal(service.categories().length, 0);
  context = { client: { clientName: 'WEB', clientVersion: 'test' } };
  assert.equal(service.categories()[0].id, 'all');
  const first = await service.request('all');
  assert.equal(first.items[0].id, 'video:first');
  assert.equal(bodies[0].browseId, 'FEwhat_to_watch');
  assert.deepEqual(Array.from(service.categories(), item => item.id), ['all', 'music']);
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(bodies[1].continuation, 'next');
  await service.request('music');
  assert.equal(bodies[2].browseId, 'music');
  location.pathname = '/results';
  assert.equal(service.categories().length, 0, 'home bootstrap and filters must not leak to search');
});

test('synthetic All does not reuse the native feed of a selected home filter', async () => {
  const bodies = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/', search: '', origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { ytcfg: { get: () => ({ client: { clientVersion: 'test' } }) }, ytInitialData: { contents: [
      { chipCloudChipRenderer: { text: { simpleText: 'Music' }, isSelected: true,
        navigationEndpoint: { browseEndpoint: { browseId: 'music' } } } },
      { videoRenderer: { videoId: 'music', title: { simpleText: 'Music video' } } }
    ] } },
    fetch: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({
      videoRenderer: { videoId: 'home', title: { simpleText: 'Home video' } }
    }) }; }
  });
  const service = createYouTubeFeedService();
  const result = await service.request('all');
  assert.equal(result.items[0].id, 'video:home');
  assert.equal(bodies[0].browseId, 'FEwhat_to_watch');
  assert.deepEqual(Array.from(service.categories(), item => item.id), ['all']);
  await assert.rejects(service.request('music'), /Category unavailable/);
});

test('search without chips keeps filters and uses the search endpoint for continuation', async () => {
  const calls = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/results', search: '?search_query=music&sp=filter-token', origin: 'https://www.youtube.com' },
    AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ contents: [
        { videoRenderer: { videoId: 'result', title: { simpleText: 'Result' } } },
        { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'same-next' } } } }
      ] }) };
    }
  });
  const service = createYouTubeFeedService();
  const first = await service.request('all');
  assert.equal(calls[0].url, '/youtubei/v1/search');
  assert.equal(calls[0].body.query, 'music');
  assert.equal(calls[0].body.params, 'filter-token');
  const second = await service.request('all', first.nextPage);
  assert.equal(calls[1].url, '/youtubei/v1/search');
  assert.equal(calls[1].body.continuation, 'same-next');
  assert.equal(second.nextPage, undefined, 'a repeated continuation must stop instead of looping');
});

test('history without chips loads its first page and continuation through the API', async () => {
  const calls = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname: '/feed/history', search: '', origin: 'https://www.youtube.com' },
    AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { get ytInitialData() { throw Error('Startup JSON read'); },
      ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      return { ok: true, json: async () => ({ contents: [
        { videoRenderer: { videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'History' } } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'creator-next' } } } }] : [])
      ] }) };
    }
  });
  const service = createYouTubeFeedService();
  const first = await service.request('all');
  assert.equal(first.items[0].id, 'video:first');
  assert.equal(calls[0].body.browseId, 'FEhistory');
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(calls[1].body.continuation, 'creator-next');
  assert.equal(second.nextPage, undefined);
});

for (const [pathname, browseId] of [
  ['/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'UC-9-kyTW8ZkZNDHQJ6FgpwQ'],
  ['/feed/storefront', 'FEstorefront'],
  ['/channel/UC4R8DWoMoI7CAwX8_LjQHig', 'UC4R8DWoMoI7CAwX8_LjQHig']
]) test(`explore page ${pathname} requests its own feed and continuation without native cards`, async () => {
  const calls = [];
  const { createYouTubeFeedService } = load('sites/youtube-feed', {
    location: { pathname, search: '', origin: 'https://www.youtube.com' }, AbortController, setTimeout, clearTimeout,
    document: { cookie: '', querySelector: () => null, querySelectorAll: () => [] },
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { clientVersion: 'test' } } : undefined } },
    fetch: async (_url, options) => { const body = JSON.parse(options.body); calls.push(body);
      return { ok: true, json: async () => ({ contents: [
        { [browseId === 'FEstorefront' ? 'movieRenderer' : 'videoRenderer']: {
          videoId: body.continuation ? 'second' : 'first', title: { simpleText: 'Explore video' }
        } },
        ...(!body.continuation ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'explore-next' } } } }] : [])
      ] }) }; }
  });
  const service = createYouTubeFeedService();
  assert.equal(service.categories()[0].id, 'all');
  const first = await service.request('all');
  assert.equal(first.items[0].id, 'video:first');
  assert.equal(calls[0].browseId, browseId);
  const second = await service.request('all', first.nextPage);
  assert.equal(calls[1].continuation, 'explore-next');
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(second.nextPage, undefined);
});
