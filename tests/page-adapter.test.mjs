import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
import { moduleGraph, resolveModule } from '../scripts/module-graph.mjs';

function assertMainBoundary(graph) {
  for (const [file, imports] of graph) {
    assert.ok(/^src\/(?:sites|shared)\//.test(file) ||
      ['src/entries/main.ts', 'src/bridge/page-server.ts', 'src/bridge/page-protocol.ts'].includes(file),
      `Application dependency leaked into MAIN: ${file}`);
    for (const name of imports) {
      if (!name.startsWith('.')) {
        assert.ok(file.startsWith('src/sites/') && name === 'youtubei.js/web', `External runtime imported by MAIN: ${name} in ${file}`);
      } else {
        assert.ok(resolveModule(file, name)?.endsWith('.ts'), `Non-data module imported by MAIN: ${name}`);
      }
    }
    if (file.startsWith('src/shared/')) {
      const ast = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true);
      function checkShared(node) {
        if (ts.isIdentifier(node)) assert.ok(!['window', 'document', 'chrome', 'globalThis', 'localStorage', 'sessionStorage'].includes(node.text),
          `Browser state imported by MAIN shared helper: ${file} (${node.text})`);
        ts.forEachChild(node, checkShared);
      }
      checkShared(ast);
    }
  }
}

test('production MAIN runtime graph contains only page adapters and pure shared helpers', () => {
  assertMainBoundary(moduleGraph(['src/entries/main.ts']));
});

test('MAIN boundary rejects UI, application state, browser helpers and external runtime leaks', () => {
  for (const file of ['src/ui/menu.ts', 'src/app/state-machine.ts', 'src/shared/page-dom.ts'])
    assert.throws(() => assertMainBoundary(new Map([[file, []]])), /Application dependency|Browser state/);
  assert.throws(() => assertMainBoundary(new Map([['src/sites/youtube-session.ts', ['vue']]])), /External runtime/);
  assert.throws(() => assertMainBoundary(new Map([['src/shared/home-filter.ts', ['../ui/VideoCard.vue']]])), /Non-data module/);
});

function load(file, context, modules = {}, cache = new Map()) {
  const path = `src/${file}.ts`;
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(source, { ...context, exports, require: name => {
    if (Object.hasOwn(modules, name)) return modules[name];
    const target = resolveModule(path, name);
    assert.ok(target?.startsWith('src/') && target.endsWith('.ts'), `Unexpected runtime dependency: ${name}`);
    return load(target.slice(4, -3), context, {}, cache);
  } });
  return exports;
}

function fixture() {
  const document = new EventTarget(), window = new EventTarget();
  let player;
  let details;
  document.querySelector = () => player;
  const context = { document, window, CustomEvent, URL, URLSearchParams, setTimeout, clearTimeout, crypto: { randomUUID: () => 'test' },
    history: { pushState() {}, replaceState() {} }, location: { pathname: '/', search: '' } };
  const languages = load('shared/comment-language', context);
  const protocol = load('bridge/page-protocol', context, { '../shared/watch-link': load('shared/watch-link', context), '../shared/comment-language': languages });
  const sidebarData = load('shared/sidebar-data', context);
  const modules = { '../sites/youtube-notifications': { notificationSnapshot: value => value, createNotificationService: () => ({ read: async () => ({}), destroy() {} }) }, './page-protocol': protocol, '../shared/watch-link': load('shared/watch-link', context), '../shared/sidebar-data': sidebarData, '../shared/comment-language': languages };
  const server = load('bridge/page-server', context, { ...modules,
    '../sites/youtube-shorts': { createShortsService: () => ({ read: async () => ({ ids: ['second'], hasMore: true }), destroy() {} }) },
    '../sites/youtube-sidebar': { createSidebarService: () => ({ read: async () => ({
      sections: [{ id: 'primary', entries: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }] }] }), destroy() {} }) },
    '../sites/youtube-account': { createAccountService: () => ({ read: async () => ({ signedIn: false, accounts: [] }), destroy() {} }) },
    '../sites/youtube-watch-data': { createWatchDataService: () => ({ routeChanged() {}, destroy() {} }) },
    '../sites/youtube-watch-info': { createWatchInfoService: () => ({ read: () => ({ route: '/', details }),
      act: async () => false, listPlaylists: async () => [], togglePlaylist: async () => false, routeChanged() {}, destroy() {} }) },
    '../shared/explore-pages': load('shared/explore-pages', context),
    '../sites/youtube-comments': { createCommentsService: () => ({ read: () => ({ route: '/', items: [], loading: false, failed: false, hasMore: false }), more: () => false, replies: () => false, routeChanged() {}, destroy() {} }) },
    '../sites/youtube-feed': { createYouTubeFeedService: () => ({ cancel() {}, categories: () => [] }) },
    '../sites/youtube-next': { createWatchNextService: () => ({ read: () => ({ route: '/watch?v=first', recommendations: [], queue: [], loading: false, failed: false }), more: () => true, routeChanged() {}, destroy() {} }) } });
  const client = load('bridge/page-client', context, modules).createPageClient();
  return { document, window, context, protocol, server, client, setPlayer: value => { player = value; }, setDetails: value => { details = value; } };
}

