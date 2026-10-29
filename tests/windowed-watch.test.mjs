import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { browserPage } from './helpers/bundles.mjs';

const entry = `
import { YTGamepadRuntime as runtime } from '/src/shared/runtime.ts';
import { YTGamepadStateMachine as machine } from '/src/app/state-machine.ts';
import { YTGamepadWatchModule } from '/src/playback/watch.ts';
import { createWatchSurface } from '/src/ui/watch-surface.ts';
import { createVueWatchView } from '/src/ui/vue-watch-view.ts';
import { YTGamepadStyles as styles } from '/src/ui/styles.ts';
import { YTGamepadWatchPanels } from '/src/ui/watch-panels.ts';
import { createNativePlayerControls } from '/src/sites/native-player-controls.ts';
export function setup(rich = false, native = false, loading = false, filters = false) {
  let state = machine.createState('/watch?v=one'), mode = 'controls';
  const commands = [];
  const interaction = { get state() { return state; }, dispatch(event) {
    const result = machine.transition(state, event); state = result.nextState; return result;
  }};
  const controllerStyle = { register: () => () => {}, bind(node, text, attribute) { if (attribute) node.setAttribute(attribute, text); else node.textContent = text; }, badge() {}, hint(node, text) { node.textContent = text; } };
  const shared = { runtime, interaction, controllerStyle };
  const watch = YTGamepadWatchModule.create({ ...shared,
    createSurface: (callbacks, lifecycle) => createWatchSurface({ ...shared,
      createView: port => createVueWatchView({ ...port, styles }),
      createPanels: port => YTGamepadWatchPanels.create(port)
    }, callbacks, lifecycle) });
  const page = { isWatch: true, key: '/watch?v=one', title: 'Test video', channel: 'Author', description: '', subscribed: false, liked: false,
    recommendations: Array.from({ length: rich ? 30 : 3 }, (_, i) => ({ key: 'video' + i, title: 'Video ' + i, channel: 'Author', href: '/watch?v=video' + i, thumbnail: 'https://i.ytimg.com/vi/video' + i + '/hqdefault.jpg' })),
    queue: rich ? Array.from({ length: 20 }, (_, i) => ({ key: 'queue' + i, title: 'Queue ' + i, label: 'Queue ' + i, channel: 'Author', href: '/watch?v=queue' + i + '&list=PLtest&index=' + (i + 1), queue: true, selected: i === 2 })) : [] };
  if (filters) page.recommendationFilters = ['All', 'Related', 'Recently uploaded'].map((label, index) => ({ key: 'filter:' + index, label, selected: index === 0 }));
  page.recommendations.push(...page.queue.filter(item => !item.selected));
  if (loading) { page.title = ''; page.channel = ''; page.recommendations = []; page.recommendationsLoading = true; }
  const comments = rich ? Array.from({ length: 25 }, (_, i) => ({ key: 'comment' + i, author: 'Reader ' + i, text: 'Comment ' + i, hasReplies: false, repliesLabel: '', replies: [] })) : [];
  const port = { state: { enabled: true, shellVisible: true, surfaceReady: !loading, navigating: false, get mode() { return mode; } }, navigating: false,
    readRoute: () => ({ key: page.key, isWatch: page.isWatch }), readWatchPage: () => page,
    readPlayback: () => ({ video: { paused: false, ended: false, currentTime: 10, duration: 120, volume: .5, timeline: { start: 0, end: 120, position: 10, current: 10, duration: 120, canSeek: true, ranges: [{ start: 0, end: 120 }] } }, settingsOpen: false, captionsEnabled: false }),
    readWatchFeatures: () => ({}), readComments: () => comments, observePlayback() {}, hasTemporaryLayer: () => !!state.watch.panel && !state.watch.commentsParked,
    dispatchAction: action => watch.handleInput(action),
    request(type, value) {
      commands.push([type, value]);
      if (type === 'backSettings') return false;
      if (type === 'watchAction' && value === 'subscribe') page.subscribed = true;
      if (type === 'watchAction' && value === 'like') page.liked = !page.liked;
      if (type === 'recommendationFilter') page.recommendationFilters = page.recommendationFilters.map(item => ({ ...item, selected: item.key === value }));
      if (type === 'playlists') return [];
      if (type === 'mode') { mode = value; watch.sync(); }
      if (type === 'fullscreen') { document.documentElement.dataset.ytgPlaybackLayout = 'fullscreen'; watch.sync(); }
      return true;
    }
  };
  if (native) {
    const nativeScope = runtime.scope('native-test');
    port.nativePlayer = createNativePlayerControls(nativeScope);
    nativeScope.listen(window, 'ytg-native-player-fullscreen', () => port.request('fullscreen'));
  }
  watch.connect(port); watch.sync(); watch.show();
  return { watch, commands, page, waitForPlayer() { port.state.surfaceReady = false; port.state.transitioning = true; mode = 'browse'; watch.sync(); }, readyPlayer() { port.state.surfaceReady = true; port.state.transitioning = false; mode = 'controls'; watch.sync(); }, leave() { mode = 'browse'; page.isWatch = false; watch.sync(); }, resume() { mode = 'playback'; page.isWatch = true; watch.sync(); }, press: action => watch.handleInput(action),
    half() { document.documentElement.dataset.ytgPlaybackLayout = 'windowed'; watch.sync(); },
    get state() { return watch.state; }, destroy: () => runtime.destroy() };
}`;
const fixtureId = fileURLToPath(new URL('./helpers/windowed-watch-fixture.ts', import.meta.url)).replaceAll('\\', '/');
const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [{ name: 'windowed-watch-fixture', enforce: 'pre', resolveId: id => id.replaceAll('\\', '/') === fixtureId ? fixtureId : undefined,
    load: id => id === fixtureId ? entry : undefined }, vue()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: { entry: fixtureId, formats: ['iife'], name: 'WindowedWatchFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;

test('windowed focus crosses page regions and fullscreen restores internal controls', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup();' });
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  assert.equal(await focused(), 'player');
  const bounds = await page.locator('#ytg-watch .player-focus').boundingBox();
  assert.ok(bounds.width > 500 && bounds.height > 200);
  await press('right'); assert.equal(await focused(), 'recommendation:video0:0');
  await press('down'); assert.equal(await focused(), 'recommendation:video1:0');
  await press('left'); assert.equal(await focused(), 'player');
  await press('down'); await press('down'); await press('down'); assert.equal(await focused(), 'metadata');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'description');
  await press('back'); assert.equal(await focused(), 'metadata');
  await press('down'); assert.equal(await page.evaluate(() => window.fixture.state.row), 'controls');
  assert.equal(await focused(), 'channel');
  await press('up'); assert.equal(await focused(), 'metadata');
  await press('up'); await press('up'); await press('up'); assert.equal(await focused(), 'player');
  assert.equal(await page.evaluate(() => window.fixture.commands.some(([type]) => type === 'media')), false);
  await press('confirm');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgPlaybackLayout), 'fullscreen');
  assert.equal(await focused(), 'playPause');
  await press('left'); assert.equal(await focused(), 'seekBack');
  await page.evaluate(() => window.fixture.half()); assert.equal(await focused(), 'player');
  await page.locator('#ytg-watch [data-action="comments"]').click();
  assert.equal(await page.evaluate(() => window.fixture.state.panel), 'comments');
  await press('left'); assert.equal(await focused(), 'comments');
  assert.equal(await page.evaluate(() => window.fixture.state.panel), '');
  assert.equal(await page.locator('#ytg-watch .dialog.comments').isVisible(), true);
  await page.evaluate(() => window.fixture.destroy());
});

