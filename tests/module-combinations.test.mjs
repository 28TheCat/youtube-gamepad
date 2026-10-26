import { legacyModuleSource } from '../scripts/test-source.mjs';
import { controllerAssets } from '../scripts/controller-assets.mjs';
import { mainFixture } from './helpers/main-bundle.mjs';
import { inlineSettingsFixture } from './helpers/inline-bundle.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';

// These integration tests use real DOM, focus events and MutationObserver.
// Install playwright, or expose the bundled package through NODE_PATH.
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {}
if (!chromium && process.env.REQUIRE_BROWSER_TESTS === '1') {
  throw new Error('Browser verification requires playwright. Run npm ci.');
}
const mainSource = chromium ? await mainFixture() : '';
const repository = new URL('../', import.meta.url);
const releaseRoot = process.env.YTG_EXTENSION_ROOT === 'latest-release'
  ? JSON.parse(readFileSync(new URL('output/releases/latest.json', repository), 'utf8')).directory
  : process.env.YTG_EXTENSION_ROOT;
const root = releaseRoot ? pathToFileURL(resolve(releaseRoot) + sep) : repository;
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const entry = manifest.content_scripts.find(entry => entry.world === 'MAIN');
const fixture = `<!doctype html><html><head><style>
  body{margin:0;padding:24px}button,a,input{display:inline-block;padding:16px}
  ytd-rich-item-renderer{display:inline-block;margin:12px}
  [role=dialog]{position:fixed;top:100px;left:100px;background:white;padding:24px}
  [hidden]{display:none!important}
  </style></head><body>
  <ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=a">A</a></ytd-rich-item-renderer>
  <ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=b">B</a></ytd-rich-item-renderer>
  <ytd-rich-item-renderer><a id="thumbnail" href="/watch?v=c">C</a></ytd-rich-item-renderer>
  <ytd-masthead><input id="search"><button id="search-icon-legacy">Search</button></ytd-masthead>
  </body></html>`;

async function setup(t, pathname = '/', connected = true, recommendationCount = 3) {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught errors across module boundaries'));
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('https://www.youtube.com/youtubei/v1/next**', async route => {
    const append = !!route.request().postDataJSON().continuation;
    if (append) await page.evaluate(() => { window.recommendationLoads = (window.recommendationLoads || 0) + 1; });
    const start = append ? recommendationCount + 1 : 1;
    const end = append ? recommendationCount + 4 : recommendationCount;
    const results = Array.from({ length: end - start + 1 }, (_, i) => ({ compactVideoRenderer: {
      videoId: `r${start + i}`, title: { simpleText: `推荐 ${start + i}` },
      shortBylineText: { simpleText: '示例频道' }, viewCountText: { simpleText: '1万次观看 · 1年前' }, lengthText: { simpleText: '11:53' }
    } }));
    if (recommendationCount > 3 && !append) results.push({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'more' } } } });
    return route.fulfill({ json: append ? { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: results } }] }
      : { contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results } } } } } });
  });
  await page.goto('https://www.youtube.com' + pathname);
  await page.evaluate(() => { window.originalHistory = { pushState: history.pushState, replaceState: history.replaceState }; });
  if (pathname.startsWith('/watch')) await page.evaluate(() => {
    window.ytcfg = { get: () => ({ client: { clientVersion: 'test' } }) };
    const player = document.createElement('div'); player.id = 'movie_player';
    player.getPlayerResponse = () => ({ videoDetails: { videoId: 'current', title: 'Current video' } });
    const video = document.createElement('video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 300 });
    player.append(video);
    for (const name of ['ytp-play-button', 'ytp-settings-button']) {
      const button = document.createElement('button'); button.className = name; player.append(button);
    }
    document.body.append(player);
    for (const key of ['r1', 'r2', 'r3']) {
      const card = document.createElement('ytd-compact-video-renderer'); card.dataset.key = key;
      const anchor = document.createElement('a'); anchor.href = '/watch?v=' + key;
      const title = document.createElement('span'); title.id = 'video-title'; title.textContent = key;
      anchor.append(title); card.append(anchor); document.body.append(card);
    }
  });
  // UI scenarios explicitly start with a connected, idle standard controller.
  await page.evaluate(connected => Object.defineProperty(navigator, 'getGamepads', {
    configurable: true, value: () => connected ? [{ index: 0, connected: true, mapping: 'standard',
      axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }]
      : []
  }), connected);
  for (const path of entry.css) await page.addStyleTag({ path: fileURLToPath(new URL(path, root)) });
  await page.addScriptTag({ content: mainSource });
  // Only the extension-side storage/connection bridge is absent. All MAIN modules
  // including gamepad, core, views, site adapter and coordinator are real.
  if (connected) await page.waitForFunction(() => window.YTGamepadCoordinator.state.enabled);
  if (pathname.startsWith('/watch')) await page.locator('#ytg-watch').locator('.card').first().waitFor({ state: 'attached' });
  await page.evaluate(() => {
    window.focusLog = [];
    document.addEventListener('focusin', event => window.focusLog.push(event.target.id || event.target.getAttribute('href')));
    if (window.YTGamepadCoordinator.state.enabled) window.YTGamepad.focus(document.querySelector('a[href="/watch?v=b"]'));
  });
  return page;
}

test('home return restores native category, rebuilt grid, scroll and original card focus', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.locator('[data-ytg-page-mode]').click();
  await page.evaluate(() => {
    const manager = document.createElement('ytd-page-manager');
    manager.style.cssText = 'display:block;padding-top:850px;min-height:3000px';
    const grid = document.createElement('div'); grid.id = 'return-grid';
    for (const card of document.querySelectorAll('ytd-rich-item-renderer')) grid.append(card);
    manager.append(grid); document.body.append(manager);
    const bar = document.createElement('ytd-feed-filter-chip-bar-renderer');
    bar.style.cssText = 'position:fixed;top:0;left:300px';
    for (const label of ['All', 'Music']) {
      const chip = document.createElement('yt-chip-cloud-chip-renderer');
      const button = document.createElement('button'); button.textContent = label; chip.append(button);
      chip.setAttribute('selected', String(label === 'Music'));
      button.addEventListener('click', () => {
        for (const item of bar.children) item.setAttribute('selected', String(item === chip));
        if (label === 'Music') setTimeout(() => {
          grid.replaceChildren(...window.returnCards.map(card => card.cloneNode(true)));
        }, 200);
      });
      bar.append(chip);
    }
    document.body.append(bar);
    window.returnCards = Array.from(grid.children);
  });
  await page.locator('#return-grid a[href="/watch?v=b"]').waitFor();
  await page.evaluate(() => {
    const manager = document.querySelector('ytd-page-manager');
    const bar = document.querySelector('ytd-feed-filter-chip-bar-renderer');
    const grid = document.querySelector('#return-grid');
    scrollTo(0, 700);
    window.YTGamepad.focus(document.querySelector('#return-grid a[href="/watch?v=b"]'));
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=b'); manager.hidden = true; bar.hidden = true;
    scrollTo(0, 0); document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.replaceState({}, '', '/'); manager.hidden = false; bar.hidden = false;
    for (const chip of bar.children) chip.setAttribute('selected', String(chip.textContent === 'All'));
    const other = window.returnCards[0].cloneNode(true); other.querySelector('a').href = '/watch?v=other';
    grid.replaceChildren(other);
    scrollTo(0, 0); document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => !window.YTGamepad.restoring && window.YTGamepad.current?.getAttribute('href') === '/watch?v=b');
  assert.equal(await page.evaluate(() => window.YTGamepad.current?.closest('#return-grid')?.id), 'return-grid', 'restoration targets the visible native card');
  assert.deepEqual(await page.evaluate(() => ({
    category: document.querySelector('yt-chip-cloud-chip-renderer[selected="true"]').textContent,
    links: Array.from(document.querySelectorAll('#return-grid a')).map(link => link.getAttribute('href')),
    current: window.YTGamepad.current.getAttribute('href'),
    active: document.activeElement.getAttribute('href'), scroll: scrollY
  })), { category: 'Music', links: ['/watch?v=a', '/watch?v=b', '/watch?v=c'], current: '/watch?v=b', active: '/watch?v=b', scroll: 700 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => scrollY), 700, 'category watcher cannot reset the restored grid focus');
});

test('disabled controls keep native focus, Escape and layout through SPA navigation', { skip: !chromium }, async t => {
  const page = await setup(t, '/watch?v=current', false);
  await page.evaluate(() => window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin));
  await page.waitForFunction(() => !window.YTGamepadCoordinator.state.enabled);
  await page.locator('input#search').focus();
  await page.evaluate(() => {
    window.nativeEscape = false;
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.nativeEscape = !event.defaultPrevented;
    });
    window.postMessage({ source: 'yt-gamepad-settings', values: { enabled: false } }, location.origin);
    history.pushState({}, '', '/watch?v=next');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => ({
    enabled: window.YTGamepadCoordinator.state.enabled,
    adaptation: window.YTGamepadCoordinator.adaptation.status,
    nativeEscape: window.nativeEscape, focus: document.activeElement.id,
    selected: document.querySelectorAll('.ytg-selected').length,
    layout: ['ytg-theater', 'ytg-playback', 'ytg-controls', 'ytg-watch-active', 'ytg-browse']
      .some(name => document.documentElement.classList.contains(name)),
    loading: !!document.querySelector('#ytg-watch-loading'),
    ring: document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring').style.display
  })), { enabled: false, adaptation: 'inactive', nativeEscape: true, focus: 'search',
    selected: 0, layout: false, loading: false, ring: 'none' });
});

