import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';

const modules = {};
function load(file, context = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, URL, require: name => modules[name], ...context });
  return exports;
}
modules['../shared/browse-categories'] = load('shared/browse-categories');
const { parseFeed, feedEndpoint } = load('sites/youtube-feed');

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
  const result = parseFeed(response);
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:legacy', 'video:modern']);
  assert.equal(result.items[0].title, 'Updated title');
  assert.equal(result.items[0].thumbnail, 'https://i.ytimg.com/vi/legacy/hqdefault.jpg');
  assert.equal(result.items[1].title, 'Modern title');
  assert.equal(result.continuation, 'next');
});

test('category endpoints accept browse/search fields and reject arbitrary commands', () => {
  const browse = feedEndpoint({ browseEndpoint: { browseId: 'FEwhat_to_watch', params: 'filter', injected: 'ignored' } });
  assert.equal(browse.path, 'browse');
  assert.deepEqual(Object.keys(browse.body), ['browseId', 'params']);
  const search = feedEndpoint({ searchEndpoint: { query: 'music', params: 'filter' } });
  assert.equal(search.path, 'search');
  assert.equal(search.body.query, 'music');
  assert.equal(feedEndpoint({ commandMetadata: { webCommandMetadata: { apiUrl: 'https://evil.test/' } }, arbitraryEndpoint: {} }), undefined);
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