test('Shorts settings bridge bounds qualities, targets the current video and rejects stale commands', () => {
  const f = fixture(), dispose = f.server.startPageServer();
  f.context.location.pathname = '/shorts/current';
  let videoId = 'current', captions = false, quality = 'hd1080';
  const player = { getVideoData: () => ({ video_id: videoId }),
    getAvailableQualityLevels: () => ['hd1080', 'hd720', 'private-quality'], getPlaybackQuality: () => quality,
    setPlaybackQualityRange: value => { quality = value; }, getOption: () => [{ languageCode: 'en', private: 'hidden' }],
    isSubtitlesOn: () => captions, toggleSubtitles: () => { captions = !captions; }, querySelector: () => null };
  f.document.querySelector = () => ({ querySelector: () => player });
  assert.deepEqual(JSON.parse(JSON.stringify(f.client.readShortsSettings())), {
    videoId: 'current', captionsAvailable: true, captionsEnabled: false, qualities: ['auto', 'hd1080', 'hd720'], quality: 'hd1080'
  });
  assert.equal(f.client.shortsSetting('current', 'captions'), true); assert.equal(captions, true);
  assert.equal(f.client.shortsSetting('current', 'quality', 'hd720'), true); assert.equal(quality, 'hd720');
  assert.equal(f.client.shortsSetting('current', 'quality', 'private-quality'), false);
  assert.equal(f.client.shortsSetting('old', 'captions'), false); assert.equal(captions, true);
  videoId = 'old';
  assert.equal(f.client.readShortsSettings(), undefined);
  assert.equal(f.client.shortsSetting('current', 'quality', 'hd1080'), false);
  f.context.location.pathname = '/watch'; assert.equal(f.client.readShortsSettings(), undefined);
  dispose();
});

test('display image URLs reject credentials and unsafe inputs while previews retain their own host and length limits', () => {
  const { safeImageUrl } = load('shared/image-url', { URL });
  const { safePreviewThumbnail } = load('shared/browse-data', { URL });
  const signed = 'https://yt3.ggpht.com/avatar?token=a%2Fb&size=128';
  assert.equal(safeImageUrl(signed), signed);
  for (const value of [undefined, {}, '', '/avatar.png', 'http://example.com/avatar', 'javascript:alert(1)',
    'data:image/png;base64,AAAA', 'https://user:secret@example.com/avatar', 'https://user@example.com/avatar',
    `https://example.com/${'a'.repeat(4096)}`]) assert.equal(safeImageUrl(value), undefined);
  assert.equal(safePreviewThumbnail(signed), undefined);
  const preview = `https://i.ytimg.com/an_webp/video?token=${'a'.repeat(5000)}`;
  assert.equal(safePreviewThumbnail(preview), preview);
  assert.equal(safeImageUrl(preview), undefined);
});