test('browse shoulders reach inner category buttons and update the native selected state', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const bar = document.createElement('ytd-feed-filter-chip-bar-renderer');
    for (const [index, label] of ['全部', '音乐', '播客'].entries()) {
      const chip = document.createElement('yt-chip-cloud-chip-renderer');
      chip.style.display = 'inline-block';
      const button = document.createElement('button'); button.textContent = label;
      if (index === 0) button.classList.add('ytChipShapeActive');
      button.addEventListener('click', () => {
        bar.querySelector('.ytChipShapeActive')?.classList.remove('ytChipShapeActive');
        button.classList.add('ytChipShapeActive');
      });
      chip.append(button); bar.append(chip);
    }
    document.body.prepend(bar);
  });
  const press = action => page.evaluate(action => window.YTGamepad.act(action), action);
  const selected = () => page.locator('.ytChipShapeActive').textContent();
  assert.equal(await press('seekForward'), 'handled');
  assert.equal(await selected(), '音乐');
  assert.equal(await press('seekForward'), 'handled');
  assert.equal(await selected(), '播客');
  assert.equal(await press('seekForward'), 'blocked');
  assert.equal(await press('seekBack'), 'handled');
  assert.equal(await selected(), '音乐');
});

test('watch loading leaves native media visible and applies player layout before navigation finishes', { skip: !chromium }, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const anchor = document.querySelector('a[href="/watch?v=b"]');
    anchor.addEventListener('click', event => {
      event.preventDefault();
      window.loadingBeforeNavigation = document.elementFromPoint(640, 450)?.id === 'ytg-watch-loading';
      document.dispatchEvent(new Event('yt-navigate-start'));
      const player = document.createElement('div'); player.id = 'movie_player';
      player.getPlayerResponse = () => ({ videoDetails: { videoId: 'old' } });
      const video = document.createElement('video'); video.className = 'html5-main-video';
      const container = document.createElement('div'); container.className = 'html5-video-container';
      container.append(video); player.append(container); document.body.append(player);
      history.pushState({}, '', anchor.href);
      window.playerAtRouteChange = player.getBoundingClientRect().toJSON();
      const below = document.createElement('div'); below.id = 'below'; below.textContent = 'Desktop details';
      const secondary = document.createElement('div'); secondary.id = 'secondary'; secondary.textContent = 'Desktop recommendations';
      document.body.append(below, secondary);
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    window.YTGamepad.act('confirm');
  });
  assert.equal(await page.evaluate(() => window.loadingBeforeNavigation), false);
  assert.equal(await page.evaluate(() => document.elementFromPoint(640, 450)?.closest('#movie_player')?.id), 'movie_player');
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), { x: 0, y: 48, width: 1280, height: 852 });
  assert.deepEqual(await page.evaluate(() => {
    const { x, y, width, height } = window.playerAtRouteChange; return { x, y, width, height };
  }), { x: 0, y: 48, width: 1280, height: 852 }, 'layout changes synchronously with the URL, before SPA finish');
  const banner = await page.locator('#ytg-watch-loading').boundingBox();
  assert.equal(banner.y + banner.height, 48, 'status strip ends where the player begins');
  assert.equal(await page.locator('#movie_player video').isVisible(), true);
  assert.equal(await page.locator('#movie_player video').evaluate(video => video.muted), false, 'loading does not alter native audio');
  assert.equal(await page.locator('#ytg-watch-loading').textContent(), 'Loading video…');
  assert.equal(await page.evaluate(() => window.YTGamepadCoordinator.adaptation.status), 'waiting');
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    player.getPlayerResponse = () => ({ videoDetails: { videoId: 'b', title: 'Video B' } });
    player.querySelector('video').dispatchEvent(new Event('playing'));
  });
  await page.waitForFunction(() => window.YTGamepadCoordinator.adaptation.status === 'ready');
  assert.equal(await page.locator('#ytg-watch-loading').isVisible(), false);
  assert.equal(await page.locator('#below').evaluate(node => {
    const style = getComputedStyle(node);
    return style.display === 'none' || style.opacity === '0';
  }), true, 'desktop details remain unpainted even during comment preloading');
  assert.equal(await page.locator('#secondary').isVisible(), false);
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), { x: 0, y: 0, width: 1280, height: 900 });
});

test('playing destination is visible while YouTube detail navigation is still pending', { skip: !chromium }, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    window.YTGamepadCoordinator.prepareVideo('/watch?v=next');
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=next');
    const video = document.querySelector('#movie_player video');
    Object.defineProperties(video, { readyState: { value: 3, configurable: true }, videoWidth: { value: 1280, configurable: true } });
    video.dispatchEvent(new Event('playing'));
  });
  assert.equal(await page.locator('#ytg-watch-loading').isVisible(), true, 'status remains while destination identity is pending');
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), { x: 0, y: 48, width: 1280, height: 852 });
  assert.equal(await page.locator('#movie_player video').isVisible(), true, 'player stays visible before destination readiness');
  await page.evaluate(() => {
    document.querySelector('#movie_player').getPlayerResponse = () => ({ videoDetails: { videoId: 'next' } });
    document.querySelector('#movie_player video').dispatchEvent(new Event('playing'));
  });
  assert.equal(await page.locator('#ytg-watch-loading').isVisible(), false, 'playing event reveals picture without waiting for page completion or polling');
  assert.deepEqual(await page.locator('#movie_player').boundingBox(), { x: 0, y: 0, width: 1280, height: 900 });
  assert.equal(await page.locator('#movie_player video').isVisible(), true);
  assert.equal(await page.evaluate(() => window.YTGamepadCoordinator.navigating), true);
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  assert.equal(await page.evaluate(() => window.YTGamepadCoordinator.navigating), false);
  assert.equal(await page.locator('#ytg-watch-loading').isVisible(), false);
});

async function nativeDialog(page) {
  await page.evaluate(() => {
    const dialog = document.createElement('div');
    dialog.id = 'native-dialog'; dialog.setAttribute('role', 'dialog');
    const first = document.createElement('button'); first.id = 'native-first'; first.textContent = 'First';
    const selected = document.createElement('button'); selected.id = 'native-selected'; selected.textContent = 'Selected';
    const close = document.createElement('button'); close.id = 'native-close'; close.setAttribute('aria-label', 'Close'); close.textContent = 'Close';
    close.addEventListener('click', () => dialog.remove());
    dialog.append(first, selected, close); document.body.append(dialog);
  });
  await page.waitForFunction(() => window.YTGamepad.hasOverlay);
  await page.evaluate(() => window.YTGamepad.focus(document.querySelector('#native-selected')));
}
const press = (page, action) => page.evaluate(action => window.YTGamepad.act(action), action);
const snapshot = page => page.evaluate(() => ({
  active: document.activeElement.id || document.activeElement.getAttribute('href'),
  current: window.YTGamepad.current?.id || window.YTGamepad.current?.getAttribute('href'),
  menu: window.YTGamepadMenu.opened, suspended: window.YTGamepadFocus.suspended,
  overlay: window.YTGamepad.hasOverlay,
  ring: document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring').style.display
}));
const options = { skip: !chromium && 'Requires playwright (install it or set NODE_PATH)' };

test('media feedback stays visible over pure playback, reuses volume UI and clears without owning focus', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.querySelector('video').volume = .5; });
  await press(page, 'seekForward');
  assert.deepEqual(await page.evaluate(() => {
    const host = document.querySelector('#ytg-watch'), status = host.shadowRoot.querySelector('.status');
    return { hidden: host.hidden, display: getComputedStyle(host).display, text: status.textContent, focus: window.YTGamepadWatch.ownsFocus };
  }), { hidden: true, display: 'block', text: '+10 seconds', focus: false });
  await press(page, 'volumeUp');
  await page.evaluate(() => { window.feedbackTrack = document.querySelector('#ytg-watch').shadowRoot.querySelector('.feedback-track'); });
  await press(page, 'volumeUp');
  assert.deepEqual(await page.evaluate(() => {
    const root = document.querySelector('#ytg-watch').shadowRoot;
    return { same: window.feedbackTrack === root.querySelector('.feedback-track'), text: root.querySelector('.status').textContent, width: root.querySelector('.feedback-level').style.width };
  }), { same: true, text: 'Volume 60%', width: '60%' });
  await page.waitForFunction(() => !document.querySelector('#ytg-watch').hasAttribute('data-feedback'));
  await page.evaluate(() => {
    const video = document.querySelector('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
  });
  await press(page, 'playPause');
  await page.waitForFunction(() => document.querySelector('#ytg-watch').getAttribute('data-feedback') === 'playPause');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.querySelector('.status svg') !== null), true);
  await page.evaluate(() => {
    history.pushState({}, '', '/'); document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await page.waitForFunction(() => !document.querySelector('#ytg-watch').hasAttribute('data-feedback'));
});

