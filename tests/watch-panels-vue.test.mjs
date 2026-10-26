import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { browserPage } from './helpers/bundles.mjs';

const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
  plugins: [vue({ template: { compilerOptions: { hoistStatic: false } } })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../src/ui/watch-panels.ts', import.meta.url)),
    formats: ['iife'], name: 'WatchPanelsFixture' } }
});
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;

for (const layout of ['windowed', 'fullscreen']) test(`thread details isolate one parent, show five nearby replies and restore the list (${layout})`, async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent('<!doctype html><html><body style="margin:0"><video id="playing-video"></video></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(({ layout, styles }) => {
    document.documentElement.dataset.ytgPlaybackLayout = layout;
    document.documentElement.dataset.ytgInputMode = 'mouse';
    const host = document.createElement('div'); host.id = 'panels'; document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
    const style = make('style'); style.textContent = styles;
    const dialog = make('div', 'dialog'), sheet = make('section', 'sheet'), surface = make('div', 'surface');
    dialog.hidden = true; dialog.append(sheet); root.append(style, surface, dialog);
    window.sheet = sheet; window.video = document.querySelector('video'); window.requests = []; window.routeKey = 'first';
    window.commentStatus = { loading: false, failed: false, hasMore: true };
    window.records = Array.from({ length: 20 }, (_, index) => ({ key: `parent-${index}`, author: `Author ${index}`,
      text: `Parent comment ${index} with some text for reading.`, translationTarget: 'ja', hasReplies: true, replyCount: 20, repliesLabel: 'Load replies',
      replies: Array.from({ length: 12 }, (_, reply) => ({ key: `reply-${index}-${reply}`, author: `Reply author ${reply}`, text: `Reply ${reply} to parent ${index}`, translationTarget: 'ja' })) }));
    delete window.records[0].translationTarget; window.records[0].text = '这是一条中文评论';
    delete window.records[1].translationTarget; window.records[1].text = 'This is an English comment.';
    window.records[2].text = '原生提供翻译入口的中文评论'; window.records[2].translationTarget = 'en';
    const state = { panel: '', panelIndex: 0 }, close = make('button', 'control');
    window.panels = WatchPanelsFixture.YTGamepadWatchPanels.create({ make, dialog, sheet, surface,
      description: make('div', 'description'), panelTitle: make('h2'), close,
      watchState: () => state, send(event) {
        if (event.type === 'WATCH_PANEL') { state.panel = event.panel; state.panelIndex = 0; }
        if (event.type === 'WATCH_FOCUS') state.panelIndex = event.index;
        if (event.type === 'WATCH_PANEL_COUNT') state.panelIndex = Math.min(state.panelIndex, event.count);
      },
      focus() { [close, ...window.panels.buttons][state.panelIndex]?.focus({ preventScroll: true }); },
      controllerStyle: { bind(node, text, attribute) { if (attribute) node.setAttribute(attribute, text); else node.textContent = text; }, hint() {},
        badge(node, key) { node.dataset.ytgKey = key; node.textContent = key; return node; } },
      controller: { readRoute: () => ({ key: window.routeKey }), readComments: () => structuredClone(window.records), readCommentsStatus: () => window.commentStatus,
        request(type, key) {
          window.requests.push([type, key]);
          if (type === 'translateComment') {
            const item = window.records.find(item => item.key === key) || window.records.flatMap(item => item.replies).find(item => item.key === key);
            item.translation = { language: item.translationTarget, text: `Translated ${key} to ${item.translationTarget}`, loading: false, failed: false };
          }
          if (type === 'replies') {
            if (window.deferReplies) { window.commentStatus = { loading: true, failed: false, hasMore: true }; return true; }
            const parent = window.records.find(item => item.key === key);
            parent.replies.push(...Array.from({ length: 8 }, (_, index) => ({ key: `extra-${index}`, author: 'Extra', text: `More reply ${index}` })));
            parent.hasReplies = false;
          }
          return true;
        } }, descriptionText: ''
    });
    close.addEventListener('click', () => { if (!window.panels.back()) window.panels.close(); });
    window.panels.open('comments');
  }, { layout, styles: readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8') });
  const host = page.locator('#panels'), detail = host.locator('[data-comment-detail]');
  assert.equal(await host.locator('button.comment-header, .comment-header[tabindex], .comment-author[data-focus-id]').count(), 0,
    'commenter names do not create navigation stops');
  assert.equal(await page.evaluate(() => window.panels.buttons.filter(node => node.dataset.focusId?.startsWith('comment:'))
    .every(node => node.classList.contains('comment-text'))), true, 'comment navigation targets the body text');
  assert.equal(await host.locator('[data-focus-id="translate:parent-0"]').count(), 0, 'Chinese without a native entry has no button');
  assert.equal(await host.locator('[data-focus-id="translate:parent-1"]').count(), 0, 'English without a native entry also has no button');
  assert.match(await host.locator('[data-focus-id="translate:parent-2"]').textContent(), /English/, 'a native target is authoritative regardless of source script');
  assert.equal(await host.locator('.comment-reply').count(), 0, 'even cached replies are not expanded in the parent list');
  const original = host.locator('[data-focus-id="replies:parent-10"]');
  assert.equal(await original.locator('.comment-expand-hint [data-ytg-key]').getAttribute('data-ytg-key'), 'A');
  assert.equal(await original.locator('.comment-expand-hint').isVisible(), false, 'mouse mode hides the controller prompt');
  await page.evaluate(() => { document.documentElement.dataset.ytgInputMode = 'gamepad'; });
  assert.equal(await original.locator('.comment-expand-hint').isVisible(), true, 'gamepad mode identifies the expand action');
  await page.evaluate(() => { document.documentElement.dataset.ytgInputMode = 'mouse'; });
  assert.equal(await original.locator('.comment-replies-label').textContent(), 'View 20 replies');
  await original.scrollIntoViewIfNeeded(); await original.focus();
  const scrollBefore = await page.evaluate(() => window.sheet.scrollTop);
  await original.click();
  assert.equal(await detail.locator('.detail-parent .comment-text').textContent(), 'Parent comment 10 with some text for reading.');
  assert.equal(await host.locator('.comment-reply').count(), 5);
  const branches = detail.locator('.detail-replies > .detail-branch');
  assert.equal(await branches.first().locator('.reply-connection').evaluate(node => getComputedStyle(node).borderBottomLeftRadius), '16px');
  assert.equal(await branches.first().locator('.reply-connection').evaluate(node => getComputedStyle(node).borderLeftWidth), '1px');
  assert.equal(await branches.first().locator('.reply-continuation').isVisible(), true);
  assert.equal(await branches.last().locator('.reply-continuation').isVisible(), false, 'the last reply terminates at its curved connection');
  assert.equal(await page.evaluate(() => window.sheet.scrollTop), 0);
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.documentElement.toggleAttribute('dark', dark), dark);
    const typography = await detail.evaluate(node => {
      const parent = node.querySelector('.detail-parent .comment-text');
      const reply = node.querySelector('.detail-replies .comment-text');
      const parentStyle = getComputedStyle(parent), replyStyle = getComputedStyle(reply);
      return { parentColor: parentStyle.color, replyColor: replyStyle.color,
        panelColor: getComputedStyle(node.closest('.sheet')).color,
        parentFont: parentStyle.font, replyFont: replyStyle.font };
    });
    assert.equal(typography.parentColor, typography.replyColor, 'parent and reply text use the same foreground in mouse mode');
    assert.equal(typography.parentColor, typography.panelColor, 'comments inherit the panel foreground instead of fullscreen white');
    assert.equal(typography.parentFont, typography.replyFont, 'all comment bodies share the same typography');
    const labels = await detail.locator('.comment-author, .comment-text, .comment-translate, .detail-reply-count').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { color: style.color, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight };
    }));
    for (const label of labels) assert.deepEqual(label, { color: typography.panelColor, fontSize: '14px', lineHeight: '20px', fontWeight: '400' });
  }
  await page.evaluate(() => document.documentElement.removeAttribute('dark'));
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: `output/playwright/comment-detail-${layout}.png` });
  assert.equal(await host.locator('[data-focus-id="comments:more"]').count(), 0);
  assert.equal(await detail.getByText('Parent comment 11 with some text for reading.', { exact: true }).count(), 0);
  await host.locator('[data-focus-id="replies:more"]').click();
  assert.equal(await host.locator('.comment-reply').count(), 10);
  assert.equal(await page.evaluate(() => document.querySelector('#panels').shadowRoot.activeElement.dataset.focusId), 'comment:reply:["parent-10","reply-10-5"]');
  assert.deepEqual(await page.evaluate(() => window.requests), [['comments', true]], 'cached batches do not issue network requests');
  await host.locator('[data-focus-id="replies:more"]').click();
  assert.equal(await host.locator('.comment-reply').count(), 12);
  await host.locator('[data-focus-id="replies:more"]').click();
  assert.equal(await host.locator('.comment-reply').count(), 17, 'only five replies from the received page are revealed');
  assert.deepEqual(await page.evaluate(() => window.requests), [['comments', true], ['replies', 'parent-10']]);
  await host.getByRole('button', { name: 'Back to comments', exact: true }).click();
  assert.equal(await detail.count(), 0);
  assert.equal(await page.evaluate(() => window.sheet.scrollTop), scrollBefore);
  assert.equal(await page.evaluate(() => document.querySelector('#panels').shadowRoot.activeElement.dataset.focusId), 'replies:parent-10');
  assert.equal(await host.locator('.comment-reply').count(), 0);
  await original.click();
  assert.equal(await host.locator('.comment-reply').count(), 5, 'reentering starts with a small batch again');
  assert.equal(await page.evaluate(() => window.video === document.querySelector('#playing-video')), true);
  for (const language of ['ja', 'de', 'zh-Hans', 'en']) {
    await page.evaluate(language => {
      for (const item of window.records) { if (item.translationTarget) item.translationTarget = language;
        for (const reply of item.replies) reply.translationTarget = language; }
      window.panels.refresh();
    }, language);
    const translate = detail.locator('.detail-parent .comment-translate');
    assert.match(await translate.textContent(), /Translate to/);
    await translate.click();
    assert.equal(await detail.locator('.detail-parent .comment-text').textContent(), `Translated parent-10 to ${language}`);
    assert.equal(await translate.textContent(), 'Show original');
    const requests = await page.evaluate(() => window.requests.length);
    await translate.click();
    assert.equal(await detail.locator('.detail-parent .comment-text').textContent(), 'Parent comment 10 with some text for reading.');
    await translate.click();
    assert.equal(await page.evaluate(() => window.requests.length), requests, 'original/translation toggles do not request again');
  }
  const replyTranslation = detail.locator('.comment-reply .comment-translate').first();
  await replyTranslation.click();
  assert.equal(await detail.locator('.comment-reply .comment-text').first().textContent(), 'Translated reply-10-0 to en');
  assert.equal(await detail.locator('.comment-reply .comment-text').nth(1).textContent(), 'Reply 1 to parent 10');
  await page.evaluate(() => { delete window.records[10].translationTarget; window.panels.refresh(); });
  assert.equal(await detail.locator('.detail-parent .comment-translate').count(), 0, 'removing the native entry removes the button even with a cached translation');
  assert.equal(await detail.locator('.detail-parent .comment-text').textContent(), 'Parent comment 10 with some text for reading.');
  await page.evaluate(() => window.panels.open('comments'));
  assert.equal(await detail.count(), 0, 'selecting the comments tab returns to its list');
  await page.evaluate(() => { window.deferReplies = true; window.records[11].replies = []; });
  await host.locator('[data-focus-id="replies:parent-11"]').click();
  assert.match(await detail.getByRole('status').textContent(), /Loading replies/);
  await page.evaluate(() => { window.commentStatus = { loading: false, failed: true, hasMore: true }; window.panels.refresh(); });
  assert.match(await detail.getByRole('status').textContent(), /Could not load replies/);
  await detail.getByRole('button', { name: 'Retry', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.requests.slice(-2)), [['replies', 'parent-11'], ['replies', 'parent-11']]);
  await host.getByRole('button', { name: 'Back to comments', exact: true }).click();
  await page.evaluate(() => {
    window.commentStatus = { loading: false, failed: false, hasMore: true };
    window.records[11].replies = [{ key: 'late', author: 'Late', text: 'Late reply' }];
    window.panels.refresh();
  });
  assert.equal(await detail.count(), 0, 'a late reply response cannot reopen a thread after Back');
  assert.equal(await host.locator('.comment-reply').count(), 0);
  await page.evaluate(() => { window.panels.hide(); window.routeKey = 'second'; window.records = []; window.panels.open('comments'); });
  assert.equal(await detail.count(), 0, 'route changes clear thread history');
  assert.equal(await page.evaluate(() => window.panels.back()), false);
});