test('sidebar bridge returns API snapshots and filters unsafe links and private fields', async () => {
  const f = fixture(); f.server.startPageServer();
  const sidebar = await f.client.readSidebar();
  assert.deepEqual(JSON.parse(JSON.stringify(sidebar)), {
    sections: [{ id: 'primary', entries: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }] }] });
  const data = load('shared/sidebar-data', f.context);
  const value = data.sidebarSnapshot({ sections: [{ id: 'regional', label: 'Explore', entries: [
    { id: 'music', label: 'x'.repeat(900), href: '/gaming', icon: 'explore', token: 'private' },
    { id: 'evil', label: 'Bad', href: 'https://evil.example/gaming', icon: 'explore' },
    { id: 'credentials', label: 'Bad', href: 'https://user:secret@studio.youtube.com/', icon: 'videos' },
    { id: 'script', label: 'Bad', href: 'javascript:alert(1)', icon: 'explore' }
  ] }] });
  assert.equal(value.sections.length, 1);
  assert.equal(value.sections[0].entries.length, 1); assert.equal(value.sections[0].entries[0].label.length, 200);
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.equal(data.sidebarSnapshot({ personal: [], explore: [] }), undefined);
  assert.equal(data.sidebarSnapshot({ sections: {} }), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(data.sidebarSnapshot({ sections: [] }))), { sections: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(data.sidebarSnapshot({ sections: [], personal: [], explore: [] }))), { sections: [] });
  f.client.destroy();
});

test('MAIN handshake does not require a player and exposes only bounded metadata', () => {
  const f = fixture();
  assert.equal(f.client.ping(), false);
  const dispose = f.server.startPageServer();
  assert.equal(f.client.ping(), true);
  let shown = 0;
  f.setPlayer({ getPlayerResponse() { throw Error('Page JS metadata must not be read'); }, showControls: () => shown++ });
  f.setDetails({ videoId: 'abc', title: 'x'.repeat(5000), shortDescription: 'y'.repeat(30000), isLive: true, secret: 'hidden' });
  const details = f.client.readVideoDetails();
  assert.equal(details.title.length, 2000);
  assert.equal(details.shortDescription.length, 20000);
  assert.equal(details.secret, undefined);
  f.client.showControls();
  assert.equal(shown, 1);
  dispose();
  assert.equal(f.client.ping(), false);
});

test('native playback identity is available independently of API metadata and retains stale identity during navigation', () => {
  const f = fixture(), dispose = f.server.startPageServer();
  let id = 'current';
  f.setPlayer({ getVideoData: () => ({ video_id: id, private: 'hidden' }) });
  assert.equal(f.client.readVideoDetails(), undefined);
  assert.equal(f.client.readPlayerVideoId(), 'current');
  f.context.location.pathname = '/watch'; f.context.location.search = '?v=next';
  assert.equal(f.client.readPlayerVideoId(), 'current', 'the URL alone cannot authorize a reused player');
  f.setPlayer({ getVideoData: () => ({ video_id: 'current' }), getPlayerResponse: () => ({ videoDetails: { videoId: 'next' } }) });
  assert.equal(f.client.readPlayerVideoId(), 'next', 'the destination response can arrive before getVideoData updates');
  f.setPlayer({ getVideoData: () => ({ video_id: id }) });
  id = 'next';
  assert.equal(f.client.readPlayerVideoId(), 'next', 'ready media does not wait for API metadata');
  f.setPlayer({ getVideoData() { throw Error('unavailable'); }, getPlayerResponse: () => ({ videoDetails: { videoId: 'fallback', secret: 'hidden' } }) });
  assert.equal(f.client.readPlayerVideoId(), 'fallback');
  f.setPlayer({ getVideoData: () => ({ video_id: '<unsafe>' }) });
  assert.equal(f.client.readPlayerVideoId(), undefined);
  dispose(); f.client.destroy();
});

