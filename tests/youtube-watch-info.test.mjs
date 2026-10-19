import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-watch-info.ts', import.meta.url)), formats: ['iife'], name: 'InfoFixture' } } });
const code = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code;
import { next, player, option } from './helpers/watch-info-data.mjs';
function fixture({ signedIn = true, handler } = {}) {
  const calls = [], events = [];
  const location = { pathname: '/watch', search: '?v=first', origin: 'https://www.youtube.com' };
  const sandbox = { URL, URLSearchParams, AbortController, setTimeout, clearTimeout, structuredClone,
    TextEncoder, Event, crypto: webcrypto, location, console,
    document: { cookie: signedIn ? 'SAPISID=fixture' : '', dispatchEvent: event => events.push(event.type),
      querySelector() { throw Error('Native page JS must not be read'); } },
    window: { ytcfg: { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} },
      LOGGED_IN: signedIn, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand-account' })[key] } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, init, body });
      const raw = handler ? await handler(url, body, calls.length) : undefined;
      return { ok: true, json: async () => raw || (url.endsWith('/player') ? player(body.videoId) : url.endsWith('/next') ? next() :
        url.endsWith('/get_add_to_playlist') ? { contents: { addToPlaylistRenderer: { playlists: [option('PLone'), option('WL', true)] } } } : { success: true }) };
    }
  };
  vm.runInNewContext(code, sandbox);
  return { calls, events, location, service: sandbox.InfoFixture.createWatchInfoService() };
}
async function ready(s) {
  s.service.read();
  for (let i = 0; i < 200 && s.service.read().loading; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(s.service.read().failed, false);
  return s.service.read();
}
test('direct Shorts metadata, reactions and playlists target their own video', async () => {
  const s = fixture(); s.location.pathname = '/shorts/first'; s.location.search = '';
  const info = await ready(s);
  assert.equal(info.route, '/shorts/first'); assert.equal(info.details.videoId, 'first');
  assert.equal(await s.service.act('like'), true);
  assert.equal(s.calls.at(-1).body.target.videoId, 'first');
  assert.equal((await s.service.listPlaylists()).length, 2);
  s.service.destroy();
});

test('unknown reaction and subscription states disable writes instead of guessing', async () => {
  const s = fixture({ handler: url => {
    if (!url.endsWith('/next')) return;
    const response = next();
    const items = response.contents.twoColumnWatchNextResults.results.results.contents;
    items[0].videoPrimaryInfoRenderer.videoActions.menuRenderer.topLevelButtons = [];
    delete items[1].videoSecondaryInfoRenderer.subscribeButton;
    return response;
  } });
  const info = await ready(s);
  assert.equal(info.canLike, false);
  assert.equal(info.canSubscribe, false);
  assert.equal(await s.service.act('like'), false);
  assert.equal(await s.service.act('subscribe'), false);
  assert.equal(s.calls.length, 2);
  s.service.destroy();
});

test('video details come from player/next APIs and reuse the selected page account', async () => {
  const s = fixture(), info = await ready(s);
  assert.equal(info.details.title, 'Title first');
  assert.equal(info.details.viewCount, '42');
  assert.equal(info.avatar, 'https://example.com/avatar.jpg');
  assert.equal(info.canLike, true); assert.equal(info.canSubscribe, true);
  assert.equal(s.calls.length, 2);
  for (const call of s.calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.match(call.init.headers.Authorization, /^SAPISIDHASH /);
    assert.equal(call.init.headers['X-Goog-AuthUser'], '2');
    assert.equal(call.init.headers['X-Goog-PageId'], 'brand-account');
  }
  s.service.destroy();
});
test('like/dislike and subscription toggle only after confirmed writes', async () => {
  const s = fixture(); await ready(s);
  assert.equal(await s.service.act('like'), true);
  assert.equal(s.service.read().liked, true);
  assert.equal(s.calls.at(-1).body.target.videoId, 'first');
  assert.equal(await s.service.act('like'), true);
  assert.ok(s.calls.at(-1).url.endsWith('/like/removelike'));
  assert.equal(s.service.read().liked, false);
  assert.equal(await s.service.act('dislike'), true);
  assert.equal(s.service.read().disliked, true);
  assert.equal(await s.service.act('subscribe'), true);
  assert.equal(s.service.read().subscribed, true);
  assert.deepEqual(Array.from(s.calls.at(-1).body.channelIds), ['UCcreator']);
  assert.equal(await s.service.act('subscribe'), true);
  assert.equal(s.service.read().subscribed, false);
  s.service.destroy();
});
test('save offers editable playlists and toggles the chosen list through private endpoints', async () => {
  const s = fixture(); await ready(s);
  const choices = await s.service.listPlaylists();
  assert.equal(choices.length, 2);
  assert.equal(choices[1].selected, true);
  assert.equal(JSON.stringify(choices).includes('private-set-id'), false);
  assert.equal(await s.service.togglePlaylist('unknown'), false);
  assert.equal(await s.service.togglePlaylist(choices[0].key), true);
  assert.equal(s.calls.at(-1).body.playlistId, 'PLone');
  assert.equal(s.calls.at(-1).body.actions[0].action, 'ACTION_ADD_VIDEO');
  assert.equal(await s.service.togglePlaylist(choices[1].key), true);
  assert.equal(s.calls.at(-1).body.actions[0].action, 'ACTION_REMOVE_VIDEO');
  s.service.destroy();
});
test('mutation failures are not retried and do not optimistically change state', async () => {
  const s = fixture({ handler: url => { if (url.includes('/like/')) throw Error('connection lost'); } });
  await ready(s);
  assert.equal(await s.service.act('like'), false);
  assert.equal(s.service.read().liked, false);
  assert.equal(s.calls.filter(call => call.url.includes('/like/')).length, 1);
  s.service.destroy();
});
test('signed-out users can read metadata without account mutations', async () => {
  const s = fixture({ signedIn: false }); await ready(s);
  assert.equal(await s.service.act('like'), false);
  assert.equal(await s.service.listPlaylists(), undefined);
  assert.equal(s.calls.length, 2);
  s.service.destroy();
});
test('navigation while loading metadata cannot redirect an old action to a new video', async () => {
  let release;
  const s = fixture({ handler: url => url.endsWith('/player') ? new Promise(resolve => { release = resolve; }) : undefined });
  const pending = s.service.act('like');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  s.location.search = '?v=second'; s.service.routeChanged();
  release(player('first'));
  assert.equal(await pending, false);
  assert.equal(s.calls.some(call => call.url.includes('/like/')), false);
  s.service.destroy();
});

test('duplicate actions are blocked while a confirmed mutation is pending', async () => {
  let release;
  const s = fixture({ handler: url => url.includes('/like/') ? new Promise(resolve => { release = resolve; }) : undefined });
  await ready(s);
  const first = s.service.act('like');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(s.service.read().liked, false);
  assert.equal(await s.service.act('like'), false);
  release({ success: true });
  assert.equal(await first, true);
  assert.equal(s.service.read().liked, true);
  assert.equal(s.calls.filter(call => call.url.includes('/like/')).length, 1);
  s.service.destroy();
});
