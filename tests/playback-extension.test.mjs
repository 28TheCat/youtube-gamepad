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
document.querySelector('#movie_player').getPlayerResponse=()=>({videoDetails:{videoId:new URL(location.href).searchParams.get('v'),title:'Fixture video',author:'Fixture channel',isLive:false}});
</script></body></html>`;

test('R3 temporary speed restores the saved rate on release, menu and disconnect', { timeout: 60000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: true, autoFullscreen: false, language: 'en' }));
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture,
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
    await context.route('https://www.youtube.com/**', route => route.fulfill({contentType:'text/html',body:fixture,
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