test('seek feedback never reveals the controls surface while buffering or fading out', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const video = document.querySelector('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    video.dispatchEvent(new Event('waiting'));
    window.seekSurfaceFrames = [];
    window.seekSurfaceSampling = true;
    const sample = () => {
      const host = document.querySelector('#ytg-watch');
      if (host.hidden && getComputedStyle(host).display !== 'none') {
        window.seekSurfaceFrames.push(getComputedStyle(host.shadowRoot.querySelector('.surface')).display);
      }
      if (window.seekSurfaceSampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await press(page, 'seekForward');
  await page.waitForFunction(() => !document.querySelector('#ytg-watch').hasAttribute('data-feedback'));
  await page.waitForTimeout(250);
  const frames = await page.evaluate(() => {
    window.seekSurfaceSampling = false;
    document.querySelector('video').dispatchEvent(new Event('playing'));
    return window.seekSurfaceFrames;
  });
  assert.ok(frames.length > 0, 'sampled the feedback and its closing transition');
  assert.ok(frames.every(display => display === 'none'), 'controls and recommendation cards stay hidden on every frame');
  await press(page, 'up');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ytg-watch').shadowRoot.querySelector('.surface')).display), 'flex');
});

test('media feedback respects reduced motion and failed media commands do not show success', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await press(page, 'volumeDown');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.querySelector('.status').getAnimations().length), 0);
  await page.waitForFunction(() => !document.querySelector('#ytg-watch').hasAttribute('data-feedback'));
  await page.evaluate(() => document.querySelector('video').remove());
  await press(page, 'seekForward');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').hasAttribute('data-feedback')), false);
});

test('watch recommendations page four cards at a time and append API continuation without losing focus', options, async t => {
  const page = await setup(t, '/watch?v=current', true, 16);
  await page.evaluate(() => {
    document.documentElement.dataset.ytgInputMode = 'gamepad';
    const secondary = document.createElement('div'); secondary.id = 'secondary';
    const list = document.createElement('ytd-watch-next-secondary-results-renderer');
    list.append(...document.querySelectorAll('ytd-compact-video-renderer'));
    const append = (start, end) => {
      for (let i = start; i <= end; i++) {
        const card = document.createElement('ytd-compact-video-renderer');
        const link = document.createElement('a'); link.href = '/watch?v=r' + i;
        const title = document.createElement('span'); title.id = 'video-title'; title.textContent = '推荐 ' + i;
        const channel = document.createElement('span'); channel.id = 'channel-name'; channel.textContent = '示例频道';
        const metadata = document.createElement('span'); metadata.id = 'metadata-line'; metadata.textContent = '1万次观看 · 1年前';
        const duration = document.createElement('ytd-thumbnail-overlay-time-status-renderer'); duration.textContent = '11:53';
        link.append(title, channel, metadata, duration); card.append(link); list.append(card);
      }
    };
    append(4, 16);
    const continuation = document.createElement('ytd-continuation-item-renderer');
    const button = document.createElement('button'); button.textContent = '加载更多';
    window.recommendationLoads = 0;
    button.onclick = () => { window.recommendationLoads++; append(17, 20); continuation.remove(); };
    continuation.append(button); list.append(continuation); secondary.append(list); document.body.append(secondary);
    window.YTGamepadWatch.refresh(); window.YTGamepadWatch.show();
  });
  const visible = () => page.locator('#ytg-watch').evaluate(host => [...host.shadowRoot.querySelectorAll('.card')]
    .filter(card => !card.hidden).map(card => card.dataset.videoId));
  await press(page, 'down');
  assert.deepEqual(await visible(), ['r1', 'r2', 'r3', 'r4']);
  await press(page, 'right');
  await press(page, 'down');
  assert.deepEqual(await visible(), ['r5', 'r6', 'r7', 'r8']);
  assert.equal(await page.evaluate(() => YTGamepadWatch.state.index), 5, 'paging keeps the selected column');
  const card = await page.locator('#ytg-watch').evaluate(host => {
    const root = host.shadowRoot, card = root.querySelector('.card.selected');
    const visible = [...root.querySelectorAll('.card')].filter(card => !card.hidden);
    return { duration: card.querySelector('.card-duration').textContent,
      metadata: [...card.querySelectorAll('.card-meta')].map(node => node.textContent),
      rows: new Set(visible.map(node => Math.round(node.getBoundingClientRect().top))).size,
      outline: getComputedStyle(card.querySelector('.card-thumbnail')).outlineStyle };
  });
  assert.equal(card.duration, '11:53');
  assert.deepEqual(card.metadata, ['示例频道', '1万次观看 · 1年前']);
  assert.equal(card.rows, 1); assert.equal(card.outline, 'solid');
  await press(page, 'down');
  await page.waitForFunction(() => YTGamepadWatch.state.recommendations === 20);
  assert.equal(await page.evaluate(() => recommendationLoads), 1);
  assert.equal(await page.evaluate(() => YTGamepadWatch.state.index), 9, 'appending recommendations preserves selection');
  await press(page, 'down'); await press(page, 'down');
  assert.deepEqual(await visible(), ['r17', 'r18', 'r19', 'r20']);
  await press(page, 'down');
  assert.equal(await page.evaluate(() => YTGamepadWatch.state.index), 17, 'end of recommendations cannot select a missing item');
  await press(page, 'up'); assert.deepEqual(await visible(), ['r13', 'r14', 'r15', 'r16']);
  await press(page, 'back'); assert.equal(await page.evaluate(() => YTGamepadWatch.state.row), 'controls');
  await press(page, 'down'); assert.deepEqual(await visible(), ['r13', 'r14', 'r15', 'r16']);
});

test('live DVR controls support pointer seeking, gamepad return and unavailable windows', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    const video = document.querySelector('video');
    window.dvrRanges = [[100, 200]];
    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
    Object.defineProperty(video, 'seekable', { configurable: true, get: () => ({
      length: window.dvrRanges.length, start: i => window.dvrRanges[i][0], end: i => window.dvrRanges[i][1]
    }) });
    video.currentTime = 150;
    window.YTGamepadWatch.show();
  });
  const progress = page.locator('#ytg-watch').locator('.progress');
  await progress.click({ position: { x: 10, y: 12 } });
  assert.ok(await page.evaluate(() => document.querySelector('video').currentTime >= 100));
  await page.evaluate(() => {
    window.dvrRanges = [[120, 240]];
    const watch = window.YTGamepadWatch;
    watch.show();
    const controls = [...document.querySelector('#ytg-watch').shadowRoot.querySelectorAll('[data-action]')];
    const liveIndex = controls.findIndex(button => button.dataset.action === 'goLive');
    // Volume controls now follow Go live; reaching the last button is not Go live.
    for (let i = 0; i < controls.length && watch.state.index < liveIndex; i++) watch.handle('right');
    if (watch.state.index !== liveIndex) throw new Error('Gamepad did not reach Go live');
    watch.handle('confirm');
  });
  assert.equal(await page.evaluate(() => document.querySelector('video').currentTime), 240);
  await page.evaluate(() => { window.dvrRanges = []; window.YTGamepadWatch.refresh(); });
  assert.equal(await progress.isDisabled(), true);
  await page.evaluate(() => window.YTGamepadWatch.handle('up'));
  assert.equal(await page.evaluate(() => window.YTGamepadWatch.state.row), 'controls');
});