test('fullscreen collection supports controller entry, bounded focus, return and episode selection', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="fullscreen"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(true);' });
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  for (let i = 0; i < 24 && await focused() !== 'collection'; i++) await press('right');
  assert.equal(await focused(), 'collection', 'the collection entry participates in controller navigation');
  await press('confirm');
  assert.match(await focused(), /queue3/);
  await press('left'); assert.match(await focused(), /queue3/);
  for (let i = 0; i < 25; i++) await press('up');
  assert.equal(await page.evaluate(() => window.fixture.state.row), 'recommendations');
  assert.match(await focused(), /queue0/);
  await press('back');
  assert.equal(await focused(), 'collection');
  assert.equal(await page.locator('#ytg-watch .collection-panel').count(), 0);
  await press('confirm'); await press('confirm');
  assert.equal(await page.locator('#ytg-watch .collection-panel').count(), 0);
  assert.ok(await page.evaluate(() => window.fixture.commands.some(([type, key]) => type === 'recommendation' && key === 'queue3')));
  await page.evaluate(() => window.fixture.destroy());
});

test('windowed uses original YouTube controls and preserves their CSS and event handlers', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html class="ytg-watch-layout ytg-watch-active ytg-gamepad-input" data-ytg-playback-layout="windowed"><body><div id="movie_player"><div class="ytp-chrome-bottom"><div class="ytp-progress-bar" tabindex="0" role="slider" style="height:20px;background:gold"></div><div class="ytp-chrome-controls" style="display:flex;height:44px;gap:8px"><button class="ytp-play-button" style="border-radius:50%;background:gold">Play</button><button class="ytp-mute-button">Volume</button><button class="ytp-subtitles-button">Captions</button><button class="ytp-settings-button">Settings</button><button class="ytp-fullscreen-button">Fullscreen</button></div></div></div></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.nativeClicks = [];
    window.originalPlayButton = document.querySelector('.ytp-play-button');
    for (const node of document.querySelectorAll('.ytp-chrome-controls button')) node.addEventListener('click', () => window.nativeClicks.push(node.className));
  });
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(false, true);' });
  const host = page.locator('#ytg-watch');
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const focused = () => page.evaluate(() => document.activeElement.classList.contains('ytp-progress-bar') ? 'progress' : document.activeElement.className);
  assert.equal(await host.locator('.transport-group').isVisible(), false);
  assert.equal(await host.locator('.progress').isVisible(), false);
  assert.equal(await host.locator('.player-option').first().isVisible(), false);
  assert.equal(await host.locator('.transport-group,.times,.progress,.player-option,.windowed-fullscreen').count(), 0, 'duplicate controls are removed from the DOM');
  assert.equal(await host.locator('[data-action="playPause"]').count(), 0);
  assert.equal(await page.evaluate(() => window.originalPlayButton === document.querySelector('.ytp-play-button')), true);
  assert.equal(await page.locator('.ytp-play-button').evaluate(node => getComputedStyle(node).borderRadius), '50%');
  assert.equal(await page.locator('.ytp-play-button').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 215, 0)');
  await press('down'); assert.equal(await focused(), 'progress');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.adjusting), true);
  await press('right');
  assert.equal(await page.evaluate(() => window.fixture.commands.some(([type, action]) => type === 'media' && action === 'seekForward')), true);
  await press('back'); await press('down'); assert.match(await focused(), /ytp-play-button/);
  await press('confirm'); assert.match((await page.evaluate(() => window.nativeClicks)).at(-1), /ytp-play-button/);
  for (const name of ['mute', 'subtitles', 'settings']) { await press('right'); assert.match(await focused(), new RegExp('ytp-' + name + '-button')); }
  await press('confirm'); assert.match((await page.evaluate(() => window.nativeClicks)).at(-1), /ytp-settings-button/);
  await press('up'); assert.equal(await focused(), 'progress');
  await press('down'); assert.match(await focused(), /ytp-settings-button/);
  await press('down'); assert.equal(await page.evaluate(() => window.fixture.state.row), 'metadata');
  await press('up'); assert.match(await focused(), /ytp-play-button/);
  for (let i = 0; i < 4; i++) await press('right');
  assert.match(await focused(), /ytp-fullscreen-button/);
  await press('confirm');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgPlaybackLayout), 'fullscreen');
  assert.equal(await host.locator('.transport-group').isVisible(), true);
  assert.equal(await host.locator('.times,.progress').count(), 2, 'fullscreen retains its own controls');
  await page.evaluate(() => window.fixture.half());
  assert.equal(await host.locator('.transport-group').isVisible(), false);
  assert.equal(await host.locator('.transport-group,.times,.progress,.player-option,.windowed-fullscreen').count(), 0, 'returning to windowed does not recreate duplicates');
  // Mouse focus joins the same explicit gamepad graph.
  await page.locator('.ytp-mute-button').click();
  await press('right'); assert.match(await focused(), /ytp-subtitles-button/);
  await page.evaluate(() => document.querySelector('.ytp-subtitles-button').remove());
  await page.evaluate(() => window.fixture.watch.sync());
  await page.locator('.ytp-mute-button').click();
  await press('right'); assert.match(await focused(), /ytp-settings-button/);
  for (const [width, height] of [[1280, 900], [640, 480]]) {
    await page.setViewportSize({ width, height });
    const player = await page.locator('#movie_player').boundingBox(), bar = await page.locator('.ytp-chrome-bottom').boundingBox();
    assert.ok(bar.x >= player.x && bar.y >= player.y && bar.x + bar.width <= player.x + player.width + .1 && bar.y + bar.height <= player.y + player.height + .1);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/windowed-original-controls.png', import.meta.url)) });
  await page.evaluate(() => window.fixture.destroy());
  assert.equal(await page.locator('.ytg-native-control-selected').count(), 0);
});

