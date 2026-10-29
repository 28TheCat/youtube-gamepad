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
const flatten = entries => Array.from(entries || []).flatMap(entry => [entry, ...flatten(entry.children)]);
const links = snapshot => snapshot.sections.flatMap(section => flatten(section.entries));
const explore = snapshot => snapshot.sections.find(section => section.label === 'Découvrir').entries;
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
  vm.runInNewContext(code, Object.assign(sandbox, { Headers, Request, Response }));
  return { calls, settings, service: sandbox.SidebarFixture.createSidebarService(), advance() { now += 61000; } };
}

test('sidebar guide uses the selected page account and parses nested entries without DOM reads', async () => {
  const s = fixture(); const value = await s.service.read();
  assert.equal(s.calls[0].url, '/youtubei/v1/guide');
  assert.equal(s.calls[0].headers['x-goog-authuser'], '2');
  assert.equal(s.calls[0].headers['x-goog-pageid'], 'brand');
  assert.match(s.calls[0].headers.authorization, /^SAPISIDHASH /);
  assert.deepEqual(Array.from(explore(value), item => item.label), ['Musique régionale', 'Games']);
  assert.equal(links(value).find(item => item.id === 'videos').href, 'https://studio.youtube.com/channel/UCcreator/videos');
  assert.equal(JSON.stringify(value).includes('navigationEndpoint'), false);
  assert.equal(JSON.stringify(value).includes('Subscribed creator'), true);
  assert.equal(value.sections[1].entries[0].label, 'You');
  assert.deepEqual(Array.from(value.sections[1].entries[0].children, item => item.label), ['History', 'Your videos']);
  s.service.destroy();
});

test('sidebar deduplicates pending requests, caches snapshots and refreshes after expiry', async () => {
  const s = fixture(); await Promise.all([s.service.read(), s.service.read()]);
  assert.equal(s.calls.length, 1);
  const value = await s.service.read(); value.sections[0].entries[0].label = 'Caller modification';
  assert.notEqual((await s.service.read()).sections[0].entries[0].label, 'Caller modification');
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
  assert.equal(explore(await s.service.read()).at(-1).label, 'Regional learning'); s.service.destroy();
});

test('malformed guide responses fail without consulting page data and can be retried', async () => {
  const s = fixture(count => count === 1 ? { contents: {} } : guideData());
  await assert.rejects(s.service.read(), /Sidebar guide unavailable/);
  assert.equal(explore(await s.service.read()).length, 2); s.service.destroy();
});

test('empty guide remains empty without inventing personal or regional destinations', async () => {
  const s = fixture(() => ({ items: [] })); const value = await s.service.read();
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { sections: [] }); s.service.destroy();
});

test('account changes reject stale guide results and load the current identity', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture(count => count === 1 ? gate : guideData());
  const first = s.service.read();
  while (!s.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  s.settings.SESSION_INDEX = 3;
  const second = s.service.read(); release(guideData());
  await assert.rejects(first, /cancelled/); assert.equal(explore(await second).length, 2);
  assert.equal(s.calls[1].headers['x-goog-authuser'], '3'); s.service.destroy();
});

test('destroy aborts pending guide requests and refuses new requests', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture(() => gate), pending = s.service.read();
  while (!s.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  s.service.destroy(); release(guideData());
  await assert.rejects(pending, /cancelled/); await assert.rejects(s.service.read(), /destroyed/);
  assert.equal(s.calls[0].signal.aborted, true);
});