for (const layout of ['windowed', 'fullscreen']) test(`comments use independent motion rules and never expand into a full-screen backdrop (${layout})`, async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent('<!doctype html><html><body style="margin:0"><video></video></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(({ layout, styles }) => {
    document.documentElement.dataset.ytgPlaybackLayout = layout;
    const host = document.createElement('div'); host.id = 'panels'; document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
    const style = make('style'); style.textContent = styles;
    const dialog = make('div', 'dialog'), sheet = make('section', 'sheet'), surface = make('div', 'surface');
    dialog.hidden = true; dialog.append(sheet); root.append(style, surface, dialog);
    const state = { panel: '' };
    window.dialog = dialog;
    window.panels = WatchPanelsFixture.YTGamepadWatchPanels.create({ make, dialog, sheet, surface,
      description: make('div', 'description'), panelTitle: make('h2'), close: make('button', 'control'),
      watchState: () => state, send(event) { if (event.type === 'WATCH_PANEL') state.panel = event.panel; },
      focus() {}, controllerStyle: { bind() {}, hint(node, value) { node.textContent = value; }, badge() {} },
      controller: { readRoute: () => ({ key: 'fixture' }), readComments: () => [], request() {} }, descriptionText: 'Description'
    });
    window.panels.open('comments');
  }, { layout, styles: readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8') });
  const result = await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const opening = [];
    for (let index = 0; index < 4; index++) {
      await frame();
      opening.push({ opacity: getComputedStyle(window.dialog).opacity,
        translate: getComputedStyle(window.dialog.querySelector('.sheet')).translate });
    }
    await Promise.all(window.dialog.getAnimations().map(animation => animation.finished));
    const motion = { panel: getComputedStyle(window.dialog).transitionProperty,
      sheet: getComputedStyle(window.dialog.querySelector('.sheet')).transitionProperty };
    const before = window.dialog.getBoundingClientRect();
    window.panels.close();
    const frames = [];
    for (let index = 0; index < 18; index++) {
      await frame();
      const rect = window.dialog.getBoundingClientRect();
      frames.push({ width: rect.width, left: rect.left, display: getComputedStyle(window.dialog).display });
    }
    window.panels.open('description');
    const descriptionIsModal = window.dialog.classList.contains('description-panel') && !window.dialog.classList.contains('comments');
    window.panels.close(); window.panels.open('comments');
    const commentsIsSidebar = window.dialog.classList.contains('comments') && !window.dialog.classList.contains('description-panel');
    for (let index = 0; index < 3; index++) {
      window.panels.close(); await frame(); window.panels.open('comments'); await frame();
      opening.push({ opacity: getComputedStyle(window.dialog).opacity,
        translate: getComputedStyle(window.dialog.querySelector('.sheet')).translate });
    }
    return { before: { width: before.width, left: before.left }, opening, motion, frames, descriptionIsModal, commentsIsSidebar };
  });
  if (layout === 'windowed') {
    assert.deepEqual(result.motion, { panel: 'none', sheet: 'none' });
    for (const frame of result.opening) {
      assert.equal(frame.opacity, '1', 'windowed comments must cover the sidebar from the first visible frame');
      assert.ok(frame.translate === 'none' || frame.translate === '0px', 'windowed comments must not slide away from the sidebar background');
    }
  } else {
    assert.ok(result.motion.panel.includes('opacity'), 'fullscreen keeps its fade animation');
    assert.equal(result.motion.sheet, 'translate', 'fullscreen keeps its slide animation');
  }
  for (const frame of result.frames.filter(frame => frame.display !== 'none')) {
    assert.ok(frame.width <= result.before.width + 1, 'exit animation must never become a full-screen backdrop');
    assert.ok(frame.left >= result.before.left - 1, 'exit animation must stay away from the video');
  }
  assert.ok(result.descriptionIsModal);
  assert.ok(result.commentsIsSidebar);
});