test('stable detail regions align native media and focus across viewport and aspect changes', async t => {
  const page = await browserPage(t);
  await page.setContent('<html class="ytg-watch-layout ytg-gamepad-input" data-ytg-playback-layout="windowed"><body><div id="movie_player"><video class="html5-main-video"></video></div></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/app/theater.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup();' });
  for (const [width, height] of [[1920, 1080], [1280, 900], [960, 720], [640, 480]]) {
    await page.setViewportSize({ width, height });
    const side = width <= 700 ? Math.min(240, width * .4) : width <= 1050 ? 340 : 460;
    for (const ratio of [16 / 9, 21 / 9, 4 / 3, 9 / 16]) {
      const geometry = await page.evaluate(ratio => {
        document.documentElement.style.setProperty('--ytg-video-ratio', String(ratio));
        const root = document.querySelector('#ytg-watch').shadowRoot;
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
        return { player: rect(document.querySelector('#movie_player')), focus: rect(root.querySelector('.player-focus')),
          tabs: rect(root.querySelector('.watch-tabs')), heading: rect(root.querySelector('.heading')),
          toolbar: rect(root.querySelector('.toolbar')), fit: getComputedStyle(document.querySelector('video')).objectFit };
      }, ratio);
      assert.deepEqual(geometry.focus, geometry.player, 'focus frame matches the native media container');
      assert.ok(Math.abs(geometry.player.width - (width - side)) < .1);
      assert.ok(Math.abs(geometry.player.height - (height - 56 - 177)) < .1);
      assert.ok(Math.abs(geometry.tabs.width - side) < .1);
      assert.equal(geometry.tabs.x, geometry.player.width);
      assert.equal(geometry.heading.y, geometry.player.bottom);
      assert.equal(geometry.heading.height, 48);
      assert.equal(geometry.toolbar.height, 80);
      assert.ok(geometry.toolbar.bottom <= height);
      assert.equal(geometry.fit, 'contain', 'video fits the stage without cropping or distortion');
    }
    const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
    const press = action => page.evaluate(action => window.fixture.press(action), action);
    await press('down'); await press('down'); await press('down'); assert.equal(await focused(), 'metadata');
    await press('right'); assert.match(await focused(), /^recommendation:/);
    await press('left'); assert.equal(await focused(), 'metadata');
    await press('up'); await press('up'); await press('up'); assert.equal(await focused(), 'player');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/stable-detail-regions.png', import.meta.url)) });
  await page.evaluate(() => window.fixture.destroy());
});