test('watch API snapshots and playlist choices retain bounded data only', () => {
  const f = fixture();
  const value = f.protocol.watchInfoSnapshot({ route: '/watch?v=first', details: { videoId: 'first', title: 'x'.repeat(5000), cookie: 'private' },
    avatar: 'javascript:alert(1)', liked: 'yes', subscribed: true, canLike: true, endpoint: { token: 'private' } });
  assert.equal(value.details.title.length, 2000);
  assert.equal(value.avatar, '');
  assert.equal(value.liked, false);
  assert.equal(value.subscribed, true);
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.equal(f.protocol.watchInfoSnapshot({ route: 1 }), undefined);
  const choices = f.protocol.savedPlaylists([{ key: '0', title: 't'.repeat(500), selected: true, token: 'private' },
    { key: 'arbitrary-playlist-id', title: 'Rejected' }]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].title.length, 200);
  assert.equal(JSON.stringify(choices).includes('private'), false);
});

test('account snapshots contain bounded display data without identity commands', async () => {
  const f = fixture();
  const value = f.protocol.accountSnapshot({ signedIn: true, cookie: 'private', accounts: [{ key: '0', name: 'x'.repeat(500),
    handle: '@creator', avatar: 'javascript:alert(1)', selected: true, endpoint: { token: 'private' } }] });
  assert.equal(value.accounts[0].name.length, 200);
  assert.equal(value.accounts[0].avatar, '');
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.equal(f.protocol.accountSnapshot({ signedIn: true }), undefined);
  f.server.startPageServer();
  assert.deepEqual(JSON.parse(JSON.stringify(await f.client.readAccount())), { signedIn: false, accounts: [] });
  f.client.destroy();
});

test('destroying the page client releases pending asynchronous action requests', async () => {
  const f = fixture();
  const pending = f.client.watchAction('like');
  f.client.destroy();
  assert.equal(await pending, false);
  assert.equal(f.client.ping(), false);
});

test('comment snapshots strip private fields and bound text and replies at the bridge', () => {
  const f = fixture();
  const raw = { route: '/watch?v=test', loading: true, failed: false, hasMore: true, token: 'private-token',
    items: [{ key: 'one', author: 'a'.repeat(500), text: 't'.repeat(9000), hasReplies: true,
      repliesLabel: 'Replies', replyCount: 123, replies: [...Array.from({ length: 120 }, (_, index) =>
        ({ key: String(index), author: 'Reply author', text: 'r'.repeat(3000) })), { token: 'private' }] }] };
  const value = f.protocol.commentsSnapshot(raw);
  assert.equal(value.items[0].author.length, 200);
  assert.equal(value.items[0].text.length, 4000);
  assert.equal(value.items[0].replies.length, 100);
  assert.equal(value.items[0].replies[0].text.length, 2000);
  assert.equal(value.items[0].replyCount, 123);
  for (const count of [-1, 1.5, Infinity, '123']) {
    raw.items[0].replyCount = count;
    assert.equal(f.protocol.commentsSnapshot(raw).items[0].replyCount, undefined);
  }
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.equal(f.protocol.commentsSnapshot({ route: 1, items: [] }), undefined);
  raw.items[0].replies = [{ key: 'reply', author: 'a'.repeat(500), text: 'Reply text', endpoint: 'private-token', replies: ['private'] }];
  const structured = f.protocol.commentsSnapshot(raw).items[0];
  assert.deepEqual(JSON.parse(JSON.stringify(structured.replies)), [{ key: 'reply', author: 'a'.repeat(200), text: 'Reply text' }]);
  assert.equal(JSON.stringify(structured).includes('private'), false);
  raw.items[0].avatar = 'https://yt3.ggpht.com/parent=s88';
  raw.items[0].replies[0].avatar = 'https://yt3.ggpht.com/reply=s88';
  const avatars = f.protocol.commentsSnapshot(raw).items[0];
  assert.equal(avatars.avatar, raw.items[0].avatar);
  assert.equal(avatars.replies[0].avatar, raw.items[0].replies[0].avatar);
  raw.items[0].avatar = 'javascript:alert(1)';
  raw.items[0].replies[0].avatar = 'http://example.com/avatar.png';
  const unsafeAvatars = f.protocol.commentsSnapshot(raw).items[0];
  assert.equal(unsafeAvatars.avatar, undefined);
  assert.equal(unsafeAvatars.replies[0].avatar, undefined);
    raw.items[0].translationTarget = 'ja';
    raw.items[0].replies[0].translationTarget = 'de';
  raw.items[0].translation = { language: 'ja', text: 't'.repeat(9000), loading: false, failed: false, token: 'private' };
  const translated = f.protocol.commentsSnapshot(raw);
    assert.equal(translated.items[0].translationTarget, 'ja');
    assert.equal(translated.items[0].replies[0].translationTarget, 'de');
  assert.equal(translated.items[0].translation.text.length, 8000);
  assert.equal(JSON.stringify(translated).includes('private'), false);
  raw.items[0].translation.language = 'en/unsafe';
    raw.items[0].translationTarget = 'en/unsafe';
  assert.equal(f.protocol.commentsSnapshot(raw).items[0].translation, undefined);
    assert.equal(f.protocol.commentsSnapshot(raw).items[0].translationTarget, undefined);
  raw.items[0].replies[0].text = { token: 'private' };
  assert.equal(f.protocol.commentsSnapshot(raw).items[0].replies.length, 0);
});

