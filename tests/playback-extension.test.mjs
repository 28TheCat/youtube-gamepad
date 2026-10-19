import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension, virtualPad } from './helpers/extension.mjs';

const mediaSource = `
const video=document.querySelector('video');
video.dataset.paused='false'; video.dataset.position='30';
Object.defineProperties(video, {
paused:{get:()=>video.dataset.paused==='true'}, currentTime:{get:()=>Number(video.dataset.position),set:value=>video.dataset.position=String(value)},
duration:{get:()=>120}, readyState:{get:()=>4}, videoWidth:{get:()=>1280},
seekable:{get:()=>({length:1,start:()=>0,end:()=>120})}
});
video.play=async()=>{video.dataset.paused='false'}; video.pause=()=>{video.dataset.paused='true'};`;
const fixture = `<!doctype html><html><body><ytd-watch-flexy>
<div id="movie_player"><video></video></div>
<ytd-watch-metadata><h1>Fixture video</h1></ytd-watch-metadata>
<ytd-watch-next-secondary-results-renderer>${Array.from({length:6}, (_, i) => `<ytd-compact-video-renderer><a id="thumbnail" href="/watch?v=r${i}">Recommendation ${i}</a><span id="video-title">Recommendation ${i}</span></ytd-compact-video-renderer>`).join('')}</ytd-watch-next-secondary-results-renderer>
</ytd-watch-flexy><script>
${mediaSource}
window.ytcfg={get:key=>key==='INNERTUBE_CONTEXT'?{client:{clientVersion:'test'}}:undefined};
document.querySelector('#movie_player').getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),title:'Fixture video',author:'Fixture channel',isLive:false}});
</script></body></html>`;

const nextFixture = { contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results:
  Array.from({length:6}, (_, i) => ({compactVideoRenderer:{videoId:`r${i}`,title:{simpleText:`Recommendation ${i}`}}}))
} } } } };
function nextOrPage(route, options) {
  return route.request().url().includes('/youtubei/v1/next') ? route.fulfill({json:nextFixture}) : route.fulfill(options);
}

test('InnerTube recommendations and playlist queue work without native cards and retain queue navigation', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, language: 'en' }));
  const body = fixture.replace(/<ytd-watch-next-secondary-results-renderer>[\s\S]*?<\/ytd-watch-next-secondary-results-renderer>/, '');
  const calls = [];
  const queue = { playlistId: 'PLtest', contents: [
    { playlistPanelVideoRenderer: { videoId: 'fixture', title: { simpleText: 'Current' }, selected: true, navigationEndpoint: { watchEndpoint: { videoId: 'fixture', playlistId: 'PLtest', index: 0 } } } },
    { playlistPanelVideoRenderer: { videoId: 'queued', title: { simpleText: 'Queued video' }, navigationEndpoint: { watchEndpoint: { videoId: 'queued', playlistId: 'PLtest', index: 1 } } } }
  ] };
  await context.route('https://www.youtube.com/**', async route => {
    if (route.request().url().includes('/youtubei/v1/next')) {
      calls.push(route.request().postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 1000));
      return route.fulfill({ json: { contents: { twoColumnWatchNextResults: { ...nextFixture.contents.twoColumnWatchNextResults, playlist: { playlist: queue } } } } });
    }
    return route.fulfill({ contentType: 'text/html', body });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture&list=PLtest&index=1');
  const host = page.locator('#ytg-watch');
  await host.locator('.card').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('ytd-compact-video-renderer').count(), 0);
  assert.equal(calls[0].videoId, 'fixture');
  assert.equal(calls[0].playlistId, 'PLtest');
  assert.equal(calls[0].index, 0);
  assert.equal(await host.locator('.card').count(), 7);
  const setPad = await virtualPad(context, page);
  await page.bringToFront(); await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-theater'));
  await setPad({ connected: true, button: 13 }); await page.waitForTimeout(200); await setPad({ connected: true });
  const queued = host.locator('.card').filter({ hasText: 'Queued video' });
  await queued.waitFor({ state: 'visible' });
  assert.match(await queued.innerText(), /Playlists/);
  await queued.click();
  await page.waitForURL('**/watch?v=queued&list=PLtest&index=2');
});