for (const width of [767, 1280]) test(`windowed title, author and interactions select directly and execute only on confirm at ${width}px`, async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width, height: 900 });
  await page.setContent('<html class="ytg-gamepad-input" data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup();' });
  const host = page.locator('#ytg-watch');
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const commands = () => page.evaluate(() => window.fixture.commands.filter(([type]) => ['watchAction', 'channel', 'media'].includes(type)));
  await press('down'); await press('down'); await press('down'); assert.equal(await focused(), 'metadata');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'description');
  await press('back'); assert.equal(await focused(), 'metadata');
  await press('down'); assert.equal(await focused(), 'channel');
  assert.deepEqual(await commands(), []);
  await press('confirm'); assert.deepEqual(await commands(), [['channel', undefined]]);
  await press('right'); assert.equal(await focused(), 'subscribe');
  await press('confirm');
  assert.equal(await host.locator('[data-action="subscribe"]').getAttribute('aria-label'), 'Subscribed, manage subscription');
  assert.equal(await focused(), 'subscribe');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'subscription');
  await press('back'); assert.equal(await focused(), 'subscribe');
  await press('right'); assert.equal(await focused(), 'description');
  await press('right'); assert.equal(await focused(), 'like');
  assert.deepEqual(await commands(), [['channel', undefined], ['watchAction', 'subscribe']]);
  await press('confirm');
  assert.equal(await host.locator('[data-action="like"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await focused(), 'like');
  await press('right'); assert.equal(await focused(), 'dislike');
  await press('right'); assert.equal(await focused(), 'comments');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'comments');
  await press('back'); assert.equal(await focused(), 'comments');
  await press('right'); assert.equal(await focused(), 'save');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'playlists');
  await press('back'); assert.equal(await focused(), 'save');
  await press('up'); await press('up'); // Metadata, then the internal play button.
  await press('right'); assert.equal(await focused(), 'seekForward');
  await press('right'); assert.equal(await focused(), 'mute');
  await press('confirm');
  assert.deepEqual(await commands(), [['channel', undefined], ['watchAction', 'subscribe'], ['watchAction', 'like'], ['media', 'mute']]);
  const geometry = await host.locator('[data-action="mute"]').evaluate(node => {
    const item = node.getBoundingClientRect(), toolbar = node.closest('.toolbar').getBoundingClientRect();
    return { itemLeft: item.left, itemRight: item.right, toolbarLeft: toolbar.left, toolbarRight: toolbar.right };
  });
  assert.ok(geometry.itemLeft >= geometry.toolbarLeft - 1 && geometry.itemRight <= geometry.toolbarRight + 1, 'directional focus reveals the chosen interaction in the scrolling toolbar');
  await press('down'); assert.equal(await focused(), 'metadata');
  await press('back'); assert.equal(await focused(), 'player');
  await page.evaluate(() => window.fixture.destroy());
});