test('MAIN rejects malformed and privileged requests and survives reinjection', () => {
  const f = fixture();
  const original = f.context.history.pushState;
  f.server.startPageServer();
  const dispose = f.server.startPageServer();
  let responses = 0;
  f.document.addEventListener(f.protocol.PAGE_RESPONSE, () => responses++);
  for (const detail of ['{', '{}', JSON.stringify({ version: 1, id: 'test', operation: 'storage.set' }),
    JSON.stringify({ version: 1, id: 'x'.repeat(101), operation: 'ping' })]) {
    f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, { detail }));
  }
  assert.equal(responses, 0);
  assert.equal(f.client.ping(), true);
  assert.equal(responses, 1);
  f.window.dispatchEvent(new CustomEvent('pagehide', { detail: null }));
  assert.equal(f.client.ping(), false);
  assert.equal(f.context.history.pushState, original);
  dispose();
});

test('browse navigation uses the native router and rejects unsafe destinations', () => {
  const f = fixture();
  f.server.startPageServer();
  const endpoints = [], responses = [];
  f.setPlayer({ navigate_: endpoint => endpoints.push(endpoint) });
  f.document.addEventListener(f.protocol.PAGE_RESPONSE, event => responses.push(JSON.parse(event.detail)));
  const open = href => f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, {
    detail: JSON.stringify({ version: 1, id: 'open', operation: 'openBrowseVideo', href })
  }));
  open('/watch?v=example-1');
  assert.equal(endpoints[0].watchEndpoint.videoId, 'example-1');
  assert.equal(responses.at(-1).value, true);
  open('/watch?v=first&list=RDfirst&index=2&start_radio=1&params=queue-token');
  assert.equal(endpoints.at(-1).watchEndpoint.playlistId, 'RDfirst');
  assert.equal(endpoints.at(-1).watchEndpoint.videoId, 'first');
  assert.equal(endpoints.at(-1).watchEndpoint.index, 1);
  assert.equal(endpoints.at(-1).watchEndpoint.startRadio, true);
  assert.equal(endpoints.at(-1).watchEndpoint.params, 'queue-token');
  for (const href of ['https://evil.test/watch?v=abc', '/watch?v=abc&redirect=1', '/feed/history', '/watch?v=../bad',
    '/watch?v=abc&list=../bad', '/watch?v=abc&list=PLtest&index=0', '/watch?v=abc&list=PLtest&start_radio=bad',
    '/watch?v=abc&list=PLtest&list=PLother']) open(href);
  assert.equal(endpoints.length, 2);
  assert.equal(responses.at(-1).ok, false);
  f.setPlayer({}); open('/watch?v=example-1');
  assert.equal(responses.at(-1).ok, false, 'missing native router permits the full navigation fallback');
});