test('controller hints switch in open search and watch UI without disturbing input or focus', options, async t => {
  const page = await setup(t, '/watch?v=current');
  const directory = resolve(fileURLToPath(repository), 'output/playwright');
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => {
    window.testController = { id: '', connected: true, mapping: 'standard', index: 0,
      buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testController] });
    window.YTGamepadWatch.show(); window.YTGamepadMenu.openSearch();
    const root = document.querySelector('#yt-gamepad-menu').shadowRoot;
    const input = root.querySelector('#query'); input.value = 'controller test'; input.setSelectionRange(3, 7);
    root.querySelector('[data-action="BACKSPACE"]').focus();
    window.controllerFocus = root.activeElement;
  });
  for (const [id, family, confirm, remove, search, back] of [
    ['Xbox Wireless Controller', 'xbox', 'A', 'X', 'RT', 'B'],
    ['DualSense Wireless Controller', 'playstation', '×', '□', 'R2', '○'],
    ['Switch Pro Controller', 'switch', 'B', 'Y', 'ZR', 'A']
  ]) {
    await page.evaluate(id => { window.testController.id = id; }, id);
    await page.waitForFunction(family => document.documentElement.dataset.ytgController === family, family);
    const result = await page.evaluate(() => {
      const root = document.querySelector('#yt-gamepad-menu').shadowRoot;
      const input = root.querySelector('#query');
      const badge = key => root.querySelector('#shortcuts [data-ytg-key="' + key + '"]').textContent;
      const watch = document.querySelector('#ytg-watch').shadowRoot;
      return { confirm: badge('A'), remove: badge('X'), search: badge('RT'), back: badge('B'),
        watchConfirm: watch.querySelector('.hint [data-ytg-key="A"]').textContent,
        watchLabel: watch.querySelector('.progress').getAttribute('aria-label'),
        title: root.querySelector('[data-action="BACKSPACE"]').title,
        count: root.querySelectorAll('.shortcut-item').length,
        query: input.value, cursor: [input.selectionStart, input.selectionEnd], focus: root.activeElement === window.controllerFocus,
        icon: (getComputedStyle(root.querySelector('#shortcuts [data-ytg-key="A"]'), '::before').maskImage !== 'none' ? getComputedStyle(root.querySelector('#shortcuts [data-ytg-key="A"]'), '::before').maskImage : getComputedStyle(root.querySelector('#shortcuts [data-ytg-key="A"]')).backgroundImage),
        aria: root.querySelector('#shortcuts [data-ytg-key="A"]').getAttribute('aria-label'),
        fontSize: getComputedStyle(root.querySelector('#shortcuts [data-ytg-key="A"]')).fontSize };
    });
    assert.equal(result.confirm, confirm); assert.equal(result.remove, remove); assert.equal(result.search, search); assert.equal(result.back, back);
    assert.equal(result.watchConfirm, confirm); assert.ok(result.watchLabel.includes(confirm + ' to start adjusting'));
    assert.equal(result.title, remove + ' Delete (hold to repeat)'); assert.equal(result.count, 11);
    assert.equal(result.query, 'controller test'); assert.deepEqual(result.cursor, [3, 7]); assert.equal(result.focus, true);
    const assets = controllerAssets(fileURLToPath(root));
    const original = readFileSync(new URL(assets.profiles[family].A, root)).toString('base64');
    assert.equal(result.icon, `url("data:image/svg+xml;base64,${original}")`);
    assert.equal(result.aria, confirm); assert.equal(result.fontSize, '0px');
    assert.deepEqual(await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, 'data:image/svg+xml;base64,' + original), [64, 64]);
    await page.screenshot({ path: resolve(directory, 'controller-' + family + '.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
    await page.waitForTimeout(180); // Allow the existing theme transition to finish before visual QA.
    await page.screenshot({ path: resolve(directory, 'controller-' + family + '-dark.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));
    await page.waitForTimeout(180);
  }
  await press(page, 'back');
  await press(page, 'help');
  assert.match(await page.locator('#yt-gamepad-menu').evaluate(host => host.shadowRoot.querySelector('#shortcuts').textContent), /B Confirm · A Back · \+ Close/);
  assert.deepEqual(await page.locator('#yt-gamepad-menu').evaluate(host => [...host.shadowRoot.querySelectorAll('#shortcuts [data-ytg-icon="true"]')].map(node => node.textContent)), ['B', 'A', '+']);
  assert.equal(await page.locator('#yt-gamepad-overlay').evaluate(host => host.shadowRoot.querySelectorAll('#help [data-ytg-icon="true"]').length), 10);
  await press(page, 'help');
  await page.evaluate(() => window.YTGamepadWatch.handle('up'));
  const combined = await page.locator('#ytg-watch').evaluate(host => {
    const node = host.shadowRoot.querySelector('[data-ytg-key="↓ / B"]');
    return { text: node.textContent, images: (getComputedStyle(node, '::before').maskImage !== 'none' ? getComputedStyle(node, '::before').maskImage : getComputedStyle(node).backgroundImage), icon: node.getAttribute('data-ytg-icon'),
      adjustLabel: host.shadowRoot.querySelector('.hint-item [data-ytg-hint]').textContent,
      language: host.getAttribute('lang') };
  });
  assert.equal(combined.text, '↓ / A'); assert.equal(combined.icon, 'true');
  assert.equal(combined.images.split('url(').length - 1, 2);
  assert.equal(combined.adjustLabel, 'Adjust position', 'English instructions must not mistake the verb Start for a controller button');
  assert.equal(combined.language, 'en');
});

test('extension popup and settings reuse controller artwork in their instructions', options, async t => {
  const page = await setup(t);
  for (const filename of ['src/popup/popup.html', 'src/settings/options.html']) {
    await page.goto('https://www.youtube.com/prompt-fixture');
    const html = readFileSync(new URL(filename, root), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
    await page.setContent(html);
    await page.evaluate(() => {
      window.chrome = {
        tabs: { query: async () => [{ id: 1 }], sendMessage: async () => ({ connected: true, controllerId: 'DualSense Wireless Controller' }) },
        storage: { local: { get: async () => ({ bindings: { confirm: 1, back: 0 } }) }, onChanged: { addListener() {}, removeListener() {} } }
      };
    });
    for (const path of ['src/ui/theme.css', filename.replace('.html', '.css')]) await page.addStyleTag({ path: fileURLToPath(new URL(path, root)) });
    await page.evaluate(() => {
      window.chrome.runtime = { getURL: path => 'https://www.youtube.com/' + path };
      window.chrome.storage.local.set = async () => {};
    });
    const bundle = filename.includes('/popup/') ? 'bundles/popup.js' : 'bundles/options.js';
    await page.addScriptTag({ content: readFileSync(new URL(bundle, releaseRoot ? root : new URL('dist/', repository)), 'utf8') });
    await page.waitForFunction(() => document.documentElement.dataset.ytgController === 'playstation');
    const hints = await page.locator('[data-ytg-hint]').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent, icons: [...node.querySelectorAll('[data-ytg-icon="true"]')].map(icon => ({ key: icon.textContent, image: (getComputedStyle(icon, '::before').maskImage !== 'none' ? getComputedStyle(icon, '::before').maskImage : getComputedStyle(icon).backgroundImage) }))
    })));
    assert.ok(hints.every(hint => hint.icons.length > 0));
    assert.ok(hints.some(hint => hint.icons.some(icon => icon.key === '×')));
    assert.ok(hints.every(hint => hint.icons.every(icon => icon.image.startsWith('url("data:image/svg+xml;base64,'))));
    assert.ok(hints.every(hint => !hint.text.includes('Start')));
    assert.ok(hints.some(hint => hint.text.includes('○ Confirm')));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  }
});

test('quick menu settings save inline, recover failures and return one level at a time', options, async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    window.inlineSaved = { enabled: true, theater: true, autoFullscreen: false };
    window.inlineListeners = new Set(); window.inlineFailure = false;
    window.chrome = { storage: { local: {
      async get(defaults) { return { ...defaults, ...window.inlineSaved }; },
      async set(next) {
        if (window.inlineFailure) throw new Error('save failed');
        Object.assign(window.inlineSaved, next);
        const changes = Object.fromEntries(Object.entries(next).map(([key, newValue]) => [key, { newValue }]));
        for (const listener of window.inlineListeners) listener(changes, 'local');
        window.postMessage({ source: 'yt-gamepad-settings', values: window.inlineSaved }, location.origin);
      }
    }, onChanged: { addListener: fn => window.inlineListeners.add(fn), removeListener: fn => window.inlineListeners.delete(fn) } } };
    let dispose;
    window.addEventListener('message', event => {
      if (event.data.source === 'yt-gamepad-close-settings') { dispose?.(); dispose = undefined; }
      if (event.data.source !== 'yt-gamepad-open-settings') return;
      const root = document.querySelector('#yt-gamepad-menu').shadowRoot;
      dispose?.(); dispose = window.YTGamepadInlineSettings.mount(root, root.querySelector('#inline-settings'));
    });
  });
  await page.addScriptTag({ content: await inlineSettingsFixture() });
  const menu = page.locator('#yt-gamepad-menu');
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await menu.getByRole('button', { name: 'All settings', exact: true }).click();
  await menu.getByRole('button', { name: 'Display & layout', exact: true }).click();
  await menu.locator('[data-setting="theater"]').click();
  await menu.locator('[data-setting="theater"][aria-pressed="false"]:not(:disabled)').waitFor();
  assert.equal(await page.evaluate(() => window.inlineSaved.theater), false);
  await page.evaluate(() => { window.inlineFailure = true; });
  await menu.locator('[data-setting="theater"]').click();
  await menu.locator('#message').filter({ hasText: 'Could not save settings' }).waitFor();
  assert.equal(await menu.locator('[data-setting="theater"]').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.inlineFailure = false; window.YTGamepadMenu.handle('back'); });
  await menu.getByRole('button', { name: 'Gamepad & buttons', exact: true }).click();
  await menu.locator('[data-setting="confirm"]').click();
  await menu.locator('[data-setting="1"]').click();
  await menu.locator('[data-setting="1"][aria-pressed="true"]:not(:disabled)').waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const bindings = window.inlineSaved.bindingLayouts?.browse || window.inlineSaved.bindings;
    return [bindings.confirm, bindings.back];
  }), [1, 0]);
  assert.equal(await menu.locator('[data-setting="1"] [data-inline-key]').getAttribute('data-ytg-first-key'), 'B');
  assert.match(await menu.locator('[data-setting="1"] [data-inline-key]').evaluate(node => (getComputedStyle(node, '::before').maskImage !== 'none' ? getComputedStyle(node, '::before').maskImage : getComputedStyle(node).backgroundImage)), /data:image\/svg\+xml;base64/);
  await page.evaluate(() => {
    const pad = navigator.getGamepads()[0];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ ...pad, id: 'DualSense' }] });
  });
  await menu.locator('[data-setting="1"] [data-inline-key][data-ytg-family="playstation"]').waitFor();
  assert.equal(await menu.locator('[data-setting="1"] [data-inline-key]').getAttribute('data-ytg-first-key'), 'B');
  await page.screenshot({ path: 'output/playwright/inline-settings-buttons.png' });
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.locator('[data-setting="resetBindings"]').click();
  await menu.locator('[data-setting="resetBindings"]:not(:disabled)').waitFor();
  assert.equal(await page.evaluate(() => (window.inlineSaved.bindingLayouts?.browse || window.inlineSaved.bindings).confirm), 0);
  await menu.locator('[data-setting="repeatDelay-+"]').click();
  await menu.locator('[data-setting="repeatDelay-+"]:not(:disabled)').waitFor();
  assert.equal(await page.evaluate(() => window.inlineSaved.repeatDelay), 360);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await page.screenshot({ path: 'output/playwright/inline-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/inline-settings-mobile.png' });
  assert.equal(await menu.locator('section').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  await menu.getByRole('button', { name: 'All settings', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.YTGamepadMenu.opened), true);
  await page.waitForFunction(() => window.inlineListeners.size === 0);
  await page.evaluate(() => window.YTGamepadMenu.handle('back'));
  assert.equal(await page.evaluate(() => window.YTGamepadMenu.opened), false);
});

