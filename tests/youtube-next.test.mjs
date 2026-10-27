import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
import * as YouTubeJs from 'youtubei.js/web';
import { modernVideo } from './helpers/modern-video.mjs';

function load(context = {}) {
  const cache = new Map();
  function module(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    const exports = {}; cache.set(url.href, exports);
    const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { exports, Headers, Request, Response, structuredClone, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, TextEncoder, ...context,
      require: name => name === 'youtubei.js/web' ? YouTubeJs : module(new URL(name + '.ts', url)) });
    return exports;
  }
  return module(new URL('../src/sites/youtube-next.ts', import.meta.url));
}
const compact = id => ({ compactVideoRenderer: { videoId: id, title: { simpleText: id }, shortBylineText: { simpleText: 'Creator' }, lengthText: { simpleText: '3:00' } } });
const continuation = token => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
const queueVideo = (id, index, selected = false) => ({ playlistPanelVideoRenderer: {
  videoId: id, title: { simpleText: id }, selected,
  navigationEndpoint: { watchEndpoint: { videoId: id, playlistId: 'PLtest', index } }
} });
const response = (related = [compact('related'), continuation('related-page')], queue = [queueVideo('current', 0, true), queueVideo('same', 1), queueVideo('same', 2), continuation('queue-page')]) => ({
  contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: related } }, playlist: { playlist: { playlistId: 'PLtest', contents: queue } } } }
});
const settle = () => new Promise(resolve => setImmediate(resolve));

test('modern recommendations retain views, publication time and thumbnail duration', () => {
  const { parseWatchNext } = load();
  const card = parseWatchNext(response([modernVideo('related', 42)], []), 'current').recommendations[0];
  assert.equal(card.metadata, '1694万次观看 · 9年前');
  assert.equal(card.duration, '8:47');
  assert.equal(card.watchedPercent, 42);
});

test('recommendation snapshots retain explicit owner verification badges', () => {
  const { parseWatchNext } = load();
  const verified = compact('verified');
  verified.compactVideoRenderer.ownerBadges = [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }];
  const cards = parseWatchNext(response([verified, compact('ordinary')], []), 'current').recommendations;
  assert.equal(cards[0].channelBadge, 'verified');
  assert.equal(cards[1].channelBadge, undefined);
});

test('next parses only related results and queue; preserves repeated queue positions and ignores ads', () => {
  const { parseWatchNext } = load();
  const raw = response([compact('current'), compact('related'), compact('related'), { adSlotRenderer: { content: compact('advert') } }, continuation('related-page')]);
  raw.contents.twoColumnWatchNextResults.playlist.playlist.title = 'My collection';
  raw.comments = compact('comment-video');
  const result = parseWatchNext(raw, 'current');
  assert.deepEqual(Array.from(result.recommendations, item => item.label), ['related']);
  assert.equal(result.recommendations[0].duration, '3:00');
  assert.deepEqual(Array.from(result.queue, item => item.href), ['/watch?v=current&list=PLtest&index=1', '/watch?v=same&list=PLtest&index=2', '/watch?v=same&list=PLtest&index=3']);
  assert.equal(result.queue[0].selected, true);
  assert.equal(result.playlistTitle, 'My collection');
  assert.equal(result.queueContinuation, 'queue-page');
  assert.equal(result.recommendationContinuation, 'related-page');
});

test('recommendation and queue continuation responses keep separate tokens', () => {
  const { parseWatchNext } = load();
  const raw = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [queueVideo('last', 3), continuation('queue-last')] } }] };
  const queue = parseWatchNext(raw, 'current', 'queue', 'PLtest');
  assert.equal(queue.queue[0].href, '/watch?v=last&list=PLtest&index=4');
  assert.equal(queue.queueContinuation, 'queue-last');
  assert.equal(queue.recommendationContinuation, undefined);
  assert.equal(queue.recommendations.length, 0);
  const related = parseWatchNext({ onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: [compact('last'), continuation('related-last')] } }] }, 'current', 'recommendations');
  assert.equal(related.recommendations[0].label, 'last');
  assert.equal(related.recommendationContinuation, 'related-last');
});