test('sidebar navigation uses the native router without guide links and rejects external destinations', () => {
  const f = fixture(), endpoints = [];
  f.setPlayer({ navigate_(endpoint) { endpoints.push(endpoint); } });
  const dispose = f.server.startPageServer();
  assert.equal(f.client.openBrowseRoute('/feed/subscriptions'), true);
  assert.equal(endpoints[0].browseEndpoint.browseId, 'FEsubscriptions');
  assert.equal(endpoints[0].commandMetadata.webCommandMetadata.url, '/feed/subscriptions');
  assert.equal(f.client.openBrowseRoute('/playlist?list=WL'), true);
  assert.equal(endpoints[1].browseEndpoint.browseId, 'VLWL');
  for (const href of ['https://evil.test/', '//evil.test/', '/watch?v=abc', '/feed/history?redirect=1', '/feed/history#bad'])
    assert.equal(f.client.openBrowseRoute(href), false);
  assert.equal(endpoints.length, 2);
  f.setPlayer({});
  assert.equal(f.client.openBrowseRoute('/feed/history'), false);
  dispose();
});

test('Shorts navigation loads the canonical page and rejects unsafe or noncanonical links', () => {
  const f = fixture(), destinations = [], responses = [];
  f.context.location.assign = href => destinations.push(href);
  f.setPlayer({ navigate_() { throw new Error('Bare reel endpoint is unsupported'); } });
  const dispose = f.server.startPageServer();
  f.document.addEventListener(f.protocol.PAGE_RESPONSE, event => responses.push(JSON.parse(event.detail)));
  const open = href => f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, {
    detail: JSON.stringify({ version: 1, id: 'short', operation: 'openBrowseVideo', href })
  }));
  open('/shorts/JnICtQ9VHJ8');
  assert.deepEqual(destinations, ['/shorts/JnICtQ9VHJ8']);
  assert.equal(responses.at(-1).value, true);
  for (const href of ['https://evil.test/shorts/abc', '/shorts/../watch', '/shorts/abc?redirect=1', '/shorts/abc#redirect']) {
    open(href);
    assert.equal(responses.at(-1).ok, false);
  }
  assert.equal(destinations.length, 1);
  dispose();
});

test('Shorts route failures never fall back to document navigation while switching videos', () => {
  const f = fixture(), destinations = [], endpoints = [];
  f.context.location.pathname = '/shorts/first';
  f.context.location.assign = href => destinations.push(href);
  f.setPlayer({ navigate_: endpoint => endpoints.push(endpoint) });
  const dispose = f.server.startPageServer();
  const open = href => {
    let opened = false;
    const receive = event => { const message = JSON.parse(event.detail); if (message.id === 'short-route') opened = message.value === true; };
    f.document.addEventListener(f.protocol.PAGE_RESPONSE, receive);
    f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, { detail: JSON.stringify({ version: 1, id: 'short-route', operation: 'openBrowseVideo', href }) }));
    f.document.removeEventListener(f.protocol.PAGE_RESPONSE, receive);
    return opened;
  };
  assert.equal(open('/shorts/second'), true);
  assert.equal(endpoints[0].reelWatchEndpoint.videoId, 'second');
  f.setPlayer({ navigate_() { throw new Error('Router unavailable'); } });
  assert.equal(open('/shorts/third'), false);
  f.setPlayer({});
  assert.equal(open('/shorts/third'), false);
  assert.deepEqual(destinations, []);
  dispose();
});

test('Shorts readiness reads the active native player identity even while it still points to the old video', () => {
  const f = fixture();
  f.context.location.pathname = '/shorts/second';
  let videoId = 'first';
  f.document.querySelector = selector => selector.includes('ytd-reel-video-renderer[is-active]') ? { getVideoData: () => ({ video_id: videoId }) } : null;
  const dispose = f.server.startPageServer();
  assert.equal(f.client.readPlayerVideoId(), 'first');
  videoId = 'second';
  assert.equal(f.client.readPlayerVideoId(), 'second');
  dispose();
});