test('settings shortcuts persist swaps, recover failed writes and fit mobile screens', options, async t => {
  const page = await setup(t);
  await page.route('https://www.youtube.com/assets/controller/*.svg', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(new URL(`assets/controller/${name}`, root)) });
  });
  await page.goto('https://www.youtube.com/settings-fixture');
  const html = readFileSync(new URL('src/settings/options.html', root), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.evaluate(() => {
    window.storedSettings = { autoFullscreen: true };
    window.storageListeners = []; window.failSave = false;
    window.chrome = { runtime: { getURL: path => 'https://www.youtube.com/' + path }, tabs: { query: async () => [] }, storage: { local: {
      get: async defaults => ({ ...(Array.isArray(defaults) ? {} : defaults), ...window.storedSettings }),
      set: async values => {
        if (window.failSave) throw new Error('storage unavailable');
        Object.assign(window.storedSettings, values);
        const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
        for (const listener of window.storageListeners) listener(changes, 'local');
      }
    }, onChanged: { addListener: listener => window.storageListeners.push(listener), removeListener: listener => { window.storageListeners = window.storageListeners.filter(value => value !== listener); } } } };
  });
  for (const path of ['src/ui/theme.css', 'src/settings/options.css']) await page.addStyleTag({ path: fileURLToPath(new URL(path, root)) });
  await page.addScriptTag({ content: readFileSync(new URL('bundles/options.js', releaseRoot ? root : new URL('dist/', repository)), 'utf8') });
  await page.waitForFunction(() => !document.getElementById('binding-confirm').disabled);
  await page.locator('[data-category-link="controller"]').click();
  await page.waitForFunction(() => !document.querySelector('#shortcuts').hidden);
  assert.equal(await page.locator('#shortcuts').isVisible(), true);
  await page.waitForFunction(() => [...document.querySelectorAll('#binding-confirm selectedcontent img')].every(image => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator('#binding-confirm selectedcontent img').count(), 2);
  await page.locator('#binding-confirm').click();
  assert.equal(await page.locator('#binding-confirm option[value="1"] img').first().isVisible(), true);
  await page.keyboard.press('Escape');
  // Native keyboard selection still saves and swaps the physical buttons.
  await page.locator('#binding-confirm').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.storedSettings.bindings?.confirm === 1);
  assert.match(await page.locator('#binding-confirm selectedcontent img').first().getAttribute('src'), /xbox_button_color_b\.svg$/);
  assert.match(await page.locator('#binding-back selectedcontent img').first().getAttribute('src'), /xbox_button_color_a\.svg$/);
  await page.locator('#binding-confirm').selectOption('1');
  assert.equal(await page.locator('#binding-back').inputValue(), '0');
  assert.equal(await page.evaluate(() => window.storedSettings.bindings.confirm), 1);
  await page.evaluate(() => { window.failSave = true; });
  await page.locator('#binding-search').selectOption('8');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Could not save'));
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('#status').isVisible(), true, 'save failures remain visible');
  assert.equal(await page.locator('#binding-search').inputValue(), '3');
  await page.evaluate(() => { window.failSave = false; });
  await page.locator('#resetBindings').click();
  assert.equal(await page.locator('#binding-confirm').inputValue(), '0');
  assert.equal(await page.locator('#binding-back').inputValue(), '1');
  await page.waitForFunction(() => document.querySelector('#status').hidden);
  await page.waitForTimeout(160);
  assert.equal(await page.locator('#status').isVisible(), false, 'success feedback fades away');
  // Each page owns a separate layout; swapping and reset cannot change the other.
  await page.locator('[data-binding-layout="browse"]').click();
  await page.locator('#binding-confirm').selectOption('1');
  await page.waitForFunction(() => window.storedSettings.bindingLayouts?.browse.confirm === 1 && !document.querySelector('#binding-confirm').disabled);
  assert.equal(await page.evaluate(() => window.storedSettings.bindingLayouts.watch.confirm), 0);
  await page.locator('[data-binding-layout="watch"]').click();
  assert.equal(await page.locator('#binding-confirm').inputValue(), '0');
  await page.locator('#binding-search').selectOption('8');
  await page.waitForFunction(() => window.storedSettings.bindingLayouts.watch.search === 8 && !document.querySelector('#binding-search').disabled);
  await page.locator('[data-binding-layout="browse"]').click();
  assert.equal(await page.locator('#binding-confirm').inputValue(), '1');
  assert.equal(await page.locator('#binding-search').inputValue(), '3');
  await page.locator('#resetBindings').click();
  await page.waitForFunction(() => window.storedSettings.bindingLayouts.browse.confirm === 0 && !document.querySelector('#resetBindings').disabled);
  assert.equal(await page.evaluate(() => window.storedSettings.bindingLayouts.watch.search), 8);
  await page.locator('[data-binding-layout="watch"]').click();
  await page.locator('#resetBindings').click();
  await page.waitForFunction(() => !document.querySelector('#resetBindings').disabled);
  await page.locator('.controller-hotspot[data-key="A"]').click();
  assert.equal(await page.locator('#binding-confirm option[value="1"] img').first().isVisible(), true);
  await page.keyboard.press('Escape');
  const directory = fileURLToPath(new URL('output/playwright/settings/', repository));
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  await page.screenshot({ path: resolve(directory, 'desktop-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true });
});

test('mouse takeover releases controller card focus without losing selection or keyboard focus', options, async t => {
  const page = await setup(t);
  await page.locator('[data-ytg-page-mode]').click();
  await page.evaluate(() => {
    const card = document.querySelector('ytd-rich-item-renderer');
    const title = document.createElement('a');
    title.id = 'video-title-link'; title.href = '/watch?v=a'; title.textContent = 'Video title';
    card.prepend(title);
    window.testPad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.bringToFront();
  await page.locator('#video-title-link').focus();
  await page.waitForFunction(() => window.YTGamepadInput.connected);
  await page.waitForTimeout(100);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { window.testPad.axes[0] = .8; });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  await page.evaluate(() => {
    window.testPad.axes[0] = 0;
    // A controller may restore the title link as its card target.
    window.YTGamepad.focus(document.querySelector('#video-title-link'));
  });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'video-title-link');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#video-title-link')).outlineStyle), 'none');
  await page.mouse.move(700, 700);
  await page.mouse.move(720, 700);
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'mouse');
  assert.equal(await page.evaluate(() => document.activeElement.id === 'video-title-link'), false,
    'controller focus must not reveal a native title outline when its CSS suppression is removed');
  assert.equal(await page.evaluate(() => window.YTGamepad.current.id), 'video-title-link',
    'the remembered controller selection survives mouse takeover');
  await page.locator('#video-title-link').hover();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#video-title-link')).outlineStyle), 'none');
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.YTGamepad.focus(document.querySelector('#video-title-link')));
  await page.mouse.move(740, 700);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'video-title-link',
    'mouse movement must not discard a keyboard-owned focus');
});