test('saved playback layouts reach the real content bridge and restore native controls', { timeout: 60000 }, async t => {
  const { context, worker, options } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, playbackLayout: 'wide' }));
  const body = fixture.replace('<div id="movie_player">', '<div id="movie_player"><button class="ytp-size-button" onclick="this.closest(\'ytd-watch-flexy\').toggleAttribute(\'theater\')">Theater</button>');
  await context.route('https://www.youtube.com/**', route => nextOrPage(route, { contentType: 'text/html', body }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await page.waitForFunction(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-watch-layout')), false);
  await options.goto(options.url().split('#')[0] + '#display');
  await options.locator('#playbackLayout').selectOption('page');
  await page.waitForFunction(() => document.documentElement.classList.contains('ytg-watch-layout'));
  await options.locator('#playbackLayout').selectOption('normal');
  await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-watch-layout') && !document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
  assert.equal(await page.locator('#ytg-watch').isVisible(), false);
});

test('held media previews and commits on release through real extension input', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, language: 'en', rightHandMode: false, repeatDelay: 350, repeatInterval: 140 }));
  await context.route('https://www.youtube.com/**', route => nextOrPage(route, { contentType: 'text/html', body: fixture,
    headers: { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=fixture');
  const host = page.locator('#ytg-watch'); await host.waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  const cdp = await context.newCDPSession(page), worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await cdp.send('Runtime.enable');
  let isolatedId;
  for (const world of worlds.filter(world => !world.auxData?.isDefault)) {
    const probe = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: 'typeof chrome !== "undefined" && !!chrome.runtime?.id' });
    if (!probe.result.value) continue;
    isolatedId = world.id;
    const media = mediaSource.replace('duration:{get:()=>120}', 'duration:{get:()=>3600}')
      .replace('set:value=>video.dataset.position=String(value)', 'set:value=>{video.dataset.position=String(value);video.dataset.seekCount=String(Number(video.dataset.seekCount||0)+1)}');
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: `(()=>{${media}})()` });
    assert.equal(result.exceptionDetails, undefined);
  }
  assert.ok(isolatedId);
  const command = action => cdp.send('Runtime.evaluate', { contextId: isolatedId,
    expression: `window.dispatchEvent(new CustomEvent('yt-gamepad-action',{detail:{action:'${action}'}}))` });
  await page.bringToFront(); await setPad({ connected: true });
  await page.waitForFunction(() => document.documentElement.dataset.ytgMode === 'playback');
  const neutral = async () => { await setPad({ connected: true }); await page.waitForTimeout(100); };
  const position = () => page.locator('video').getAttribute('data-position');
  const count = async () => Number(await page.locator('video').getAttribute('data-seek-count') || 0);

  await setPad({ connected: true, button: 5 });
  await host.locator('.seek-target').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Number(/\+(\d+)/.exec(document.querySelector('#ytg-watch').shadowRoot.querySelector('.seek-change')?.textContent || '')?.[1]) >= 70);
  assert.equal(await position(), '30'); assert.equal(await count(), 0);
  const preview = await host.locator('.seek-target').textContent();
  assert.match(preview, /Seek to \d+:\d\d/);
  await page.screenshot({ path: 'output/playwright/held-seek-preview.png' });
  await neutral();
  const afterHold = Number(await position());
  assert.ok(afterHold >= 100); assert.equal(await count(), 1);
  assert.equal(await page.locator('video').getAttribute('data-paused'), 'false');

  await setPad({ connected: true, button: 4 });
  await host.locator('.seek-target').waitFor({ state: 'visible' });
  assert.match(await host.locator('.seek-change').textContent(), /−10/);
  await neutral(); assert.equal(Number(await position()), afterHold - 10); assert.equal(await count(), 2);

  await setPad({ connected: true, button: 5 }); await host.locator('.seek-target').waitFor({ state: 'visible' });
  await command('help'); await page.locator('#yt-gamepad-menu').waitFor({ state: 'visible' });
  await page.waitForTimeout(500); assert.equal(await count(), 2);
  await command('back'); await page.locator('#yt-gamepad-menu').waitFor({ state: 'hidden' });
  await page.waitForTimeout(500); assert.equal(await count(), 2);
  assert.equal(await host.locator('.seek-target').count(), 0);
  await neutral(); assert.equal(await count(), 2);

  // Volume buttons live in the quick menu, not the playback toolbar.
  await page.locator('video').evaluate(video => { video.volume = .4; });
  await command('help');
  const menu = page.locator('#yt-gamepad-menu');
  await menu.waitFor({ state: 'visible' });
  await menu.getByRole('button', { name: 'Volume +', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').volume - .45) < 1e-9);
  assert.equal(await menu.locator('#message').textContent(), 'Done');
  await menu.getByRole('button', { name: 'Volume −', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').volume - .4) < 1e-9);
  await command('back'); await menu.waitFor({ state: 'hidden' });

  await page.locator('video').evaluate(video => { video.volume = .5; });
  await setPad({ connected: true, button: 7 });
  await page.waitForFunction(() => document.querySelector('video').volume >= .65);
  await neutral(); const volume = await page.locator('video').evaluate(video => video.volume);
  await page.waitForTimeout(400); assert.equal(await page.locator('video').evaluate(video => video.volume), volume);
  await setPad({ connected: true, button: 2 }); await page.waitForTimeout(800);
  assert.equal(await page.locator('video').getAttribute('data-paused'), 'true'); await neutral();

  await setPad({ connected: true, button: 5 }); await host.locator('.seek-target').waitFor({ state: 'visible' });
  await setPad({ connected: false }); await page.waitForTimeout(500);
  assert.equal(await count(), 2); assert.equal(Number(await position()), afterHold - 10);
  assert.equal(await host.locator('.seek-target').count(), 0);
  assert.deepEqual(errors, []); await cdp.detach();
});

test('R3 temporary speed restores the saved rate on release, menu and disconnect', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, language: 'en' }));
  await context.route('https://www.youtube.com/**', route => nextOrPage(route, { contentType: 'text/html', body: fixture,
    headers: { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } }));
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await page.locator('#ytg-watch').waitFor({ state: 'attached' });
  const setPad = await virtualPad(context, page);
  const cdp = await context.newCDPSession(page), worlds = [];
  let isolatedId;
  cdp.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await cdp.send('Runtime.enable');
  for (const world of worlds.filter(world => !world.auxData?.isDefault)) {
    const probe = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: 'typeof chrome !== "undefined" && !!chrome.runtime?.id' });
    if (!probe.result.value) continue;
    isolatedId = world.id;
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: `(()=>{${mediaSource}})()` });
    assert.equal(result.exceptionDetails, undefined);
  }
  await page.locator('video').evaluate(video => { video.playbackRate = 1.5; });
  await setPad({ connected: true }); await page.bringToFront();
  await page.waitForFunction(() => document.documentElement.dataset.ytgMode === 'playback');
  const rate = value => page.waitForFunction(value => document.querySelector('video').playbackRate === value, value);
  const hold = async () => {
    await setPad({ connected: true }); await page.waitForTimeout(100);
    await setPad({ connected: true, button: 11 });
    await rate(2);
    await page.locator('#ytg-temporary-speed').waitFor({ state: 'visible' });
    assert.match(await page.locator('#ytg-temporary-speed').textContent(), /2×/);
  };
  await hold();
  await setPad({ connected: true }); await rate(1.5);
  await page.locator('#ytg-temporary-speed').waitFor({ state: 'hidden' });
  await hold();
  // Open through the production action route while physical R3 stays held.
  await cdp.send('Runtime.evaluate', { contextId: isolatedId,
    expression: "window.dispatchEvent(new CustomEvent('yt-gamepad-action',{detail:{action:'help'}}))" });
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'visible' });
  await rate(1.5);
  await page.waitForTimeout(450);
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
  await setPad({ connected: true }); await page.waitForTimeout(100);
  await setPad({ connected: true, button: 1 }); await page.waitForTimeout(150);
  await setPad({ connected: true }); await page.waitForTimeout(150);
  await hold();
  await setPad({ connected: false }); await rate(1.5);
  await page.locator('#ytg-temporary-speed').waitFor({ state: 'hidden' });
  await cdp.detach();
});