test('media shortcuts keep their meaning and focus across detail regions and panels', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup();' });
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const position = () => page.evaluate(() => ({ ...window.fixture.state,
    focused: document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId || '' }));
  const verify = async () => {
    const before = await position();
    const count = await page.evaluate(() => window.fixture.commands.length);
    for (const action of ['playPause', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute', 'captions']) {
      assert.equal(await press(action), 'handled');
      assert.deepEqual(await position(), before, action + ' preserves the selected region and panel');
    }
    const media = await page.evaluate(count => window.fixture.commands.slice(count).filter(([type]) => type === 'media'), count);
    assert.deepEqual(media.map(([, action]) => action), ['playPause', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute', 'captions']);
  };
  await verify();
  await press('down'); await press('down'); await press('down'); await verify();
  await press('confirm'); await verify(); // Description remains open.
  await press('back'); await press('down'); await verify(); // Author.
  for (let i = 0; i < 3; i++) await press('right');
  await verify(); // Like.
  await press('right'); await press('right'); await press('confirm'); await verify(); // Comments.
  await press('back'); await press('right'); await press('confirm'); await verify(); // Save dialog.
  await press('back'); await press('up'); await press('right'); await verify(); // Recommendations.
  await page.evaluate(() => window.fixture.destroy());
});

test('physical playback keys work inside the watch shadow tree without activating the selected item or stealing text input', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup();' });
  await page.evaluate(() => { window.fixture.press('down'); window.fixture.press('down'); window.fixture.press('down'); });
  for (const key of ['Space', 'k', 'j', 'l', '-', '=', 'm', 'c']) await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => window.fixture.commands.filter(([type]) => type === 'media').map(([, action]) => action)),
    ['playPause', 'playPause', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp', 'mute', 'captions']);
  assert.equal(await page.evaluate(() => window.fixture.state.row), 'metadata');
  assert.equal(await page.evaluate(() => window.fixture.state.panel), '');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.fixture.state.panel), 'description');
  const count = await page.evaluate(() => window.fixture.commands.length);
  await page.evaluate(() => {
    const field = document.createElement('textarea'); field.dataset.testEditor = '';
    document.querySelector('#ytg-watch').shadowRoot.querySelector('.sheet').append(field); field.focus();
  });
  await page.keyboard.type('kjlmc '); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ytg-watch [data-test-editor]').inputValue(), 'kjlmc \n');
  assert.equal(await page.evaluate(() => window.fixture.commands.length), count);
  await page.evaluate(() => window.fixture.destroy());
});