test('Shorts API playback reuses the player and updates history only after a successful load', async () => {
  const f = fixture(), loads = [], routes = [];
  f.context.location.pathname = '/shorts/first';
  f.context.history.replaceState = (_state, _title, href) => routes.push(href);
  f.setPlayer({ loadVideoById: id => loads.push(id) });
  const dispose = f.server.startPageServer();
  assert.equal(f.client.playShorts('second'), true);
  assert.deepEqual(loads, ['second']);
  assert.deepEqual(routes, ['/shorts/second']);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.client.shortsRecommendations('first'))), { ids: ['second'], hasMore: true });
  f.setPlayer({ loadVideoById() { throw new Error('Unavailable'); } });
  assert.equal(f.client.playShorts('third'), false);
  assert.equal(f.client.playShorts('../watch'), false);
  assert.deepEqual(routes, ['/shorts/second']);
  f.context.location.pathname = '/watch';
  assert.equal(f.client.playShorts('third'), false);
  dispose();
});

test('watch next bridge exposes cached data and pagination without player access', () => {
  const f = fixture();
  const dispose = f.server.startPageServer();
  try {
    assert.equal(f.client.readWatchNext().route, '/watch?v=first');
    assert.equal(f.client.moreWatchNext(), true);
    assert.equal(f.protocol.watchNextSnapshot({ route: '/watch?v=first', queue: [
      { key: 'bad', href: 'https://evil.test/watch?v=bad', label: 'bad', channel: '' },
      { key: 'safe', href: '/watch?v=first&list=PLtest&index=2', label: 'safe', channel: '', thumbnail: 'javascript:bad' }
    ], recommendations: [], loading: false, failed: false }).queue[0].thumbnail, 'https://i.ytimg.com/vi/first/hqdefault.jpg');
  } finally { dispose(); }
});

test('feed bridge retains validated playlist links without confusing the playlist with its first video', async () => {
  const f = fixture();
  const client = load('bridge/feed-client', f.context, {
    '../shared/home-filter': load('shared/home-filter', f.context),
    '../shared/playlist-colors': load('shared/playlist-colors', f.context),
    './page-protocol': f.protocol, '../shared/watch-link': load('shared/watch-link', f.context)
  }).createFeedClient();
  const video = { id: 'video:first', href: '/watch?v=first', title: 'Single', channel: '', thumbnail: 'https://i.ytimg.com/vi/first/hqdefault.jpg' };
  const mix = { ...video, id: 'playlist:RDfirst:first', href: '/watch?v=first&list=RDfirst&start_radio=1', title: 'Mix',
    isPlaylist: true, stackColorLight: '#c6a1a1', stackColorDark: 'url(https://evil.test)' };
  f.document.addEventListener(f.protocol.PAGE_REQUEST, event => {
    const request = JSON.parse(event.detail);
    if (request.operation !== 'requestBrowse') return;
    queueMicrotask(() => f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_RESPONSE, {
      detail: JSON.stringify({ version: 1, id: request.id, operation: request.operation, ok: true, value: { items: [
        video, mix, null, { ...mix, id: 'video:first' }, { ...mix, href: mix.href + '&redirect=1' },
        { ...mix, href: 'https://evil.test/watch?v=first&list=RDfirst' }
      ] } })
    })));
  });
  try {
    const result = await client.request('all');
    assert.deepEqual(Array.from(result.items, item => item.id), ['video:first', 'playlist:RDfirst:first']);
    assert.equal(result.items[1].href, mix.href);
    assert.equal(result.items[1].thumbnailFallback, video.thumbnail);
    assert.equal(result.items[1].stackColorLight, '#c6a1a1');
    assert.equal(result.items[1].stackColorDark, undefined);
  } finally { client.destroy(); }
});