for (const trustedTypes of [false, true]) {
  test(`Vue watch panels preserve focus, requests and cleanup (Trusted Types: ${trustedTypes})`, async t => {
    const page = await browserPage(t);
    await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<html><body><video></video></body></html>',
      headers: trustedTypes ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types 'none'" } : {} }));
    await page.goto('https://www.youtube.com/watch?v=fixture');
    await page.evaluate(code);
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'panels'; document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
      const dialog = make('div'), sheet = make('section'), description = make('div'), panelTitle = make('h2'), close = make('button'), surface = make('div');
      close.textContent = 'Back'; dialog.append(sheet); root.append(surface, dialog);
      window.state = { panel: '', panelIndex: 0 }; window.requests = []; window.routeKey = 'first'; window.failed = false;
      window.records = [{ key: 'one', author: 'Author', text: '<img onerror=alert(1)>', hasReplies: true, repliesLabel: 'Load replies', replies: [] }];
      window.descriptionText = '<b>Description</b>\nSecond line';
      window.panels = WatchPanelsFixture.YTGamepadWatchPanels.create({ make, dialog, sheet, description, panelTitle, close, surface,
        watchState: () => window.state,
        send(event) { if (event.type === 'WATCH_PANEL') window.state.panel = event.panel;
          if (event.type === 'WATCH_FOCUS') window.state.panelIndex = event.index;
          if (event.type === 'WATCH_PANEL_COUNT') window.state.panelIndex = Math.min(window.state.panelIndex, event.count); },
        focus() { [close, ...window.panels.buttons][window.state.panelIndex]?.focus(); },
        controllerStyle: { hint(node, text) { node.textContent = text; return node; }, bind() { return () => {}; }, badge() {} },
        controller: { readRoute: () => ({ key: window.routeKey }), readComments: () => structuredClone(window.records),
          readCommentsStatus: () => window.commentsStatus,
          readWatchFeatures: () => ({ comments: window.failed ? 'failed' : 'available' }),
          request(type, value) { window.requests.push([type, value]);
            if (type === 'playlists') return Promise.resolve([{ key: '0', title: '<img> My playlist', selected: false }]);
            if (type === 'savePlaylist') return Promise.resolve(!window.failSave);
            if (type === 'replies') window.records[0].replies = [{ key: 'reply-one', author: 'Reply author', text: '<script>reply</script>' }]; return true; } },
        get descriptionText() { return window.descriptionText; }
      });
      close.addEventListener('click', () => { if (!window.panels.back()) window.panels.close(); });
      window.panels.open('description');
    });
    const host = page.locator('#panels');
    assert.equal(await host.locator('[data-vue-description]').textContent(), '<b>Description</b>\nSecond line');
    assert.equal(await host.locator('b').count(), 0);
    await page.evaluate(() => { window.descriptionText = 'Updated description'; window.panels.refresh(); });
    assert.equal(await host.locator('[data-vue-description]').textContent(), 'Updated description');
    await host.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await host.locator('[data-vue-description]').count(), 0);
    await page.evaluate(() => window.panels.open('comments'));
    assert.equal(await host.locator('img').count(), 0);
    assert.equal(await host.locator('.comment-reply').count(), 0, 'list never expands replies inline');
    await host.locator('.comment-replies').click();
    assert.equal(await host.locator('[data-comment-detail]').count(), 1);
    assert.equal(await host.locator('.comment-reply .comment-text').textContent(), '<script>reply</script>');
    assert.equal(await host.locator('.comment-reply .comment-author').textContent(), 'Reply author');
    assert.equal(await host.locator('script').count(), 0);
    assert.equal(await host.locator('.detail-parent .comment-text').textContent(), '<img onerror=alert(1)>');
    assert.equal(await host.locator('[data-focus-id="comments:more"]').count(), 0, 'details cannot load other parent comments');
    await page.route('https://yt3.ggpht.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>' }));
    await page.evaluate(() => {
      window.records[0].avatar = 'https://yt3.ggpht.com/parent';
      window.records[0].replies[0].avatar = 'https://yt3.ggpht.com/reply';
      window.panels.refresh();
    });
    assert.equal(await host.locator('.comment-avatar img').count(), 2);
    await page.waitForFunction(() => [...document.querySelector('#panels').shadowRoot.querySelectorAll('.comment-avatar img')]
      .every(image => image.complete && image.naturalWidth > 0));
    await host.locator('.comment-reply .comment-avatar img').dispatchEvent('error');
    assert.equal(await host.locator('.comment-reply .comment-avatar img').count(), 0);
    assert.equal(await host.locator('.comment-reply .comment-avatar').textContent(), 'R');
    // Prepending a native comment must preserve focus on the reply action by ID.
    await host.locator('[data-focus-id="replies:more"]').focus();
    await page.evaluate(() => { window.records.unshift({ key: 'zero', author: 'New', text: 'New comment', hasReplies: false, repliesLabel: '', replies: [] }); window.panels.refresh(); });
    assert.equal(await page.evaluate(() => document.querySelector('#panels').shadowRoot.activeElement.dataset.focusId), 'replies:more');
    await page.evaluate(() => window.panels.back());
    assert.equal(await host.locator('[data-comment-detail]').count(), 0);
    await host.getByRole('button', { name: 'Load more comments' }).click();
    assert.deepEqual(await page.evaluate(() => window.requests), [['comments', true], ['replies', 'one'], ['comments', undefined]]);
    await page.evaluate(() => { window.panels.hide(); window.routeKey = 'second'; window.records = []; window.panels.open('comments'); });
    assert.match(await host.getByRole('status').textContent(), /still loading/);
    await page.evaluate(() => { window.failed = true; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /unavailable/);
    await page.evaluate(() => { window.commentsStatus = { loading: true, failed: false, hasMore: true }; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /Loading comments/);
    await page.evaluate(() => { window.commentsStatus = { loading: false, failed: true, hasMore: true }; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /Could not load comments/);
    assert.equal(await host.locator('[data-load-state="failed"]').count(), 1);
    assert.equal(await host.locator('[data-focus-id="comments:more"]').count(), 1, 'shared status owns the only retry action');
    await host.getByRole('button', { name: 'Retry', exact: true }).click();
    assert.equal(await page.evaluate(() => window.requests.at(-1)[0]), 'comments');
    await page.evaluate(() => { window.commentsStatus = { loading: true, failed: true, hasMore: true }; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /Loading comments/);
    assert.equal(await host.getByRole('button', { name: 'Retry', exact: true }).count(), 0, 'loading takes precedence over a stale failure');
    await page.evaluate(() => { window.commentsStatus = { loading: false, failed: false, hasMore: false }; window.panels.refresh(); });
    assert.match(await host.getByRole('status').textContent(), /No more comments/);
    assert.equal(await host.locator('[data-focus-id="comments:more"]').count(), 0);
    await page.evaluate(() => { window.panels.hide(); window.panels.open('playlists'); });
    const playlist = host.locator('[data-focus-id="playlist:0"]');
    await playlist.waitFor();
    assert.equal(await playlist.getAttribute('aria-pressed'), 'false');
    assert.equal(await host.locator('img').count(), 0);
    await page.evaluate(() => { window.failSave = true; });
    await playlist.click();
    await page.waitForFunction(() => document.querySelector('#panels').shadowRoot.querySelector('[role="status"]')?.textContent.includes('Could not update playlists'));
    assert.equal(await playlist.getAttribute('aria-pressed'), 'false');
    await host.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#panels').shadowRoot.querySelector('[data-focus-id="playlist:0"]').disabled);
    assert.equal(await page.evaluate(() => window.requests.at(-1)[0]), 'playlists');
    await page.evaluate(() => { window.failSave = false; });
    await playlist.click();
    await page.waitForFunction(() => document.querySelector('#panels').shadowRoot.querySelector('[data-focus-id="playlist:0"]').getAttribute('aria-pressed') === 'true');
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1)), ['savePlaylist', '0']);
    await host.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await host.locator('[data-vue-playlists]').count(), 0);
    await page.setViewportSize({ width: 390, height: 720 });
    await page.evaluate(() => { window.panels.destroy(); window.panels.refresh(); window.panels.open('comments'); window.panels.destroy(); });
    assert.equal(await host.locator('[data-vue-comments]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ytg-comments')), false);
    assert.equal(await page.locator('video').count(), 1);
  });
}