test('guide preserves personal playlists, regional sections and collapsed links across account and sign-out changes', async () => {
  const makeEntry = (label, href) => ({ guideEntryRenderer: { formattedTitle: { simpleText: label },
    navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: href } } } } });
  const f = fixture(count => count === 1 ? { items: [
    { guideSectionRenderer: { items: [makeEntry('Shorts', '/shorts/fixture123')] } },
    { guideSectionRenderer: { formattedTitle: { simpleText: 'My library' }, items: [
      makeEntry('Travel', '/playlist?list=PLtravel'),
      { guideCollapsibleEntryRenderer: { expanderItem: makeEntry('Show more', '/'), expandableItems: [
        makeEntry('Private favorites', '/playlist?list=PLprivate'),
        makeEntry('Downloads', '/feed/downloads')
      ] } }
    ] } },
    { guideSectionRenderer: { formattedTitle: { simpleText: 'More from YouTube' }, items: [
      makeEntry('Music', 'https://music.youtube.com/'), makeEntry('Premium', '/premium'),
      makeEntry('Help', '/t/help'), makeEntry('Unsafe', 'https://evil.example/')
    ] } }
  ] } : { items: [{ guideSectionRenderer: { items: [makeEntry('Home', '/')] } }] });
  const first = await f.service.read();
  assert.deepEqual(Array.from(first.sections, section => section.label || ''), ['', 'My library', 'More from YouTube']);
  assert.deepEqual(links(first).filter(item => !item.children).map(item => item.label),
    ['Shorts', 'Travel', 'Private favorites', 'Downloads', 'Music', 'Premium', 'Help']);
  const group = first.sections[1].entries[1];
  assert.equal(group.label, 'Show more'); assert.equal(group.expanded, false);
  assert.equal('personal' in first, false); assert.equal('explore' in first, false);
  f.settings.SESSION_INDEX = 3;
  const second = await f.service.read();
  assert.deepEqual(links(second).map(item => item.label), ['Home']);
  assert.equal(JSON.stringify(second).includes('Private favorites'), false);
  f.settings.LOGGED_IN = false;
  await f.service.read();
  assert.equal(f.calls.length, 3);
  f.service.destroy();
});