test('side tabs remember independent selection and scroll, and Left restores the previous left region', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html class="ytg-gamepad-input" data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(true);' });
  const host = page.locator('#ytg-watch');
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const scroll = selector => host.locator(selector).evaluate(node => node.scrollTop);
  await press('down'); await press('down'); await press('down'); assert.equal(await focused(), 'metadata');
  await press('right');
  for (let i = 0; i < 14; i++) await press('down');
  const queueFocus = await focused(), queueTop = await scroll('.recommendations');
  assert.match(queueFocus, /^recommendation:queue/); assert.ok(queueTop > 0);
  await press('left'); assert.equal(await focused(), 'metadata');
  await press('right'); assert.equal(await focused(), queueFocus);
  assert.equal(await scroll('.recommendations'), queueTop);
  await host.locator('.watch-tab:not(.collection-tab)').first().click();
  for (let i = 0; i < 12; i++) await press('down');
  const recommendationFocus = await focused(), recommendationTop = await scroll('.recommendations');
  assert.match(recommendationFocus, /^recommendation:video/); assert.ok(recommendationTop > 0);
  await press('left'); assert.equal(await focused(), 'metadata');
  await host.locator('.watch-tab').last().click();
  for (let i = 0; i < 16; i++) await press('down');
  const commentFocus = await focused(), commentTop = await scroll('.sheet');
  assert.match(commentFocus, /^comment:/); assert.ok(commentTop > 0);
  await press('left'); assert.equal(await focused(), 'metadata');
  assert.equal(await host.locator('.dialog.comments').isVisible(), true);
  assert.equal(await scroll('.sheet'), commentTop);
  await press('right'); assert.equal(await focused(), commentFocus);
  assert.equal(await scroll('.sheet'), commentTop);
  await host.locator('.collection-tab').click();
  assert.equal(await focused(), queueFocus); assert.equal(await scroll('.recommendations'), queueTop);
  await host.locator('.watch-tab:not(.collection-tab)').first().click();
  assert.equal(await focused(), recommendationFocus); assert.equal(await scroll('.recommendations'), recommendationTop);
  await host.locator('.watch-tab').last().click();
  assert.equal(await focused(), commentFocus); assert.equal(await scroll('.sheet'), commentTop);
  await press('left'); await press('down'); // Move on the left while comments stay visible.
  assert.equal(await focused(), 'channel');
  await press('right'); assert.equal(await focused(), 'subscribe');
  await press('left'); assert.equal(await focused(), 'channel');
  assert.equal(await host.locator('.dialog.comments').isVisible(), true);
  await press('up'); await press('up'); await press('up'); await press('up');
  assert.equal(await focused(), 'player');
  await press('confirm');
  assert.equal(await host.locator('.dialog.comments').isVisible(), false);
  await page.evaluate(() => window.fixture.half());
  assert.equal(await focused(), 'player');
  assert.equal(await host.locator('.dialog.comments').isVisible(), true);
  await press('right'); assert.equal(await focused(), commentFocus);
  assert.equal(await scroll('.sheet'), commentTop);
  await page.evaluate(() => window.fixture.destroy());
});

test('direction keys reach every side tab while shoulders remain media shortcuts', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(true);' });
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  await press('right'); assert.match(await focused(), /^recommendation:queue/);
  await press('up'); assert.equal(await focused(), 'tab:0');
  await press('right'); assert.equal(await focused(), 'tab:1');
  await press('seekForward'); assert.equal(await focused(), 'tab:1');
  await press('confirm'); assert.match(await focused(), /^recommendation:video/);
  await press('up'); assert.equal(await focused(), 'tab:1');
  await press('right'); assert.equal(await focused(), 'tab:2');
  await press('down'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'comments');
  await press('up'); assert.equal(await focused(), 'tab:2');
  await press('right'); assert.equal(await focused(), 'tab:0');
  await press('confirm'); assert.match(await focused(), /^recommendation:queue/);
  await press('left'); assert.equal(await focused(), 'player');
  assert.deepEqual(await page.evaluate(() => window.fixture.commands.filter(([type]) => type === 'media')), [['media', 'seekForward']]);
  await page.evaluate(() => window.fixture.destroy());
});