for (const trustedTypes of [false, true]) {
  test(`production Vue playback retains gamepad focus and native navigation (Trusted Types: ${trustedTypes})`, {timeout:60000}, async t => {
    const {context, worker} = await launchExtension(t);
    await worker.evaluate(() => chrome.storage.local.set({enabled:true,autoFullscreen:false}));
    await context.route('https://www.youtube.com/**', route => nextOrPage(route, {contentType:'text/html',body:fixture,
      headers:trustedTypes ? {'content-security-policy':"require-trusted-types-for 'script'; trusted-types 'none'"} : {}}));
    const page=await context.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('console', message=>{if(message.type()==='error' && /TypeError|ReferenceError|TrustedHTML/.test(message.text())) errors.push(message.text());});
    await page.goto('https://www.youtube.com/watch?v=fixture');
    const host=page.locator('#ytg-watch');
    await host.waitFor({state:'attached'});
    const setPad=await virtualPad(context,page);
    // The media fixture must expose the same native state in both Chrome worlds.
    const cdp=await context.newCDPSession(page), worlds=[];
    cdp.on('Runtime.executionContextCreated', ({context:world})=>worlds.push(world));
    await cdp.send('Runtime.enable');
    for (const world of worlds.filter(world=>!world.auxData?.isDefault)) {
      const probe=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:'typeof chrome !== "undefined" && !!chrome.runtime?.id'});
      if (!probe.result.value) continue;
      const result=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:`(()=>{${mediaSource}})()`});
      assert.equal(result.exceptionDetails,undefined);
    }
    await cdp.detach();
    await setPad({connected:true}); await page.bringToFront();
    await page.waitForFunction(()=>document.documentElement.classList.contains('ytg-theater'));
    await page.waitForFunction(()=>document.documentElement.dataset.ytgMode === 'playback');
    const press=async button=>{
      await setPad({connected:true}); await page.waitForTimeout(120);
      await setPad({connected:true,button}); await page.waitForTimeout(140);
      await setPad({connected:true}); await page.waitForTimeout(120);
    };
    const active=()=>host.evaluate(node=>node.shadowRoot.activeElement?.dataset.focusId);
    await press(12); await host.locator('[data-vue-playback]').waitFor();
    assert.equal(await active(),'playPause');
    await press(0);
    assert.equal(await page.locator('video').getAttribute('data-paused'),'true');
    assert.equal(await host.locator('[data-action="playPause"]').getAttribute('aria-label'),'Play');
    await host.locator('[data-action="playPause"]').evaluate(node=>{window.__playButton=node;});
    await page.locator('video').evaluate(node=>{node.dataset.position='60';});
    await page.waitForFunction(()=>document.querySelector('#ytg-watch').shadowRoot.querySelector('[role="slider"]').getAttribute('aria-valuenow')==='60');
    assert.equal(await host.locator('[data-action="playPause"]').evaluate(node=>node===window.__playButton),true);
    assert.equal(await active(),'playPause');
    await press(12); await press(0); await press(14);
    assert.ok(Number(await page.locator('video').getAttribute('data-position'))<60);
    await press(1); await press(1);
    assert.equal(await active(),'playPause');
    await press(13); assert.equal(await active(),'recommendation:r0:0', JSON.stringify(await host.evaluate(node => ({
      cards: Array.from(node.shadowRoot.querySelectorAll('.card')).map(card => ({ id: card.dataset.focusId, hidden: card.hidden, selected: card.classList.contains('selected') })),
      classes: document.documentElement.className, errors: window.__testErrors
    }))));
    await press(0); await page.waitForURL('**/watch?v=r0');
    assert.deepEqual(errors,[]);
  });
}