test('shared header preserves native sidebar and feed geometry across widths and guide states', options, async t => {
  const page = await setup(t);
  await page.locator('[data-ytg-page-mode]').click();
  await page.addStyleTag({ content: `
    body{padding:0} ytd-app,ytd-page-manager,ytd-rich-grid-renderer{display:block}
    ytd-app{--native-guide:72px}ytd-app[expanded]{--native-guide:240px}
    ytd-page-manager{margin-left:var(--native-guide);width:calc(100% - var(--native-guide));padding-top:180px}
    ytd-guide-renderer,ytd-mini-guide-renderer{position:fixed;top:180px;left:0;width:var(--native-guide);display:block}
    ytd-guide-renderer{display:none}ytd-app[expanded] ytd-guide-renderer{display:block}
    ytd-app[expanded] ytd-mini-guide-renderer{display:none}
    ytd-rich-grid-renderer{--ytd-rich-grid-items-per-row:4}
    ytd-rich-grid-row{display:flex}ytd-rich-item-renderer{margin:12px;flex:none;width:calc(100% / var(--ytd-rich-grid-items-per-row) - 24px)}
    ytd-rich-item-renderer a{display:block;padding:0;aspect-ratio:16/9}
    #video-title{font-size:15px}#avatar-link,#menu{display:block}
    ytd-feed-filter-chip-bar-renderer{display:block}
    #chips-wrapper{position:fixed;left:var(--native-guide);width:calc(100% - var(--native-guide));height:56px}
    ytd-feed-filter-chip-bar-renderer[not-sticky] #chips-wrapper{position:relative;left:0;width:100%}
  ` });
  await page.evaluate(() => {
    const app = document.createElement('ytd-app');
    const manager = document.createElement('ytd-page-manager');
    const grid = document.createElement('ytd-rich-grid-renderer');
    const row = document.createElement('ytd-rich-grid-row');
    row.append(...document.querySelectorAll('ytd-rich-item-renderer'));
    const chips = document.createElement('ytd-feed-filter-chip-bar-renderer');
    const wrapper = document.createElement('div'); wrapper.id = 'chips-wrapper';
    chips.append(wrapper); grid.append(chips, row); manager.append(grid);
    for (const tag of ['ytd-guide-renderer', 'ytd-mini-guide-renderer']) {
      const guide = document.createElement(tag), entry = document.createElement(tag === 'ytd-guide-renderer' ? 'ytd-guide-entry-renderer' : 'ytd-mini-guide-entry-renderer');
      const link = document.createElement('a');link.href='/feed/subscriptions';link.textContent='订阅';entry.append(link);guide.append(entry);app.append(guide);
    }
    const button = document.createElement('button'); button.id = 'guide-button';
    button.addEventListener('click', () => app.toggleAttribute('expanded'));
    document.querySelector('ytd-masthead').append(button);
    const card = row.firstElementChild;
    for (const id of ['video-title','avatar-link','menu']) { const item=document.createElement('span');item.id=id;item.textContent=id;card.append(item); }
    app.append(manager);document.body.append(app);
  });
  const measure = () => page.evaluate(() => {
    const rect = selector => { const { left, width } = document.querySelector(selector).getBoundingClientRect();return { left, width }; };
    return { feed:rect('ytd-page-manager'),card:rect('ytd-rich-item-renderer'),chips:rect('#chips-wrapper'),
      columns:getComputedStyle(document.querySelector('ytd-rich-grid-renderer')).getPropertyValue('--ytd-rich-grid-items-per-row'),
      title:getComputedStyle(document.querySelector('#video-title')).fontSize,
      avatar:getComputedStyle(document.querySelector('#avatar-link')).display,menu:getComputedStyle(document.querySelector('#menu')).display };
  });
  for (const width of [1280,900,600]) {
    await page.setViewportSize({ width,height:900 });
    for (const expanded of [false,true]) for (const sticky of [true,false]) {
      await page.evaluate(({expanded,sticky}) => {
        document.documentElement.classList.remove('ytg-theater');
        document.querySelector('ytd-app').toggleAttribute('expanded',expanded);
        document.querySelector('ytd-feed-filter-chip-bar-renderer').toggleAttribute('not-sticky',!sticky);
      },{expanded,sticky});
      await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-browse-header'));
      const native = await measure();
      await page.evaluate(() => document.documentElement.classList.add('ytg-theater'));
      await page.waitForFunction(() => document.documentElement.classList.contains('ytg-browse-header'));
      const adapted = native;
      assert.deepEqual(await measure(),adapted,'shared header preserves native widths, columns and metadata');
      const sidebar = expanded ? 'ytd-guide-renderer a' : 'ytd-mini-guide-renderer a';
      await page.evaluate(selector => window.YTGamepad.focus(document.querySelector(selector)),sidebar);
      assert.equal(await page.evaluate(selector => window.YTGamepad.current === document.querySelector(selector),sidebar),true,'native sidebar is a focus candidate');
      assert.deepEqual(await measure(),adapted,'focusing the sidebar does not resize the feed');
    }
  }
  assert.equal(await page.locator('#ytg-browse-sidebar').isVisible(),false);
  assert.equal(await page.locator('#ytg-browse-top').isVisible(),true);
  assert.equal(await page.locator('ytd-masthead').isVisible(),false);
  assert.equal(await page.locator('[data-ytg-page-mode]').getAttribute('aria-checked'),'false');
});

test('native video rows keep the current column through short rows and DOM replacement', options, async t => {
  const page = await setup(t);
  const result = await page.evaluate(() => {
    document.querySelectorAll('ytd-rich-item-renderer').forEach(card => card.remove());
    const cards = [];
    for (const [rowIndex, length] of [3, 1, 3].entries()) {
      const row = document.createElement('ytd-rich-grid-row');
      row.style.cssText = 'display:flex;height:180px';
      for (let column = 0; column < length; column++) {
        const card = document.createElement('ytd-rich-item-renderer');
        card.style.cssText = 'width:160px;height:100px;flex:none';
        const link = document.createElement('a'); link.id = 'thumbnail';
        link.href = `/watch?v=row${rowIndex}col${column}`; link.textContent = `${rowIndex}:${column}`;
        card.append(link); row.append(card); cards.push(link);
      }
      document.body.append(row);
    }
    const selected = () => window.YTGamepad.current.getAttribute('href');
    const selections = [];
    window.YTGamepad.focus(cards[2]);
    for (const direction of ['down', 'down', 'left', 'up']) {
      window.YTGamepad.act(direction); selections.push(selected());
    }
    cards[2].replaceWith(cards[2].cloneNode(true));
    window.YTGamepad.act('up'); selections.push(selected());
    window.YTGamepad.act('down'); window.YTGamepad.act('down'); selections.push(selected());
    window.YTGamepad.resetContentFocus(); selections.push(selected());
    return { selections, scrollY: window.scrollY };
  });
  assert.deepEqual(result.selections, ['/watch?v=row1col0', '/watch?v=row2col2',
    '/watch?v=row2col1', '/watch?v=row1col0', '/watch?v=row0col1',
    '/watch?v=row2col1', '/watch?v=row0col0']);
  assert.equal(result.scrollY, 0);
});

test('gamepad A activates the selected rating once without pausing playback', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    const video = document.querySelector('video');
    window.pauseCalls = 0; video.pause = () => window.pauseCalls++;
    Object.defineProperty(video, 'paused', { get: () => false });
    const metadata = document.createElement('ytd-watch-metadata');
    for (const kind of ['like', 'dislike']) {
      const model = document.createElement(kind + '-button-view-model');
      const button = document.createElement('button'); button.id = 'pad-' + kind; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => { window.ratingClicks++; button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true')); };
      model.append(button); metadata.append(model);
    }
    document.body.append(metadata); window.ratingClicks = 0;
    window.testPad = { index: 0, connected: true, mapping: 'standard', buttons: Array.from({length:17}, () => ({pressed:false,value:0})), axes:[0,0,0,0] };
    window.padSamples = 0;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
      window.padSamples++; return [window.testPad];
    } });
    document.hasFocus = () => true;
    window.dispatchEvent(new Event('gamepadconnected'));
    YTGamepadWatch.show();
  });
  const padButton = async index => {
    const pressSample = await page.evaluate(index => {
      testPad.buttons[index] = { pressed: true, value: 1 }; return window.padSamples;
    }, index);
    await page.waitForFunction(sample => window.padSamples > sample, pressSample);
    const releaseSample = await page.evaluate(index => {
      testPad.buttons[index] = { pressed: false, value: 0 }; return window.padSamples;
    }, index);
    await page.waitForFunction(sample => window.padSamples > sample, releaseSample);
  };
  await page.waitForFunction(() => window.padSamples >= 3);
  await padButton(15); await padButton(15);
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.action), 'like');
  await padButton(0);
  assert.equal(await page.locator('#pad-like').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.ratingClicks), 1);
  await padButton(15); await padButton(0);
  assert.equal(await page.locator('#pad-dislike').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.ratingClicks), 2);
  assert.equal(await page.evaluate(() => window.pauseCalls), 0);
});

test('Space and Enter activate a watch action before native player keyboard capture', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    window.keyActions = 0; window.playerKeys = 0;
    const model = document.createElement('like-button-view-model');
    const button = document.createElement('button'); button.onclick = () => window.keyActions++;
    model.append(button); const metadata = document.createElement('ytd-watch-metadata'); metadata.append(model); document.body.append(metadata);
    for (const type of ['keydown','keyup']) document.addEventListener(type, event => {
      if (event.key === ' ' || event.key === 'Enter') window.playerKeys++;
    }, true);
    YTGamepadWatch.show();document.querySelector('#ytg-watch').shadowRoot.querySelector('[data-action="like"]').focus();
  });
  await page.keyboard.press('Space'); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.keyActions), 2);
  assert.equal(await page.evaluate(() => window.playerKeys), 0);
});

test('watch social buttons operate hidden native metadata and synchronize their state', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    const below = document.createElement('div'); below.id = 'below';
    below.style.setProperty('display', 'none', 'important');
    below.innerHTML = `<ytd-watch-metadata><div id="subscribe-button"><ytd-subscribe-button-renderer>
      <button hidden>Inactive subscription</button><button id="native-subscribe" aria-pressed="false">订阅</button>
    </ytd-subscribe-button-renderer></div><div id="actions">
      <like-button-view-model hidden><button aria-pressed="false">Inactive</button></like-button-view-model>
      <like-button-view-model><button id="native-like" aria-label="与另外 100 人一起顶此视频" aria-pressed="false">100</button></like-button-view-model>
      <dislike-button-view-model><button id="native-dislike" aria-label="不喜欢此视频" aria-pressed="false"></button></dislike-button-view-model>
      <button id="native-save" aria-label="保存到播放列表">保存</button>
    </div></ytd-watch-metadata>`;
    document.body.append(below);
    for (const action of ['subscribe', 'like', 'dislike']) document.querySelector('#native-' + action).onclick = event => {
      const button = event.currentTarget;
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    };
    window.saveClicks = 0;
    document.querySelector('#native-save').onclick = () => window.saveClicks++;
    window.YTGamepadWatch.show();
  });
  assert.equal(await page.locator('#below').isVisible(), false);
  for (const action of ['subscribe', 'like', 'dislike']) {
    await page.locator('#ytg-watch').locator(`[data-action="${action}"]`).click();
    await page.waitForFunction(action => document.querySelector('#ytg-watch').shadowRoot.querySelector(`[data-action="${action}"]`).getAttribute('aria-pressed') === 'true', action);
    assert.equal(await page.locator('#native-' + action).getAttribute('aria-pressed'), 'true');
    await page.locator('#ytg-watch').locator(`[data-action="${action}"]`).click();
    assert.equal(await page.locator('#native-' + action).getAttribute('aria-pressed'), 'false');
  }
  // A different native layout must still resolve the localized accessible label.
  await page.evaluate(() => document.querySelector('#native-like').parentElement.replaceWith(document.querySelector('#native-like')));
  assert.equal(await page.evaluate(() => window.YTGamepadSite.performWatchAction('like')), true);
  assert.equal(await page.locator('#native-like').getAttribute('aria-pressed'), 'true');
  await page.locator('#ytg-watch').locator('[data-action="save"]').click();
  assert.equal(await page.evaluate(() => window.saveClicks), 1);
});