test('library normalizes card metadata while repeated queue positions and Mix parameters remain unchanged', () => {
  const { parseWatchNext } = load();
  const related = compact('related');
  delete related.compactVideoRenderer.lengthText;
  related.compactVideoRenderer.thumbnailOverlays = [{ thumbnailOverlayTimeStatusRenderer: {
    text: { simpleText: '12:34' }, style: 'DEFAULT'
  } }];
  const images = [
    { url: 'https://i.ytimg.com/vi/same/large.jpg', width: 1280 },
    { url: 'https://i.ytimg.com/vi/same/small.jpg', width: 120 }
  ];
  related.compactVideoRenderer.thumbnail = { thumbnails: images };
  const queue = [queueVideo('same', 1, true), queueVideo('same', 5)];
  for (const entry of queue) {
    entry.playlistPanelVideoRenderer.thumbnail = { thumbnails: images };
    entry.playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint.params = 'mix-params';
    entry.playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint.startRadio = true;
  }
  const result = parseWatchNext(response([related], queue), 'current');
  assert.equal(result.recommendations[0].duration, '12:34', 'duration is parsed from the library overlay');
  assert.equal(result.recommendations[0].channel, 'Creator');
  assert.equal(result.recommendations[0].thumbnail, images[0].url);
  assert.equal(result.queue.length, 2);
  assert.notEqual(result.queue[0].key, result.queue[1].key);
  for (let index = 0; index < 2; index++) {
    const item = result.queue[index], url = new URL(item.href, 'https://www.youtube.com');
    assert.equal(url.searchParams.get('index'), index ? '6' : '2');
    assert.equal(url.searchParams.get('params'), 'mix-params');
    assert.equal(url.searchParams.get('start_radio'), '1');
    assert.equal(item.selected, index === 0);
    assert.equal(item.thumbnail, images[0].url);
  }
});

test('modern cards and optional thumbnail defaults use the same library parser without losing adjacent cards or tokens', () => {
  const { parseWatchNext } = load();
  const lockup = { lockupViewModel: { contentId: 'modern', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    metadata: { lockupMetadataViewModel: { title: { content: 'Modern card' } } },
    contentImage: { thumbnailViewModel: { image: { sources: [{ url: 'https://i.ytimg.com/vi/modern/large.jpg' }] } } }
  } };
  const malformed = compact('malformed');
  malformed.compactVideoRenderer.thumbnail = { thumbnails: 'invalid-array' };
  const result = parseWatchNext(response([compact('first'), lockup, malformed, compact('last'), continuation('next')], []), 'current');
  assert.deepEqual(Array.from(result.recommendations, item => item.label), ['first', 'Modern card', 'malformed', 'last']);
  assert.equal(result.recommendations[2].thumbnail, 'https://i.ytimg.com/vi/malformed/hqdefault.jpg');
  assert.equal(result.recommendationContinuation, 'next');
});

test('parsed playlist wrappers retain only the primary queue entry and modern continuation objects', () => {
  const { parseWatchNext } = load();
  const raw = response([], [{ playlistPanelVideoWrapperRenderer: {
    primaryRenderer: queueVideo('primary', 2), counterpart: [{ counterpartRenderer: queueVideo('alternate', 2) }]
  } }, { continuationItemViewModel: { continuationCommand: { continuationCommand: { token: 'modern-queue' } } } }]);
  const before = JSON.stringify(raw);
  const result = parseWatchNext(raw, 'current');
  assert.deepEqual(Array.from(result.queue, item => item.href), ['/watch?v=primary&list=PLtest&index=3']);
  assert.equal(result.queueContinuation, 'modern-queue');
  assert.equal(result.recommendationContinuation, undefined);
  assert.equal(JSON.stringify(raw), before, 'library defaults must not mutate shared cached responses');
});

