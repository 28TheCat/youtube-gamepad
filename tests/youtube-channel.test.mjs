import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent', build: {
  write: false, minify: false, target: 'es2022', lib: {
    entry: fileURLToPath(new URL('../src/sites/youtube-feed.ts', import.meta.url)), formats: ['iife'], name: 'ChannelFixture'
  }
} });
const code = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code;
const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: id }, thumbnail: { thumbnails: [
  { url: `https://i.ytimg.com/vi/${id}/large.jpg`, width: 1280 }, { url: `https://i.ytimg.com/vi/${id}/small.jpg`, width: 120 }
] } } });
const next = token => ({ continuationItemRenderer: { continuationEndpoint: {
  continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' }
} } });
const endpoint = params => ({ browseEndpoint: { browseId: 'UCcreator', params },
  commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/browse' } } });
function page(tab = 'videos', modern = false) {
  const sorts = modern ? { chipBarViewModel: { chips: ['Latest', 'Popular'].map(label => ({ chipViewModel: {
    text: label, selected: label === 'Latest', tapCommand: { innertubeCommand: endpoint(`${tab}-${label}`) }
  } })) } } : { sortFilterSubMenuRenderer: { subMenuItems: ['Latest', 'Popular'].map(title => ({
    title, selected: title === 'Latest', serviceEndpoint: endpoint(`${tab}-${title}`)
  })) } };
  return { contents: { twoColumnBrowseResultsRenderer: { tabs: ['videos', 'shorts', 'playlists'].map(name => ({
    tabRenderer: { title: name, selected: name === tab,
      endpoint: { ...endpoint(name), commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/browse', url: `/@creator/${name}` } } },
      content: { richGridRenderer: { header: sorts, contents: [video(name === tab ? tab : 'hidden'), next(name === tab ? `${tab}-next` : 'hidden-next')] } }
    }
  })) } } };
}
function fixture(pathname = '/@creator/videos', handler) {
  const calls = [];
  const location = { pathname, search: '', origin: 'https://www.youtube.com' };
  const sandbox = { URL, URLSearchParams, Request, Response, Headers, structuredClone, AbortController,
    TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, console, location,
    history: { state: {}, replaceState(value) { this.state = value; } },
    document: { cookie: 'SAPISID=fixture', querySelector() { throw Error('native DOM read'); }, querySelectorAll() { throw Error('native DOM read'); } },
    window: { ytcfg: { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'test' }, user: {} },
      SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand-account' })[key] } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body });
      const raw = handler ? await handler(url, body, calls.length) : url.endsWith('resolve_url') ?
        { endpoint: endpoint('resolved-tab') } : body.continuation ? { onResponseReceivedActions: [{
          appendContinuationItemsAction: { continuationItems: [video('second')] }
        }] } : page();
      return { ok: true, json: async () => raw };
    }
  };
  vm.runInNewContext(code, Object.assign(sandbox, { Headers, Request, Response }));
  return { ...sandbox.ChannelFixture, calls, location };
}

test('channel header comes from API and continuation does not invent a different header', async () => {
  const s = fixture('/@wangzhian', (url, body) => {
    if (url.endsWith('resolve_url')) return { endpoint: endpoint('featured') };
    if (body.continuation) return { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [video('second')] } }] };
    return { ...page(), header: { c4TabbedHeaderRenderer: {
      title: '王志安', channelId: 'UCcreator',
      avatar: { thumbnails: [{ url: 'https://example.com/avatar.jpg' }] },
      banner: { thumbnails: [{ url: 'https://example.com/banner.jpg' }] },
      subscriberCountText: { simpleText: '100万位订阅者' }
    } } };
  });
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  assert.equal(first.channelHeader.title, '王志安');
  assert.equal(first.channelHeader.avatar, 'https://example.com/avatar.jpg');
  assert.equal(first.channelHeader.banner, 'https://example.com/banner.jpg');
  assert.match(first.channelHeader.metadata, /100万/);
  const second = await service.request('all', first.nextPage);
  assert.equal(second.channelHeader, undefined);
  service.cancel();
});