test('native account prompts take gamepad focus and B restores the social button', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    window.YTGamepadWatch.show();
    const shadow = document.querySelector('#ytg-watch').shadowRoot;
    shadow.querySelector('[data-action="like"]').focus();
    const dropdown = document.createElement('tp-yt-iron-dropdown');
    dropdown.close = () => dropdown.remove();
    const prompt = document.createElement('ytd-modal-with-title-and-button-renderer');
    prompt.style.cssText = 'position:fixed;left:200px;top:200px;display:block;background:white;padding:20px;z-index:2147483647';
    const login = document.createElement('a'); login.id = 'account-login'; login.href = '#login'; login.textContent = '登录';
    prompt.append(login); dropdown.append(prompt); document.body.append(dropdown);
  });
  await page.waitForFunction(() => window.YTGamepad.hasOverlay && document.activeElement.id === 'account-login');
  assert.equal(await page.evaluate(() => window.YTGamepadSite.hasNativeLayer()), true);
  await press(page, 'back');
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.action), 'like');
});

test('all MAIN modules: Escape and B share navigation guards and close one shadow/native layer at a time', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  await page.evaluate(() => {
    window.YTGamepadMenu.openSearch(document.querySelector('#search'));
    document.dispatchEvent(new Event('yt-navigate-start'));
  });
  assert.equal((await snapshot(page)).menu, true);
  await page.keyboard.press('Escape');
  const state = await snapshot(page);
  assert.equal(state.menu, true);
  assert.equal(state.ring, 'none');
  assert.equal(await press(page, 'back'), 'blocked');
  assert.equal(await page.evaluate(() => location.pathname), '/');
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  await page.keyboard.press('Escape');
  const native = await snapshot(page);
  assert.equal(native.menu, false);
  assert.equal(native.overlay, true);
  assert.equal(native.active, 'native-selected');
  assert.equal(await press(page, 'help'), 'blocked');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/watch?v=b');
  assert.equal((await snapshot(page)).suspended, false);
});

test('all MAIN modules: menu above native dialog restores dialog, then original page card', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  // Native layers deliberately block Start. An explicit public menu open tests
  // externally opened menus above an existing native layer without changing policy.
  assert.equal(await press(page, 'help'), 'blocked');
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await page.evaluate(() => window.YTGamepad.refresh());
  assert.equal((await snapshot(page)).ring, 'none');
  assert.equal(await press(page, 'back'), 'handled');
  const restored = await snapshot(page);
  assert.equal(restored.active, 'native-selected'); assert.equal(restored.current, 'native-selected');
  assert.equal(restored.overlay, true); assert.equal(restored.suspended, true); assert.equal(restored.ring, 'block');
  await page.evaluate(() => window.YTGamepad.focus(document.querySelector('#native-close')));
  await press(page, 'confirm');
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/watch?v=b');
  assert.equal((await snapshot(page)).suspended, false);
});

test('all MAIN modules: removed page target restores surviving neighbor after menu closes', options, async t => {
  const page = await setup(t); await press(page, 'help');
  await page.evaluate(() => document.querySelector('a[href="/watch?v=b"]').parentElement.remove());
  await page.evaluate(() => window.YTGamepad.refresh());
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'back');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/watch?v=c');
  assert.equal((await snapshot(page)).suspended, false);
});

test('all MAIN modules: removed native target restores its surviving neighbor', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await page.evaluate(() => document.querySelector('#native-selected').remove());
  await page.evaluate(() => window.YTGamepad.refresh());
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'back');
  assert.equal((await snapshot(page)).active, 'native-close');
});

test('all MAIN modules: deleting a native recommendation preserves the API selection in watch shadow UI', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await press(page, 'down'); await press(page, 'right');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'r2');
  await press(page, 'help');
  await page.evaluate(() => { document.querySelector('ytd-compact-video-renderer[data-key=r2]').remove(); window.YTGamepadWatch.refresh(); });
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'back');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'r2');
  assert.equal((await snapshot(page)).suspended, false);
});

test('native settings close restores the watch button once after surface visibility updates', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const button = player.querySelector('.ytp-settings-button');
    const menu = document.createElement('div'); menu.className = 'ytp-settings-menu'; menu.hidden = true;
    menu.style.cssText = 'position:fixed;top:100px;right:50px;width:250px;height:150px;background:#222';
    const quality = document.createElement('button'); quality.textContent = 'Quality'; menu.append(quality);
    button.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    player.append(button, menu);
    window.watchFocusLog = [];
    document.querySelector('#ytg-watch').shadowRoot.addEventListener('focusin', event => window.watchFocusLog.push(event.target.dataset.action));
  });
  await press(page, 'up');
  for (let i = 0; i < 7; i++) await press(page, 'right');
  await press(page, 'confirm');
  await page.waitForFunction(() => window.YTGamepad.hasOverlay);
  await page.evaluate(() => { window.watchFocusLog.length = 0; });
  // Simulate an external close too: it must not depend on the watch's timer.
  await page.evaluate(() => { document.querySelector('.ytp-settings-menu').hidden = true; });
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  const state = await page.evaluate(() => ({
    mode: window.YTGamepadCoordinator.mode,
    active: document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.action,
    hidden: document.documentElement.classList.contains('ytg-settings-open'),
    focus: window.watchFocusLog
  }));
  assert.equal(state.mode, 'controls'); assert.equal(state.active, 'settings');
  assert.equal(state.hidden, false); assert.deepEqual(state.focus, ['settings']);
});

test('native focus trap permits a covering menu and search, then restores the native target', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  await page.evaluate(() => {
    const dialog = document.querySelector('#native-dialog');
    const trap = event => {
      if (dialog.isConnected && !dialog.contains(event.target)) document.querySelector('#native-selected').focus();
    };
    document.addEventListener('focus', trap, true);
    document.addEventListener('focusin', trap);
    window.YTGamepadMenu.handle('help');
  });
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  assert.equal((await snapshot(page)).overlay, true);
  assert.equal(await page.evaluate(() => document.querySelector('#native-dialog').inert), true);
  // Even a direct programmatic focus attempt cannot steal the menu's focus.
  await page.evaluate(() => document.querySelector('#native-first').focus());
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'search'); await page.keyboard.press('Tab');
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'back'); await press(page, 'back');
  assert.equal((await snapshot(page)).active, 'native-selected');
  assert.equal(await page.evaluate(() => document.querySelector('#native-dialog').hasAttribute('inert')), false);
});

test('all MAIN modules: disappearing native dialog does not steal focus from covering menu', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await page.evaluate(() => { window.focusLog.length = 0; document.querySelector('#native-dialog').remove(); });
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  assert.deepEqual(await page.evaluate(() => window.focusLog), []);
  await press(page, 'back');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/watch?v=b');
});

test('all MAIN modules: route change discards native restore target and restores new page after menu', options, async t => {
  const page = await setup(t); await nativeDialog(page);
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    document.querySelector('#native-dialog').remove();
    for (const card of document.querySelectorAll('ytd-rich-item-renderer')) card.remove();
    const card = document.createElement('ytd-rich-item-renderer');
    const anchor = document.createElement('a'); anchor.id = 'thumbnail'; anchor.href = '/watch?v=new'; anchor.textContent = 'New page';
    card.append(anchor); document.body.append(card);
    history.pushState({}, '', '/results?search_query=new');
    window.focusLog.length = 0;
  });
  assert.equal(await press(page, 'back'), 'blocked');
  await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  assert.deepEqual(await page.evaluate(() => window.focusLog), []);
  await press(page, 'back');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/watch?v=new');
  assert.equal((await snapshot(page)).suspended, false);
  assert.equal((await snapshot(page)).overlay, false);
});

test('all MAIN modules: destroy clears resources and reinjection creates one working instance', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await page.evaluate(() => {
    window.retainedCore = window.YTGamepad; window.retainedCoordinator = window.YTGamepadCoordinator;
    window.YTGamepadWatch.show(); window.YTGamepadMenu.handle('search');
    window.YTGamepadRuntime.destroy(); window.YTGamepadRuntime.destroy();
  });
  assert.deepEqual(await page.evaluate(() => ({
    resources: Object.keys(window.YTGamepadRuntime.resources),
    surfaces: [...document.querySelectorAll('#yt-gamepad-overlay,#yt-gamepad-menu,#ytg-watch,#ytg-browse-top,#ytg-fallback-notice')].length,
    historyRestored: history.pushState === window.originalHistory.pushState && history.replaceState === window.originalHistory.replaceState,
    suspended: window.YTGamepadFocus.suspended,
    oldAction: window.retainedCore.act('confirm'), oldRequest: window.retainedCoordinator.request('media', 'playPause')
  })), { resources: [], surfaces: 0, historyRestored: true, suspended: false, oldAction: 'blocked', oldRequest: false });
  await page.addScriptTag({ content: mainSource });
  await press(page, 'search');
  assert.equal((await snapshot(page)).menu, true);
  await press(page, 'back');
  assert.equal((await snapshot(page)).menu, false);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#yt-gamepad-menu').length), 1);
});

