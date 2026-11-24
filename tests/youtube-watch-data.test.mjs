import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { next, player } from './helpers/watch-info-data.mjs';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('./helpers/watch-data-fixture.ts', import.meta.url)), formats: ['iife'], name: 'Fixture' } } });
const code = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ media, nativePlayer, nativeNext, nativeDataId } = {}) {
  const calls = [];
  let jsonReads = 0;
  const location = { pathname: '/watch', search: '?v=first&list=PLtest&index=3&start_radio=1&params=test', origin: 'https://www.youtube.com' };
  const sandbox = { URL, URLSearchParams, AbortController, setTimeout, clearTimeout, structuredClone, TextEncoder, Event,
    crypto: webcrypto, location, console, document: { cookie: '', dispatchEvent() {}, querySelector(selector) {
      if (selector === 'ytd-watch-flexy') return { data: nativeNext };
      if (selector === '#movie_player') return { getVideoData: () => ({ video_id: nativeDataId }), getPlayerResponse: () => nativePlayer, querySelector: () => media };
    } },
    window: { ytcfg: { get: key => ({ INNERTUBE_CONTEXT: { client: { clientVersion: 'test' }, user: {} } })[key] } },
    fetch: (url, init) => new Promise(resolve => calls.push({ url, init, body: JSON.parse(init.body),
      resolve: raw => resolve({ ok: true, json: async () => { jsonReads++; return raw; } }) })) };
  vm.runInNewContext(code, Object.assign(sandbox, { Headers, Request, Response }));
  const shared = sandbox.Fixture.createWatchDataService();
  const info = sandbox.Fixture.createWatchInfoService(shared), recommendations = sandbox.Fixture.createWatchNextService(shared);
  return { calls, location, shared, info, recommendations, get jsonReads() { return jsonReads; },
    init: signal => ({ headers: {}, body: JSON.stringify({ context: { client: { clientVersion: 'test' } }, videoId: 'ignored' }), signal }),
    destroy() { info.destroy(); recommendations.destroy(); shared.destroy(); } };
}

for (const infoFirst of [true, false]) test(`details and recommendations share next (details first: ${infoFirst}), while pagination stays independent`, async () => {
  const f = fixture();
  try {
    if (infoFirst) { f.info.read(); f.recommendations.read(); }
    else { f.recommendations.read(); f.info.read(); }
    await tick();
    assert.equal(f.calls.filter(c => c.url.endsWith('/next')).length, 1);
    const initial = f.calls.find(c => c.url.endsWith('/next'));
    assert.equal(initial.body.videoId, 'first'); assert.equal(initial.body.playlistId, 'PLtest');
    assert.equal(initial.body.index, 2); assert.equal(initial.body.startRadio, true); assert.equal(initial.body.params, 'test');
    const raw = next();
    raw.contents.twoColumnWatchNextResults.secondaryResults = { secondaryResults: { results: [
      { compactVideoRenderer: { videoId: 'related', title: { simpleText: 'Related' } } },
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'page-two' } } } }
    ] } };
    initial.resolve(raw); f.calls.find(c => c.url.endsWith('/player')).resolve(player('first'));
    await tick(); await tick();
    assert.equal(f.info.read().details.title, 'Title first');
    assert.equal(f.recommendations.read().recommendations[0].label, 'Related');
    assert.equal(f.jsonReads, 2, 'one player JSON decode and one next JSON decode');
    f.recommendations.more();
    await tick();
    assert.equal(f.calls.length, 3); assert.equal(f.calls[2].body.continuation, 'page-two');
    f.calls[2].resolve({ contents: {} }); await tick();
    f.info.destroy();
    assert.equal(initial.init.signal.aborted, false);
  } finally { f.destroy(); }
});

test('destination requests start immediately while reused media still belongs to the old video', async () => {
  const media = { readyState: 0, videoWidth: 0 };
  const nativePlayer = player('old');
  const f = fixture({ media, nativePlayer, nativeDataId: 'old' });
  try {
    assert.equal(f.info.read().loading, true);
    assert.equal(f.recommendations.read().loading, true);
    await tick();
    assert.equal(f.calls.length, 2, 'player and shared next start without waiting for frames or native identity');
    assert.ok(f.calls.every(call => call.body.videoId === 'first'));
    f.calls.find(call => call.url.endsWith('/next')).resolve(next());
    f.calls.find(call => call.url.endsWith('/player')).resolve(player('first'));
    await tick(); await tick();
    assert.equal(f.info.read().failed, false);
    assert.equal(f.info.read().details.videoId, 'first');
    assert.equal(f.recommendations.read().loading, false);
    assert.equal(media.readyState, 0, 'data readiness is independent of media readiness');
  } finally { f.destroy(); }
});