test('return from the author channel restores the author control in its history entry', async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html data-ytg-playback-layout="windowed"><body></body></html>' }));
  await page.goto('https://www.youtube.com/watch?v=one');
  await page.addScriptTag({ content: code });
  await page.evaluate(() => { window.fixture = WindowedWatchFixture.setup(true); });
  await page.evaluate(() => {
    const channel = document.querySelector('#ytg-watch').shadowRoot.querySelector('[data-action="channel"]');
    channel.click();
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/channel/UCauthor');
    window.fixture.leave();
  });
  await page.goBack();
  await page.evaluate(() => window.fixture.resume());
  await page.waitForFunction(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.action === 'channel');
  assert.equal(await page.evaluate(() => history.state.ytGamepadWatchReturn.target.itemKey), 'channel');
});


test('return restores recommendation identity and scroll after the list order changes', async t => {
  const page = await browserPage(t);
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html data-ytg-playback-layout="windowed"><body></body></html>' }));
  await page.goto('https://www.youtube.com/watch?v=one');
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    window.fixture = WindowedWatchFixture.setup(true);
    window.fixture.watch.show('recommendations');
    for (let i = 0; i < 6; i++) window.fixture.press('down');
    const root = document.querySelector('#ytg-watch').shadowRoot;
    root.querySelector('.recommendations').scrollTop = 420;
    root.querySelector('.recommendations').dispatchEvent(new Event('scroll'));
  });
  const saved = await page.evaluate(() => history.state.ytGamepadWatchReturn);
  assert.equal(saved.target.region, 'recommendations');
  assert.ok(saved.scrollTop > 0);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/channel/UCauthor');
    window.fixture.leave();
    window.fixture.page.recommendations.reverse();
  });
  await page.goBack();
  await page.evaluate(() => window.fixture.resume());
  await page.waitForFunction(key => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.videoId === key, saved.target.itemKey);
  await page.waitForFunction(top => document.querySelector('#ytg-watch').shadowRoot.querySelector('.recommendations').scrollTop === top, saved.scrollTop);
  await page.evaluate(() => window.fixture.press('down'));
  assert.equal(await page.evaluate(() => window.fixture.state.row), 'recommendations');
});


test('player rebuilding updates the mounted detail surface before its replacement is ready', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code });
  await page.evaluate(() => { window.fixture = WindowedWatchFixture.setup(true); window.__watchHost = document.querySelector('#ytg-watch'); });
  const host = page.locator('#ytg-watch');
  await page.evaluate(() => { window.fixture.waitForPlayer(); window.fixture.page.title = 'Replacement video'; window.fixture.watch.sync(); });
  assert.equal(await host.isVisible(), true);
  assert.equal(await host.locator('.surface').evaluate(node => node.inert), true);
  assert.equal(await host.getByText('Test video', { exact: true }).count(), 0);
  assert.equal(await host.getByText('Replacement video', { exact: true }).count(), 1);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.evaluate(() => window.fixture.readyPlayer());
  assert.equal(await host.locator('.surface').evaluate(node => node.inert), false);
  assert.equal(await host.getByText('Replacement video', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch') === window.__watchHost), true);
});

test('cold watch shell renders and independently accepts recommendations and metadata before video readiness', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code });
  await page.evaluate(() => { window.fixture = WindowedWatchFixture.setup(false, false, true); window.__watchHost = document.querySelector('#ytg-watch'); });
  const host = page.locator('#ytg-watch');
  assert.equal(await host.isVisible(), true);
  assert.equal(await host.locator('.surface').evaluate(node => node.inert), true);
  assert.equal(await host.locator('.title').textContent(), 'Loading video…');
  assert.equal(await host.locator('[data-load-state="loading"]').count(), 1);
  await page.evaluate(() => {
    window.fixture.page.recommendations = [{ key: 'early', label: 'Early recommendation', channel: 'Creator' }];
    window.fixture.page.recommendationsLoading = false;
    window.fixture.watch.refreshPage();
  });
  assert.equal(await host.getByText('Early recommendation', { exact: true }).count(), 1);
  assert.equal(await host.locator('.title').textContent(), 'Loading video…');
  await page.evaluate(() => { window.fixture.page.title = 'Arrived metadata'; window.fixture.watch.refreshPage(); });
  assert.equal(await host.locator('.title').textContent(), 'Arrived metadata');
  assert.equal(await host.locator('.surface').evaluate(node => node.inert), true);
  await page.evaluate(() => window.fixture.readyPlayer());
  assert.equal(await host.locator('.surface').evaluate(node => node.inert), false);
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch') === window.__watchHost), true);
});