test('all MAIN modules: repeated search editing releases detached views and handles Unicode cursor movement', options, async t => {
  const page = await setup(t);
  const baseline = await page.evaluate(() => window.YTGamepadRuntime.resources.menu);
  for (let i = 0; i < 8; i++) {
    await press(page, 'search');
    await page.evaluate(() => {
      const input = document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('#query');
      input.value = 'a😀b'; input.setSelectionRange(3, 3); input.dispatchEvent(new Event('select'));
      window.YTGamepadMenu.handle('seekBack'); window.YTGamepadMenu.handle('playPause');
    });
    assert.equal(await page.evaluate(() => document.querySelector('#yt-gamepad-menu').shadowRoot.querySelector('#query').value), '😀b');
    await press(page, 'back');
  }
  assert.equal(await page.evaluate(() => window.YTGamepadRuntime.resources.menu), baseline);
  assert.equal(await page.evaluate(() => window.YTGamepadFocus.suspended), false);
});


test('native range adjustment consumes A and one B before closing and restoring page focus', options, async t => {
  const page = await setup(t);
  await nativeDialog(page);
  await page.evaluate(() => {
    const slider = document.createElement('input');
    slider.id = 'native-volume'; slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '5'; slider.value = '50';
    window.sliderEvents = [];
    for (const type of ['input', 'change']) slider.addEventListener(type, () => window.sliderEvents.push(type));
    document.querySelector('#native-dialog').prepend(slider);
    window.YTGamepad.focus(slider);
  });
  await press(page, 'confirm'); await press(page, 'right');
  assert.equal(await page.locator('#native-volume').inputValue(), '55');
  assert.deepEqual(await page.evaluate(() => window.sliderEvents), ['input', 'change']);
  await press(page, 'back');
  assert.equal(await page.locator('#native-dialog').count(), 1);
  assert.equal((await snapshot(page)).current, 'native-volume');
  await press(page, 'back');
  await page.waitForFunction(() => !window.YTGamepad.hasOverlay);
  assert.equal(await page.evaluate(() => window.YTGamepad.current?.getAttribute('href')), '/watch?v=b');
});


test('search highlight follows mouse and controller ownership without leaving a second key highlighted', options, async t => {
  const page = await setup(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.testPad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
    window.YTGamepadMenu.openSearch();
  });
  const paint = () => page.evaluate(() => {
    const root = document.querySelector('#yt-gamepad-menu').shadowRoot;
    const keys = [...root.querySelectorAll('#keys button')];
    const resting = keys.find(button => button.textContent === 'Z');
    const hovered = keys.find(button => button.textContent === 'R');
    const focused = root.activeElement;
    return { mode: window.YTGamepadInput.mode,
      focusedBackground: getComputedStyle(focused).backgroundColor,
      focusedOutline: getComputedStyle(focused).outlineStyle,
      restingBackground: getComputedStyle(resting).backgroundColor,
      hoveredBackground: getComputedStyle(hovered).backgroundColor,
      hovered: hovered.matches(':hover') };
  });
  let state = await paint();
  assert.equal(state.mode, 'mouse');
  assert.equal(state.focusedBackground, state.restingBackground, 'initial programmatic focus does not paint a mouse-mode key');
  await page.locator('#keys button').filter({ hasText: /^R$/ }).hover();
  state = await paint();
  assert.equal(state.hovered, true);
  assert.notEqual(state.hoveredBackground, state.restingBackground);
  await page.evaluate(() => { window.testPad.buttons[13].pressed = true; });
  await page.waitForFunction(() => window.YTGamepadInput.mode === 'gamepad');
  await page.evaluate(() => { window.testPad.buttons[13].pressed = false; });
  state = await paint();
  assert.equal(state.hovered, true, 'pointer stays over R during controller input');
  assert.equal(state.hoveredBackground, state.restingBackground, 'controller input suppresses the parked pointer highlight');
  assert.equal(state.focusedOutline, 'solid');
  assert.notEqual(state.focusedBackground, state.restingBackground);
  await page.mouse.move(1250, 880);
  state = await paint();
  assert.equal(state.mode, 'mouse');
  assert.equal(state.focusedOutline, 'none');
  assert.equal(state.focusedBackground, state.restingBackground, 'mouse takeover removes the controller key fill');
});

test('menu motion permits immediate reopen and repeated input, and respects reduced motion', options, async t => {
  const page = await setup(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => window.YTGamepadMenu.handle('help'));
  await page.waitForFunction(() => {
    const host = document.querySelector('#yt-gamepad-menu');
    return getComputedStyle(host).opacity === '1';
  });
  const reopened = await page.evaluate(() => {
    const menu = window.YTGamepadMenu;
    menu.close(); menu.handle('help');
    const host = document.querySelector('#yt-gamepad-menu');
    return { opened: menu.opened, closing: host.hasAttribute('data-closing'),
      focusInside: host.shadowRoot.activeElement?.tagName === 'BUTTON' };
  });
  assert.deepEqual(reopened, { opened: true, closing: false, focusInside: true });
  await page.evaluate(() => window.YTGamepadMenu.openSearch());
  const pressTwice = () => page.evaluate(() => {
    const root = document.querySelector('#yt-gamepad-menu').shadowRoot;
    const button = root.querySelector('#keys button');
    const before = root.querySelector('#query').value;
    button.click(); button.click();
    return { before, after: root.querySelector('#query').value,
      animations: button.getAnimations().filter(animation => animation.id === 'ytg-press').length };
  });
  let result = await pressTwice();
  assert.equal(result.after.length, result.before.length + 2, 'both inputs commit synchronously');
  assert.equal(result.animations, 1, 'repeated presses replace the previous feedback');
  await page.waitForFunction(() => !document.querySelector('#yt-gamepad-menu').shadowRoot
    .querySelector('#keys button').getAnimations().some(animation => animation.id === 'ytg-press'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  result = await pressTwice();
  assert.equal(result.after.length, result.before.length + 2);
  assert.equal(result.animations, 0);
});

test('current-page fill survives controller focus and enabled controls keep their checkmark', options, async t => {
  const page = await setup(t);
  await page.locator('[data-ytg-page-mode]').click();
  const nav = await page.evaluate(() => {
    document.documentElement.classList.add('ytg-browse', 'ytg-gamepad-input');
    const guide=document.createElement('ytd-mini-guide-renderer'),entry=document.createElement('ytd-mini-guide-entry-renderer'),link=document.createElement('a');
    link.href='/';link.textContent='首页';link.setAttribute('aria-current','page');link.style.backgroundColor='rgb(238,238,238)';
    entry.append(link);guide.append(entry);document.body.append(guide);
    const before = getComputedStyle(link).backgroundColor;
    window.YTGamepad.focus(link);
    return { before, after: getComputedStyle(link).backgroundColor,
      focused: window.YTGamepad.current === link, current: link.getAttribute('aria-current') };
  });
  assert.equal(nav.focused, true); assert.equal(nav.current, 'page'); assert.equal(nav.after, nav.before);
  const watchPage = await setup(t, '/watch?v=current');
  const control = await watchPage.evaluate(() => {
    document.documentElement.classList.add('ytg-gamepad-input');
    const captions = document.createElement('button');
    captions.className = 'ytp-subtitles-button'; captions.setAttribute('aria-pressed', 'true');
    document.querySelector('#movie_player').append(captions);
    window.YTGamepadWatch.show();
    for (let i = 0; i < 6; i++) window.YTGamepadWatch.handle('right');
    const node = document.querySelector('#ytg-watch').shadowRoot.querySelector('[data-action="captions"]');
    node.setAttribute('aria-pressed', 'true');
    const focused = node.classList.contains('selected'), mark = getComputedStyle(node, '::after').content;
    const background = getComputedStyle(node).backgroundColor;
    window.YTGamepadWatch.handle('left');
    return { focused, mark, background, unfocusedBackground: getComputedStyle(node).backgroundColor,
      unfocusedMark: getComputedStyle(node, '::after').content, pressed: node.getAttribute('aria-pressed') };
  });
  assert.equal(control.focused, true); assert.equal(control.pressed, 'true');
  assert.equal(control.mark, '"✓"'); assert.equal(control.unfocusedMark, control.mark);
  assert.equal(control.background, control.unfocusedBackground);
});

test('keyboard and mouse share controller navigation without a connected pad', { skip: !chromium }, async t => {
  const page = await setup(t, '/', false);
  await page.evaluate(() => {
    window.keyboardActions = [];
    window.addEventListener('yt-gamepad-action', e => window.keyboardActions.push(e.detail.action));
  });
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.YTGamepad.current.getAttribute('href')), '/watch?v=c');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'keyboard');
  await page.keyboard.press('F1');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('#yt-gamepad-menu').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.keyboardActions), ['right', 'help', 'back']);
  await page.keyboard.press('/');
  const query = page.locator('#yt-gamepad-menu #query');
  await query.fill('hello');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('!');
  assert.equal(await query.inputValue(), 'hell!o');
  assert.equal(await page.evaluate(() => window.keyboardActions.length), 4);
  await page.mouse.move(200, 200);
  await page.mouse.move(260, 260);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgInputMode), 'mouse');
});