function handshakeFixture() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const { waitForPageServer } = load('bridge/page-ready', {
    Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  return { waitForPageServer, timers, tick() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); now = timer.at; timer.callback();
  } };
}

test('startup retries a late MAIN adapter and releases its timer on readiness', async () => {
  const f = handshakeFixture(), controller = new AbortController();
  let ready = false;
  const waiting = f.waitForPageServer({ ping: () => ready }, controller.signal, 300, 100);
  f.tick();
  ready = true;
  f.tick();
  assert.equal(await waiting, true);
  assert.equal(f.timers.size, 0);
});

test('startup timeout or cancellation permits native fallback without leaked retries', async () => {
  for (const cancel of [false, true]) {
    const f = handshakeFixture(), controller = new AbortController();
    let requests = 0;
    const waiting = f.waitForPageServer({ ping: () => { requests++; return false; } }, controller.signal, 200, 100);
    if (cancel) controller.abort();
    else { f.tick(); f.tick(); }
    assert.equal(await waiting, false);
    assert.equal(f.timers.size, 0);
    if (cancel) assert.equal(requests, 1);
  }
});

test('already cancelled startup never contacts the page', async () => {
  const f = handshakeFixture(), controller = new AbortController();
  controller.abort();
  assert.equal(await f.waitForPageServer({ ping() { throw new Error('Must not request'); } }, controller.signal), false);
  assert.equal(f.timers.size, 0);
});


test('watch switching preserves the document and sends playlist context through in-page navigation', () => {
  const f = fixture(), endpoints = [];
  const app = new EventTarget();
  app.addEventListener('yt-navigate', event => endpoints.push(event.detail.endpoint));
  f.setPlayer(app);
  const dispose = f.server.startPageServer();
  const href = '/watch?v=second&list=PLtest&index=2';
  const document = f.document;
  assert.equal(f.client.openWatchVideo(href), true);
  assert.equal(f.document, document);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].watchEndpoint.videoId, 'second');
  assert.equal(endpoints[0].watchEndpoint.playlistId, 'PLtest');
  assert.equal(endpoints[0].watchEndpoint.index, 1);
  assert.equal(f.client.openWatchVideo('https://evil.test/watch?v=second'), false);
  assert.equal(endpoints.length, 1);
  const responses = [];
  f.document.addEventListener(f.protocol.PAGE_RESPONSE, event => responses.push(JSON.parse(event.detail)));
  f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, {
    detail: JSON.stringify({ version: 1, id: 'browse-event-only', operation: 'openBrowseVideo', href })
  }));
  assert.equal(responses.at(-1).ok, false, 'browse entry requires the native router even when event dispatch is available');
  assert.equal(endpoints.length, 1);
  app.navigate_ = endpoint => endpoints.push(endpoint);
  assert.equal(f.client.openWatchVideo(href), true);
  assert.equal(endpoints.length, 2, 'native routing must not also dispatch the fallback event');
  assert.deepEqual(endpoints[1], endpoints[0]);
  app.navigate_ = () => { throw new Error('Router unavailable'); };
  assert.equal(f.client.openWatchVideo(href), false);
  assert.equal(endpoints.length, 2, 'a throwing native router must not trigger the event fallback');
  f.setPlayer(null);
  assert.equal(f.client.openWatchVideo(href), false);
  dispose();
});

test('recommendation filter snapshots retain bounded display fields without commands', () => {
  const f = fixture();
  const value = f.protocol.watchNextSnapshot({ route: '/watch?v=fixture', recommendations: [], queue: [], filters: [
    { key: 'filter:1', label: 'x'.repeat(500), selected: true, endpoint: { token: 'private' } },
    { key: 'arbitrary-command', label: 'Invalid', selected: true }
  ] });
  assert.equal(value.filters.length, 1); assert.equal(value.filters[0].label.length, 200);
  assert.equal(JSON.stringify(value).includes('private'), false);
  assert.deepEqual(Object.keys(value.filters[0]), ['key', 'label', 'selected']);
});
