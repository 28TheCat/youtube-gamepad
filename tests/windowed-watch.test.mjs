import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
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
export function setup() {
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
    recommendations: [0, 1, 2].map(i => ({ key: 'video' + i, title: 'Video ' + i, channel: 'Author', href: '/watch?v=video' + i, thumbnail: 'https://i.ytimg.com/vi/video' + i + '/hqdefault.jpg' })) };
  const port = { state: { enabled: true, surfaceReady: true, navigating: false, get mode() { return mode; } }, navigating: false,
    readRoute: () => ({ key: '/watch?v=one', isWatch: true }), readWatchPage: () => page,
    readPlayback: () => ({ video: { paused: false, ended: false, currentTime: 10, duration: 120, volume: .5, timeline: { start: 0, end: 120, position: 10, current: 10, duration: 120, canSeek: true, ranges: [{ start: 0, end: 120 }] } }, settingsOpen: false, captionsEnabled: false }),
    readWatchFeatures: () => ({}), readComments: () => [], observePlayback() {}, hasTemporaryLayer: () => false,
    request(type, value) {
      commands.push([type, value]);
      if (type === 'backSettings') return false;
      if (type === 'watchAction' && value === 'subscribe') page.subscribed = true;
      if (type === 'watchAction' && value === 'like') page.liked = !page.liked;
      if (type === 'playlists') return [];
      if (type === 'mode') { mode = value; watch.sync(); }
      if (type === 'fullscreen') { document.documentElement.dataset.ytgPlaybackLayout = 'fullscreen'; watch.sync(); }
      return true;
    }
  };
  watch.connect(port); watch.sync(); watch.show();
  return { watch, commands, press: action => watch.handle(action),
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
  await press('down'); assert.equal(await focused(), 'metadata');
  await press('confirm'); assert.equal(await page.evaluate(() => window.fixture.state.panel), 'description');
  await press('back'); assert.equal(await focused(), 'metadata');
  await press('down'); assert.equal(await page.evaluate(() => window.fixture.state.row), 'controls');
  assert.equal(await focused(), 'channel');
  await press('up'); assert.equal(await focused(), 'metadata');
  await press('up'); assert.equal(await focused(), 'player');
  assert.equal(await page.evaluate(() => window.fixture.commands.some(([type]) => type === 'media')), false);
  await press('confirm');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ytgPlaybackLayout), 'fullscreen');
  assert.equal(await focused(), 'playPause');
  await press('left'); assert.equal(await focused(), 'seekBack');
  await page.evaluate(() => window.fixture.half()); assert.equal(await focused(), 'player');
  await page.locator('#ytg-watch [data-action="comments"]').click();
  assert.equal(await page.evaluate(() => window.fixture.state.panel), 'comments');
  await press('left'); assert.equal(await focused(), 'player');
  assert.equal(await page.evaluate(() => window.fixture.state.panel), '');
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
  await press('down'); assert.equal(await focused(), 'metadata');
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
  await press('right'); assert.equal(await focused(), 'fullscreen');
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
  await press('right'); assert.equal(await focused(), 'mute');
  await press('confirm');
  assert.deepEqual(await commands(), [['channel', undefined], ['watchAction', 'subscribe'], ['watchAction', 'like'], ['media', 'mute']]);
  const geometry = await host.locator('[data-action="mute"]').evaluate(node => {
    const item = node.getBoundingClientRect(), toolbar = node.closest('.toolbar').getBoundingClientRect();
    return { itemLeft: item.left, itemRight: item.right, toolbarLeft: toolbar.left, toolbarRight: toolbar.right };
  });
  assert.ok(geometry.itemLeft >= geometry.toolbarLeft - 1 && geometry.itemRight <= geometry.toolbarRight + 1, 'directional focus reveals the chosen interaction in the scrolling toolbar');
  await press('up'); assert.equal(await focused(), 'metadata');
  await press('up'); assert.equal(await focused(), 'player');
  await page.evaluate(() => window.fixture.destroy());
});