test('modern channel header keeps title, banner, avatar and metadata', async () => {
  const s = fixture('/@creator', url => url.endsWith('resolve_url') ? { endpoint: endpoint('featured') } : {
    ...page(), header: { pageHeaderRenderer: { pageTitle: 'Creator', content: { pageHeaderViewModel: {
      title: { dynamicTextViewModel: { text: { content: 'Creator' }, maxLines: 1 } },
      image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: 'https://example.com/avatar.png' }] } } } } },
      banner: { imageBannerViewModel: { image: { sources: [{ url: 'https://example.com/banner.png' }] } } },
      metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '@creator' } }, { text: { content: '100 subscribers' } }] }] } }
    } } } }
  });
  const service = s.createYouTubeFeedService();
  const result = await service.request('all');
  assert.equal(result.channelHeader.title, 'Creator');
  assert.equal(result.channelHeader.avatar, 'https://example.com/avatar.png');
  assert.equal(result.channelHeader.banner, 'https://example.com/banner.png');
  assert.equal(result.channelHeader.metadata, '@creator · 100 subscribers');
  service.cancel();
});

for (const path of ['/@creator/videos', '/channel/UCcreator/shorts', '/c/Creator/streams', '/user/Creator'])
test(`library channel endpoint parsing preserves resolved tab parameters for ${path}`, async () => {
  const s = fixture(path);
  const service = s.createYouTubeFeedService();
  const first = await service.request('all');
  assert.equal(s.calls[0].body.url, `https://www.youtube.com${path}`);
  assert.equal(s.calls[1].body.params, 'resolved-tab');
  assert.equal(first.items[0].id, 'video:videos');
  assert.equal(first.items.length, 1, 'hidden tab contents must be excluded');
  assert.equal(first.items[0].thumbnail, 'https://i.ytimg.com/vi/videos/large.jpg');
  assert.equal(first.nextPage === 'videos-next', false);
  assert.deepEqual(Array.from(service.categories(), item => item.label), ['All', 'videos', 'shorts', 'playlists', 'Latest', 'Popular']);
  const second = await service.request('all', first.nextPage);
  assert.equal(second.items[0].id, 'video:second');
  assert.equal(s.calls[2].body.continuation, 'videos-next');
  assert.equal(s.calls.length, 3);
  assert.equal(s.calls[1].options.headers['x-goog-authuser'], '2');
  assert.equal(s.calls[1].options.headers['x-goog-pageid'], 'brand-account');
  assert.match(s.calls[1].options.headers.authorization, /^SAPISIDHASH /);
  assert.equal(s.calls[1].options.credentials, 'same-origin');
});

test('tab switch, modern chip sorting and continuation retain their own server parameters', async () => {
  const s = fixture('/@creator/videos', (url, body) => url.endsWith('resolve_url') ? { endpoint: endpoint('videos') } :
    body.params === 'shorts-Popular' ? { onResponseReceivedActions: [{ reloadContinuationItemsCommand: {
      continuationItems: [video('popular'), next('popular-next')]
    } }] } : body.continuation ? { onResponseReceivedActions: [{ appendContinuationItemsAction: {
      continuationItems: [video('popular-second')]
    } }] } : page(body.params === 'shorts' ? 'shorts' : 'videos', true));
  const service = s.createYouTubeFeedService();
  await service.request('all');
  const shorts = service.categories().find(item => item.label === 'shorts');
  await service.request(shorts.id);
  assert.equal(s.calls.at(-1).body.params, 'shorts');
  const popular = service.categories().find(item => item.label === 'Popular');
  const sorted = await service.request(popular.id);
  assert.equal(sorted.items[0].id, 'video:popular');
  assert.equal(s.calls.at(-1).body.params, 'shorts-Popular');
  assert.ok(service.categories().some(item => item.id === popular.id), 'sort controls survive response without tabs');
  const second = await service.request(popular.id, sorted.nextPage);
  assert.equal(second.items[0].id, 'video:popular-second');
  assert.equal(s.calls.at(-1).body.continuation, 'popular-next');
  assert.equal(s.calls.filter(item => item.url.endsWith('resolve_url')).length, 1);
});

test('a navigation while resolving channel aliases cancels the pending browse request', async () => {
  let release;
  const s = fixture('/@creator/videos', () => new Promise(resolve => { release = resolve; }));
  const pending = s.createYouTubeFeedService().request('all');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  s.location.pathname = '/@other/videos';
  release({ endpoint: endpoint('videos') });
  await assert.rejects(pending, /cancelled/);
  assert.equal(s.calls.length, 1);
});