for (const layout of ['windowed', 'fullscreen']) test(`subscription menu persists preferences, handles failure and keeps cancellation explicit (${layout})`, async t => {
  const page = await browserPage(t);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent('<html><body style="margin:0"></body></html>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8') });
  await page.evaluate(code);
  await page.evaluate(({ layout, styles }) => {
    document.documentElement.dataset.ytgPlaybackLayout = layout;
    const host = document.createElement('div'); host.id = 'subscription-fixture'; document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
    const style = make('style'); style.textContent = styles;
    const dialog = make('div', 'dialog'), sheet = make('section', 'sheet'), surface = make('div', 'surface');
    const anchor = make('button'); anchor.dataset.action = 'subscribe'; anchor.textContent = 'Subscribed';
    anchor.style.cssText = 'position:fixed;top:150px;left:100px'; surface.append(anchor);
    dialog.hidden = true; dialog.append(sheet); root.append(style, surface, dialog);
    window.subscriptionState = { panel: '', panelIndex: 0 };
    window.subscriptionPage = { subscribed: true, notificationPreference: 'PERSONALIZED' };
    window.subscriptionCalls = []; window.failSubscription = false; window.refreshes = 0;
    const close = make('button', 'control');
    window.subscriptionPanels = WatchPanelsFixture.YTGamepadWatchPanels.create({ make, dialog, sheet, surface,
      description: make('div', 'description'), panelTitle: make('h2'), close,
      watchState: () => window.subscriptionState, send(event) {
        if (event.type === 'WATCH_PANEL') { window.subscriptionState.panel = event.panel; window.subscriptionState.panelIndex = 0; }
        if (event.type === 'WATCH_FOCUS') window.subscriptionState.panelIndex = event.index;
      }, focus() { [close, ...window.subscriptionPanels.buttons][window.subscriptionState.panelIndex]?.focus(); },
      controllerStyle: { bind(node, text, attribute) { if (attribute) node.setAttribute(attribute, text); else node.textContent = text; }, hint() {}, badge() {} },
      controller: { readRoute: () => ({ key: 'video' }), readWatchPage: () => window.subscriptionPage,
        requestRefresh() { window.refreshes++; }, async request(type, action) {
          window.subscriptionCalls.push([type, action]);
          if (window.failSubscription) return false;
          if (action === 'unsubscribe') window.subscriptionPage.subscribed = false;
          else window.subscriptionPage.notificationPreference = { notificationsAll: 'ALL', notificationsNone: 'NONE', notificationsPersonalized: 'PERSONALIZED' }[action];
          return true;
        } }, descriptionText: '' });
    close.addEventListener('click', () => window.subscriptionPanels.close());
    window.subscriptionPanels.open('subscription');
  }, { layout, styles: readFileSync(new URL('../src/ui/watch.css', import.meta.url), 'utf8') });
  const host = page.locator('#subscription-fixture');
  assert.equal(await host.locator('[data-focus-id="notificationsPersonalized"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => window.subscriptionCalls), [], 'opening the menu cannot unsubscribe');
  assert.equal(await page.evaluate(() => document.querySelector('#subscription-fixture').shadowRoot.activeElement.dataset.focusId), 'notificationsAll');
  const rect = await host.locator('.sheet').boundingBox();
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280);
  await host.locator('[data-focus-id="notificationsAll"]').click();
  assert.equal(await page.evaluate(() => window.subscriptionState.panel), '');
  assert.equal(await page.evaluate(() => window.subscriptionPage.notificationPreference), 'ALL');
  await page.evaluate(() => { window.failSubscription = true; window.subscriptionPanels.open('subscription'); });
  await host.locator('[data-focus-id="notificationsNone"]').click();
  await host.getByRole('alert').waitFor();
  assert.equal(await host.locator('[data-focus-id="notificationsAll"]').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => { window.failSubscription = false; });
  await host.locator('[data-focus-id="notificationsNone"]').click();
  await page.evaluate(() => window.subscriptionPanels.open('subscription'));
  assert.equal(await host.locator('[data-focus-id="notificationsNone"]').getAttribute('aria-pressed'), 'true');
  mkdirSync(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: `output/playwright/subscription-menu-${layout}.png` });
  await host.locator('[data-focus-id="unsubscribe"]').click();
  assert.equal(await page.evaluate(() => window.subscriptionPage.subscribed), false);
  assert.equal(await page.evaluate(() => window.subscriptionState.panel), '');
  assert.deepEqual(await page.evaluate(() => window.subscriptionCalls.at(-1)), ['watchAction', 'unsubscribe']);
  await page.evaluate(() => window.subscriptionPanels.destroy());
});