function fixture() {
  let now = 100, configReady = true;
  let updates = 0;
  const document = new EventTarget(); document.cookie = '';
  document.addEventListener('ytg-watch-next-updated-v1', () => updates++);
  const location = { pathname: '/watch', search: '?v=current&list=PLtest&index=1', origin: 'https://www.youtube.com' };
  const calls = [];
  const { createWatchNextService } = load({ location, document, Event, Date: { now: () => now },
    window: { ytcfg: { get: key => configReady && ({ INNERTUBE_CONTEXT: { client: { clientVersion: 'test' } }, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand-channel' })[key] } },
    fetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      calls.push({ url, ...options, body: JSON.parse(options.body), resolve: data => resolve({ ok: true, json: async () => data }), reject });
    }) });
  return { service: createWatchNextService(), calls, location, get updates() { return updates; }, advance: ms => { now += ms; }, ready: value => { configReady = value; } };
}

test('next requests carry playlist context; pagination locks and return restores cached data', async () => {
  const f = fixture();
  try {
    assert.equal(f.service.read().loading, true);
    f.service.read(); f.service.more();
    await settle();
    assert.equal(f.calls.length, 1);
    const first = f.calls[0];
    assert.equal(first.url, '/youtubei/v1/next');
    assert.equal(first.credentials, 'same-origin');
    assert.equal(first.body.playlistId, 'PLtest');
    assert.equal(first.body.index, 0);
    assert.equal(first.headers['x-goog-authuser'], '2');
    assert.equal(first.headers['x-goog-pageid'], 'brand-channel');
    first.resolve(response()); await settle();
    assert.equal(f.updates, 1, 'API completion notifies the view without native DOM activity');
    f.service.more(); f.service.more();
    await settle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].body.continuation, 'queue-page');
    f.calls[1].resolve({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [queueVideo('last', 3)] } }] }); await settle();
    assert.equal(f.service.read().queue.length, 4);
    f.service.more(); await settle(); assert.equal(f.calls[2].body.continuation, 'related-page');
    f.calls[2].resolve({ onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: [compact('related'), compact('new')] } }] }); await settle();
    assert.equal(f.service.read().recommendations.length, 2);
    assert.equal(f.service.more(), false);
    f.location.search = '?v=other'; f.service.routeChanged();
    assert.equal(f.service.read().recommendations.length, 0);
    await settle();
    f.location.search = '?v=current&list=PLtest&index=1'; f.service.routeChanged();
    assert.equal(f.service.read().recommendations.length, 2);
    await settle();
    assert.equal(f.calls.length, 4);
  } finally { f.service.destroy(); }
});

test('route changes cancel old requests and discard late responses', async () => {
  const f = fixture();
  try {
    f.service.read();
    await settle();
    f.location.search = '?v=other'; f.service.routeChanged(); f.service.read();
    await settle();
    assert.equal(f.calls[0].signal.aborted, true);
    f.calls[0].resolve(response()); await settle();
    assert.equal(f.updates, 0, 'a stale response cannot notify the new route');
    assert.equal(f.service.read().queue.length, 0);
    assert.equal(f.service.read().loading, true);
    f.calls[1].resolve(response([compact('new')], [])); await settle();
    assert.equal(f.updates, 1);
    assert.equal(f.service.read().recommendations[0].label, 'new');
    f.service.destroy();
    f.service.read(); assert.equal(f.calls.length, 2);
  } finally { f.service.destroy(); }
});

test('late session config retries; failed pagination retains data and retries the same token', async () => {
  const f = fixture();
  try {
    f.ready(false); f.service.read(); assert.equal(f.calls.length, 0);
    f.ready(true); f.advance(1000); f.service.read();
    await settle();
    f.calls[0].resolve(response()); await settle();
    f.service.more(); await settle(); f.calls[1].resolve({ error: { code: 400 } }); await settle();
    assert.equal(f.updates, 2, 'a failed request also updates the view');
    assert.equal(f.service.read().failed, true);
    assert.equal(f.service.read().queue.length, 3);
    f.service.more(); assert.equal(f.calls.length, 2);
    f.advance(5000); f.service.read();
    await settle();
    assert.equal(f.calls[2].body.continuation, 'queue-page');
    f.calls[2].resolve({ continuationContents: { playlistPanelContinuation: { contents: [queueVideo('last', 3)] } } }); await settle();
    assert.equal(f.service.read().failed, false);
    assert.equal(f.service.read().queue.length, 4);
  } finally { f.service.destroy(); }
});
