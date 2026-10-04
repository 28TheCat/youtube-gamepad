import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

async function setup(t, pathname = '/') {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught errors across module boundaries'));
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://www.youtube.com' + pathname);
  await page.evaluate(() => { window.originalHistory = { pushState: history.pushState, replaceState: history.replaceState }; });
  if (pathname.startsWith('/watch')) await page.evaluate(() => {
    const player = document.createElement('div'); player.id = 'movie_player';
    player.getPlayerResponse = () => ({ videoDetails: { videoId: 'current', title: 'Current video' } });
    player.append(document.createElement('video'));
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
  for (const path of entry.css) await page.addStyleTag({ path: fileURLToPath(new URL(path, root)) });
  for (const path of entry.js) await page.addScriptTag({ path: fileURLToPath(new URL(path, root)) });
  // Only the extension-side storage/connection bridge is absent. All MAIN modules
  // including gamepad, core, views, site adapter and coordinator are real.
  await page.evaluate(() => {
    window.focusLog = [];
    document.addEventListener('focusin', event => window.focusLog.push(event.target.id || event.target.getAttribute('href')));
    window.YTGamepad.focus(document.querySelector('a[href="/watch?v=b"]'));
  });
  return page;
}

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

test('TV header preserves native sidebar and feed geometry across widths and guide states', options, async t => {
  const page = await setup(t);
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
      await page.waitForFunction(() => !document.documentElement.classList.contains('ytg-browse'));
      const native = await measure();
      await page.evaluate(() => document.documentElement.classList.add('ytg-theater'));
      await page.waitForFunction(() => document.documentElement.classList.contains('ytg-browse'));
      assert.deepEqual(await measure(),native,'header activation leaves native widths, columns and metadata intact');
      const sidebar = expanded ? 'ytd-guide-renderer a' : 'ytd-mini-guide-renderer a';
      await page.evaluate(selector => window.YTGamepad.focus(document.querySelector(selector)),sidebar);
      assert.equal(await page.evaluate(selector => window.YTGamepad.current === document.querySelector(selector),sidebar),true,'native sidebar is a focus candidate');
      assert.deepEqual(await measure(),native,'focusing the sidebar does not resize the feed');
    }
  }
  assert.equal(await page.locator('#ytg-browse-sidebar').count(),0);
  const expanded = await page.locator('ytd-app').getAttribute('expanded');
  await page.locator('#ytg-browse-top [data-browse-action="guide"]').click();
  assert.notEqual(await page.locator('ytd-app').getAttribute('expanded'),expanded,'header forwards the native guide toggle');
  await page.evaluate(() => {
    const card=document.querySelector('a#thumbnail');window.YTGamepad.focus(card);window.YTGamepad.act('left');
  });
  assert.equal(await page.evaluate(() => window.YTGamepad.current.closest('ytd-mini-guide-renderer') !== null),true);
  await press(page,'right');
  assert.equal(await page.evaluate(() => window.YTGamepad.current === document.querySelector('a#thumbnail')),true,'right returns to the original card');
});

test('native video rows retain independent focus through short rows and DOM replacement', options, async t => {
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
    '/watch?v=row2col1', '/watch?v=row1col0', '/watch?v=row0col2',
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

test('all MAIN modules: deleted recommendation restores neighboring video in watch shadow UI', options, async t => {
  const page = await setup(t, '/watch?v=current');
  await press(page, 'down'); await press(page, 'right');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'r2');
  await press(page, 'help');
  await page.evaluate(() => { document.querySelector('ytd-compact-video-renderer[data-key=r2]').remove(); window.YTGamepadWatch.refresh(); });
  assert.equal((await snapshot(page)).active, 'yt-gamepad-menu');
  await press(page, 'back');
  assert.equal(await page.evaluate(() => document.querySelector('#ytg-watch').shadowRoot.activeElement.dataset.videoId), 'r3');
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
  for (const path of entry.js) await page.addScriptTag({ path: fileURLToPath(new URL(path, root)) });
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


test('current-page fill survives controller focus and enabled controls keep their checkmark', options, async t => {
  const page = await setup(t);
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