test('controller switches from a collection to recommendations through the side tabs', async t => {
  const page = await browserPage(t);
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(true);' });
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  await press('right'); await press('up');
  assert.equal(await focused(), 'tab:0');
  await press('right'); assert.equal(await focused(), 'tab:1');
  await press('confirm');
  assert.equal(await page.locator('#ytg-watch .collection-panel').count(), 0);
  assert.match(await focused(), /^recommendation:video/);
  await page.evaluate(() => {
    document.documentElement.dataset.ytgPlaybackLayout = 'windowed';
    window.fixture.watch.sync();
  });
  assert.equal(await page.locator('#ytg-watch .collection-panel').count(), 0, 'repeated layout observations must not reopen the collection');
  assert.equal(await page.locator('#ytg-watch .watch-tab:not(.collection-tab)').first().getAttribute('aria-selected'), 'true');
  await page.locator('#ytg-watch .collection-tab').click();
  await page.locator('#ytg-watch .watch-tab:not(.collection-tab)').first().click();
  await page.evaluate(() => { document.documentElement.dataset.ytgPlaybackLayout = 'windowed'; });
  assert.equal(await page.locator('#ytg-watch .collection-panel').count(), 0, 'mouse selection also survives layout synchronization');
});

test('native recommendation filters preserve the collection and support controller selection, mouse and media shortcuts', async t => {
  const page = await browserPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent('<html data-ytg-playback-layout="windowed"><body></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: code + ';window.fixture = WindowedWatchFixture.setup(true, false, false, true);' });
  const host = page.locator('#ytg-watch');
  const press = action => page.evaluate(action => window.fixture.press(action), action);
  const focused = () => page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement?.dataset.focusId);
  assert.equal(await host.locator('.recommendation-filters').count(), 0);
  await host.locator('.watch-tab:not(.collection-tab)').first().click();
  assert.equal(await host.locator('.recommendation-filters button').count(), 3);
  await press('up'); assert.equal(await focused(), 'filter:0');
  await press('right'); assert.equal(await focused(), 'filter:1');
  await press('confirm');
  assert.equal(await host.locator('[data-filter-key="filter:1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.fixture.commands.some(([type, key]) => type === 'recommendationFilter' && key === 'filter:1')), true);
  await press('seekForward');
  assert.deepEqual(await page.evaluate(() => window.fixture.commands.at(-1)), ['media', 'seekForward']);
  assert.equal(await focused(), 'filter:1');
  await press('up'); assert.equal(await focused(), 'tab:1');
  await press('down'); await press('up'); assert.equal(await focused(), 'filter:1');
  await press('down'); assert.match(await focused(), /^recommendation:video/);
  assert.equal(await page.evaluate(() => window.fixture.commands.filter(([type]) => type === 'moreRecommendations').every(([, kind]) => kind === 'recommendations')), true);
  await host.locator('[data-filter-key="filter:2"]').click();
  assert.equal(await host.locator('[data-filter-key="filter:2"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await host.locator('.recommendation-filters .selected').evaluateAll(nodes => nodes.map(node => node.dataset.filterKey)), ['filter:2']);
  mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/recommendation-filters.png' });
  await host.locator('.collection-tab').click();
  assert.equal(await host.locator('.collection-entry').count(), 20);
  assert.equal(await host.locator('.currently-playing').count(), 1);
  assert.equal(await host.locator('.recommendation-filters').count(), 0);
  await host.locator('.watch-tab:not(.collection-tab)').first().click();
  assert.equal(await host.locator('[data-filter-key="filter:2"]').getAttribute('aria-pressed'), 'true');
});