test('matching native next and player responses avoid all initial auxiliary network requests', async () => {
  const nativeNext = next();
  nativeNext.currentVideoEndpoint = { watchEndpoint: { videoId: 'first', playlistId: 'PLtest', index: 2, startRadio: true, params: 'test' } };
  const f = fixture({ nativePlayer: player('first'), nativeNext });
  try {
    f.info.read(); f.recommendations.read();
    await tick(); await tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.info.read().details.title, 'Title first');
    assert.equal(f.info.read().loading, false);
    assert.equal(f.recommendations.read().loading, false);
    const raw = await f.shared.read(f.init());
    assert.notEqual(raw, nativeNext, 'parsers never mutate the page-owned response');
  } finally { f.destroy(); }
});

for (const endpoint of [{ videoId: 'old' }, { videoId: 'first', playlistId: 'PLother', index: 2 },
  { videoId: 'first', playlistId: 'PLtest', index: 1, startRadio: true, params: 'test' }])
test(`native next with stale destination is ignored: ${JSON.stringify(endpoint)}`, async () => {
  const nativeNext = next(); nativeNext.currentVideoEndpoint = { watchEndpoint: endpoint };
  const f = fixture({ nativeNext });
  try {
    const pending = f.shared.read(f.init());
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve({ contents: {} }); await pending;
  } finally { f.destroy(); }
});

test('consumer cancellation leaves shared transport alive and a later reader reuses success', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    const first = f.shared.read(f.init(controller.signal)), second = f.shared.read(f.init());
    controller.abort(); await assert.rejects(first, e => e.kind === 'cancelled');
    assert.equal(f.calls[0].init.signal.aborted, false);
    f.calls[0].resolve({ contents: {} });
    const raw = await second;
    assert.equal(await f.shared.read(f.init()), raw); assert.equal(f.calls.length, 1);
  } finally { f.destroy(); }
});

test('navigation cancels shared transport and late responses cannot replace the new route', async () => {
  const f = fixture();
  try {
    const old = f.shared.read(f.init());
    const rejected = assert.rejects(old, e => e.kind === 'cancelled');
    f.location.search = '?v=second'; f.shared.routeChanged();
    assert.equal(f.calls[0].init.signal.aborted, true);
    const current = f.shared.read(f.init());
    f.calls[0].resolve({ contents: { stale: true } });
    f.calls[1].resolve({ contents: { current: true } });
    await rejected; assert.equal((await current).contents.current, true);
    assert.equal(f.calls[1].body.videoId, 'second');
  } finally { f.destroy(); }
});

test('failed shared requests are evicted so a retry can succeed', async () => {
  const f = fixture();
  try {
    const first = f.shared.read(f.init()), second = f.shared.read(f.init());
    const rejected = Promise.all([assert.rejects(first), assert.rejects(second)]);
    f.calls[0].resolve({ error: {} }); await rejected;
    const retry = f.shared.read(f.init());
    assert.equal(f.calls.length, 2);
    f.calls[1].resolve({ contents: {} }); await retry;
  } finally { f.destroy(); }
});

test('account context changes invalidate success and disposal cancels the active request', async () => {
  const f = fixture();
  try {
    const first = f.shared.read(f.init());
    f.calls[0].resolve({ contents: {} }); await first;
    const init = f.init(); init.headers['X-Goog-AuthUser'] = '2';
    const second = f.shared.read(init);
    assert.equal(f.calls.length, 2);
    const rejected = assert.rejects(second, e => e.kind === 'cancelled');
    f.shared.destroy();
    assert.equal(f.calls[1].init.signal.aborted, true); await rejected;
    await assert.rejects(f.shared.read(init), e => e.kind === 'cancelled');
    assert.equal(f.calls.length, 2);
  } finally { f.destroy(); }
});

test('replacing a pending account request cannot let its failure evict the new account response', async () => {
  const f = fixture();
  try {
    const first = f.shared.read(f.init());
    const rejected = assert.rejects(first, e => e.kind === 'cancelled');
    const init = f.init(); init.headers['X-Goog-PageId'] = 'another-brand';
    const second = f.shared.read(init);
    assert.equal(f.calls[0].init.signal.aborted, true);
    await rejected;
    f.calls[1].resolve({ contents: { account: 'another-brand' } });
    const response = await second;
    assert.equal(await f.shared.read(init), response);
    assert.equal(f.calls.length, 2);
  } finally { f.destroy(); }
});
