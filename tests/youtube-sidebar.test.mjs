import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { guideData } from './helpers/sidebar-data.mjs';

const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-sidebar.ts', import.meta.url)), formats: ['iife'], name: 'SidebarFixture' } } });
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
function fixture(handler) {
  const calls = [], settings = { INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} },
    LOGGED_IN: true, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand' };
  let now = Date.now();
  const sandbox = { URL, AbortController, structuredClone, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, console,
    Date: class extends Date { static now() { return now; } }, location: { origin: 'https://www.youtube.com' },
    window: { ytcfg: { get: key => settings[key] } },
    document: { cookie: 'SAPISID=fixture', querySelector() { throw Error('Native sidebar must not be read'); } },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
      return { ok: true, json: async () => handler ? await handler(calls.length) : guideData() };
    } };
  vm.runInNewContext(code, sandbox);
  return { calls, settings, service: sandbox.SidebarFixture.createSidebarService(), advance() { now += 61000; } };
}

test('sidebar guide uses the selected page account and parses nested entries without DOM reads', async () => {
  const s = fixture(); const value = await s.service.read();
  assert.equal(s.calls[0].url, '/youtubei/v1/guide');
  assert.equal(s.calls[0].headers['X-Goog-AuthUser'], '2');
  assert.equal(s.calls[0].headers['X-Goog-PageId'], 'brand');
  assert.match(s.calls[0].headers.Authorization, /^SAPISIDHASH /);
  assert.deepEqual(Array.from(value.explore, item => item.label), ['Musique régionale', 'Games']);
  assert.equal(value.personal.find(item => item.id === 'videos').href, 'https://studio.youtube.com/channel/UCcreator/videos');
  assert.equal(JSON.stringify(value).includes('navigationEndpoint'), false);
  assert.equal(JSON.stringify(value).includes('Subscribed creator'), false);
  s.service.destroy();
});

test('sidebar deduplicates pending requests, caches snapshots and refreshes after expiry', async () => {
  const s = fixture(); await Promise.all([s.service.read(), s.service.read()]);
  assert.equal(s.calls.length, 1);
  const value = await s.service.read(); value.personal[0].label = 'Caller modification';
  assert.notEqual((await s.service.read()).personal[0].label, 'Caller modification');
  s.advance(); await s.service.read(); assert.equal(s.calls.length, 2); s.service.destroy();
});

test('regional entries with unknown icons remain in the identified Explore section', async () => {
  const s = fixture(() => {
    const raw = guideData(), section = raw.items[2].guideSectionRenderer;
    const entry = structuredClone(section.items[0]);
    entry.guideEntryRenderer.formattedTitle.simpleText = 'Regional learning';
    entry.guideEntryRenderer.icon.iconType = 'LIGHTBULB';
    entry.guideEntryRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url = '/channel/UClessons';
    section.items.push(entry); return raw;
  });
  assert.equal((await s.service.read()).explore.at(-1).label, 'Regional learning'); s.service.destroy();
});

test('malformed guide responses fail without consulting page data and can be retried', async () => {
  const s = fixture(count => count === 1 ? { contents: {} } : guideData());
  await assert.rejects(s.service.read(), /Sidebar guide unavailable/);
  assert.equal((await s.service.read()).explore.length, 2); s.service.destroy();
});

test('empty guide uses built-in destinations without native guide data', async () => {
  const s = fixture(() => ({ items: [] })); const value = await s.service.read();
  assert.equal(value.personal.length, 5); assert.ok(value.explore.length > 0); s.service.destroy();
});

test('account changes reject stale guide results and load the current identity', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture(count => count === 1 ? gate : guideData());
  const first = s.service.read();
  while (!s.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  s.settings.SESSION_INDEX = 3;
  const second = s.service.read(); release(guideData());
  await assert.rejects(first, /cancelled/); assert.equal((await second).explore.length, 2);
  assert.equal(s.calls[1].headers['X-Goog-AuthUser'], '3'); s.service.destroy();
});

test('destroy aborts pending guide requests and refuses new requests', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture(() => gate), pending = s.service.read();
  while (!s.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  s.service.destroy(); release(guideData());
  await assert.rejects(pending, /cancelled/); await assert.rejects(s.service.read(), /destroyed/);
  assert.equal(s.calls[0].signal.aborted, true);
});