test('non-browse resolver responses cannot become channel requests', async () => {
  const s = fixture('/@creator/videos', () => ({ endpoint: { urlEndpoint: { url: 'https://example.com' } } }));
  await assert.rejects(s.createYouTubeFeedService().request('all'), /unavailable/);
  assert.equal(s.calls.length, 1);
});

test('selected API cards are parsed once and hidden tab content is never parsed', async () => {
  let selectedReads = 0, hiddenReads = 0;
  const s = fixture('/@creator/videos', url => {
    if (url.endsWith('resolve_url')) return { endpoint: endpoint('videos') };
    const raw = page('videos');
    for (const entry of raw.contents.twoColumnBrowseResultsRenderer.tabs) {
      const data = entry.tabRenderer.content.richGridRenderer.contents[0].videoRenderer;
      Object.defineProperty(data, 'videoId', { enumerable: true, get() {
        if (entry.tabRenderer.selected) { selectedReads++; return 'videos'; }
        hiddenReads++; throw Error('Hidden content must not be parsed');
      } });
    }
    return raw;
  });
  const service = s.createYouTubeFeedService();
  const result = await service.request('all');
  assert.equal(result.items[0].thumbnail, 'https://i.ytimg.com/vi/videos/large.jpg');
  assert.equal(selectedReads, 1);
  assert.equal(hiddenReads, 0);
  assert.equal(service.categories().filter(item => item.id.startsWith('channel:tab:')).length, 3);
});

for (const modern of [false, true]) test(`single-column channel API data retains tabs, ${modern ? 'modern chips' : 'submenu sorting'} and the selected content`, async () => {
  const s = fixture('/@creator/shorts', url => {
    if (url.endsWith('resolve_url')) return { endpoint: endpoint('shorts') };
    const raw = page('shorts', modern);
    raw.contents = { singleColumnBrowseResultsRenderer: raw.contents.twoColumnBrowseResultsRenderer };
    return raw;
  });
  const service = s.createYouTubeFeedService();
  const result = await service.request('all');
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:shorts']);
  assert.ok(service.categories().some(item => item.label === 'Popular'));
});

test('sort discovery excludes hidden tabs and uses the selected tab submenu', async () => {
  const s = fixture('/@creator/shorts', (url, body) => {
    if (url.endsWith('resolve_url')) return { endpoint: endpoint('shorts') };
    const raw = page('shorts');
    raw.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.header = {
      sortFilterSubMenuRenderer: { subMenuItems: [{ title: 'Hidden sort', serviceEndpoint: endpoint('wrong-tab') }] }
    };
    return raw;
  });
  const service = s.createYouTubeFeedService();
  await service.request('all');
  assert.equal(service.categories().some(item => item.label === 'Hidden sort'), false);
  const popular = service.categories().find(item => item.label === 'Popular');
  await service.request(popular.id);
  assert.equal(s.calls.at(-1).body.params, 'shorts-Popular');
});

test('dropdown filter items use parsed renderer-context browse endpoints', async () => {
  const s = fixture('/@creator/videos', url => {
    if (url.endsWith('resolve_url')) return { endpoint: endpoint('videos') };
    const raw = page('videos', true);
    raw.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.header = {
      chipBarViewModel: { chips: [{ chipViewModel: {
        text: 'Latest', displayType: 'CHIP_VIEW_MODEL_DISPLAY_TYPE_DROP_DOWN',
        tapCommand: { innertubeCommand: { showSheetCommand: { panelLoadingStrategy: { inlineContent: {
          sheetViewModel: { content: { listViewModel: { listItems: ['Latest', 'Oldest'].map(title => ({
            listItemViewModel: { title: { content: title }, rendererContext: { commandContext: {
              onTap: { innertubeCommand: endpoint(`dropdown-${title}`) }
            } } }
          })) } } }
        } } } } }
      } }] }
    };
    return raw;
  });
  const service = s.createYouTubeFeedService();
  await service.request('all');
  const oldest = service.categories().find(item => item.label === 'Oldest');
  assert.ok(oldest);
  await service.request(oldest.id);
  assert.equal(s.calls.at(-1).body.params, 'dropdown-Oldest');
});