test('region changes invalidate the guide cache and download wrappers retain their links', async () => {
  const f = fixture(() => ({ items: [{ guideSectionRenderer: { items: [{ guideDownloadsEntryRenderer: {
    entryRenderer: { guideEntryRenderer: { formattedTitle: { simpleText: 'Offline videos' },
      navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/feed/downloads' } } } } }
  } }] } }] }));
  assert.equal(links(await f.service.read())[0].href, '/feed/downloads');
  f.settings.INNERTUBE_CONTEXT.client.gl = 'JP'; await f.service.read();
  f.settings.INNERTUBE_CONTEXT.client.hl = 'ja'; await f.service.read();
  assert.equal(f.calls.length, 3); f.service.destroy();
});

test('signed-out guide keeps its sign-in destination without adding account-only links', async () => {
  const f = fixture(() => ({ items: [{ guideSigninPromoRenderer: { signInButton: { buttonRenderer: {
    text: { simpleText: 'Sign in' }, navigationEndpoint: { signInEndpoint: {} }
  } } } }] }));
  f.settings.LOGGED_IN = false;
  const value = await f.service.read();
  assert.deepEqual(links(value).map(item => [item.label, item.href]), [['Sign in', '/signin']]);
  assert.equal(value.sections.length, 1); f.service.destroy();
});
test('guide subscription IDs are exposed only as bounded channel identities',async()=>{
 const f=fixture(()=>{const data=guideData();data.items[3].guideSubscriptionsSectionRenderer.items[0].guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId='UCsubscriber';return data;});
 const result=await f.service.read();assert.deepEqual(Array.from(result.subscribedChannelIds),['UCsubscriber']);assert.equal(result.sections.filter(section=>section.id!=='subscriptions').flatMap(section=>flatten(section.entries)).some(item=>item.href==='/channel/UCsubscriber'),false);f.service.destroy();
});

test('subscribed people include names and safe avatars in guide order without duplicate or unsafe identities', async () => {
  const f = fixture(() => {
    const data = guideData();
    const items = data.items[3].guideSubscriptionsSectionRenderer.items;
    const entry = items[0].guideEntryRenderer;
    entry.navigationEndpoint.browseEndpoint.browseId = 'UCsubscriber';
    entry.thumbnail = { thumbnails: [{ url: 'https://yt3.ggpht.com/avatar', width: 40, height: 40 }] };
    items.push(structuredClone(items[0]));
    const unsafe = structuredClone(items[0]);
    unsafe.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId = 'UCsecond';
    unsafe.guideEntryRenderer.thumbnail.thumbnails[0].url = 'javascript:alert(1)';
    items.push(unsafe);
    return data;
  });
  const value = await f.service.read();
  assert.equal(value.subscriptions.length, 2);
  assert.equal(value.subscriptions[0].label, 'Subscribed creator');
  assert.equal(value.subscriptions[0].href, '/channel/UCsubscriber/videos');
  assert.equal(value.subscriptions[0].avatar, 'https://yt3.ggpht.com/avatar');
  assert.equal(value.subscriptions[1].id, 'UCsecond');
  assert.equal(value.subscriptions[1].avatar, undefined);
  f.service.destroy();
});

test('subscription status badges survive parsing, cache copies and refreshes without guessing missing states', async () => {
  const f = fixture(count => {
    const data = guideData(), items = data.items[3].guideSubscriptionsSectionRenderer.items;
    const entry = items[0].guideEntryRenderer;
    entry.navigationEndpoint.browseEndpoint.browseId = 'UCnew';
    entry.badges = count === 1 ? [{ newContent: true }] : [];
    for (const [id, badges] of [
      ['UClive', { liveBroadcasting: true, newContent: true }],
      ['UCrenderer', [{ liveBroadcastingBadgeRenderer: {} }, { newContentBadgeRenderer: {} }]],
      ['UCnone', undefined], ['UCinvalid', [{ newContent: 'true', liveBroadcasting: 1 }]]
    ]) {
      const next = structuredClone(items[0]);
      next.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId = id;
      next.guideEntryRenderer.badges = badges;
      items.push(next);
    }
    return data;
  });
  const value = await f.service.read();
  assert.deepEqual(Array.from(value.subscriptions, item => [item.id, item.isLive, item.hasNewContent]), [
    ['UCnew', false, true], ['UClive', true, true], ['UCrenderer', true, true],
    ['UCnone', false, false], ['UCinvalid', false, false]
  ]);
  value.subscriptions[0].hasNewContent = false;
  assert.equal((await f.service.read()).subscriptions[0].hasNewContent, true);
  f.advance();
  assert.equal((await f.service.read()).subscriptions[0].hasNewContent, false);
  f.service.destroy();
});


test('subscription newness reads the real guide presentation style including collapsed entries', async () => {
  const f = fixture(count => {
    const data = guideData(), items = data.items[3].guideSubscriptionsSectionRenderer.items;
    const entry = items[0].guideEntryRenderer;
    entry.navigationEndpoint.browseEndpoint.browseId = 'UCsubscriber';
    entry.presentationStyle = count === 1 ? 'GUIDE_ENTRY_PRESENTATION_STYLE_NEW_CONTENT' : 'GUIDE_ENTRY_PRESENTATION_STYLE_NONE';
    entry.badges = { liveBroadcasting: false };
    const nested = structuredClone(items[0]);
    nested.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId = 'UCnested';
    nested.guideEntryRenderer.formattedTitle = { simpleText: 'Nested channel' };
    items.push({ guideCollapsibleEntryRenderer: { expandableItems: [nested] } });
    const none = structuredClone(items[0]);
    none.guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId = 'UCnone';
    none.guideEntryRenderer.presentationStyle = 'GUIDE_ENTRY_PRESENTATION_STYLE_NONE';
    items.push(none);
    return data;
  });
  const snapshot = await f.service.read();
  assert.deepEqual(Array.from(snapshot.subscriptions, c => [c.id, c.hasNewContent, c.isLive]),
    [['UCsubscriber', true, false], ['UCnested', true, false], ['UCnone', false, false]]);
  f.advance();
  assert.equal((await f.service.read()).subscriptions.some(c => c.hasNewContent), false);
  f.service.destroy();
});
