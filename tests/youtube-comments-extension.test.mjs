import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchExtension } from './helpers/extension.mjs';
import { ProtoUtils } from 'youtubei.js/web';

function response(id, { initial = false, next, replies = false, translateTo } = {}) {
  const token = value => ({ continuationItemRenderer: { continuationEndpoint: {
    continuationCommand: { token: value, request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' }
  } } });
  const items = [{ commentThreadRenderer: { commentViewModel: { commentViewModel: { commentId: id, commentKey: `key:${id}`,
    ...(translateTo ? { translateButton: { buttonRenderer: { serviceEndpoint: { performCommentActionEndpoint: {
      action: ProtoUtils.encodeCommentActionParams(22, { text: `Body ${id}`, target_language: translateTo })
    } } } } } : {}) } },
    ...(replies ? { replies: { commentRepliesRenderer: { subThreads: [token('reply-parent')] } } } : {})
  } }, ...(next ? [token(next)] : [])];
  return { onResponseReceivedEndpoints: [
    ...(initial ? [{ reloadContinuationItemsCommand: { continuationItems: [] } }] : []),
    { appendContinuationItemsAction: { continuationItems: items } }
  ], frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { commentEntityPayload: {
    key: `key:${id}`, properties: { content: { content: `Body ${id}` } },
    author: { displayName: `Author ${id}`, channelId: 'UCtest' }, toolbar: { replyCount: '1' }
  } } }] } } };
}

test('manifest comments service loads comments, replies and next page without native comment nodes under CSP', { timeout: 45000 }, async t => {
  const { context, worker } = await launchExtension(t);
  await worker.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await context.addCookies([{ name: 'SAPISID', value: 'comments-session', domain: 'www.youtube.com', path: '/', secure: true }]);
  await context.addInitScript(() => {
    window.ytcfg = { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'comments-browser' }, user: {} },
      INNERTUBE_CONTEXT_CLIENT_NAME: 1, SESSION_INDEX: 2 })[key] };
    window.scrollTo = () => { throw new Error('Native scrolling'); };
    Element.prototype.scrollIntoView = () => { throw new Error('Native scrolling'); };
  });
  const calls = [];
  await context.route('https://www.youtube.com/**', async route => {
    if (new URL(route.request().url()).pathname === '/youtubei/v1/next') {
      const body = route.request().postDataJSON();
      if (!body.continuation) { await route.fulfill({ json: {} }); return; }
      calls.push({ body, headers: await route.request().allHeaders() });
      await route.fulfill({ json: body.continuation === 'reply-parent' ? response('reply')
        : body.continuation === 'comments-next' ? response('second')
          : response('parent', { initial: true, next: 'comments-next', replies: true, translateTo: 'ja' }) });
    } else if (new URL(route.request().url()).pathname === '/youtubei/v1/comment/perform_comment_action') {
      const body = route.request().postDataJSON();
      calls.push({ body, headers: await route.request().allHeaders() });
      if (!Array.isArray(body.actions) || body.actions.length !== 1 || typeof body.actions[0] !== 'string' || 'action' in body) {
        await route.fulfill({ status: 400, json: { error: { code: 400, message: 'Expected actions array' } } }); return;
      }
      await route.fulfill({ json: { frameworkUpdates: { entityBatchUpdate: { mutations: [
        { payload: { commentEntityPayload: { translatedContent: { content: '原版接口返回的译文' } } } }
      ] } } } });
    } else await route.fulfill({ contentType: 'text/html',
      headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'" },
      body: '<!doctype html><html><body><ytd-app></ytd-app></body></html>' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=comments');
  const request = (operation, fields = {}) => page.evaluate(({ operation, fields }) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { document.removeEventListener('ytg-page-response-v1', receive); reject(new Error('Bridge timeout')); }, 10000);
    function receive(event) {
      const value = JSON.parse(event.detail);
      if (value.id !== id) return;
      clearTimeout(timer); document.removeEventListener('ytg-page-response-v1', receive); resolve(value);
    }
    document.addEventListener('ytg-page-response-v1', receive);
    document.dispatchEvent(new CustomEvent('ytg-page-request-v1', { detail: JSON.stringify({ version: 1, id, operation, ...fields }) }));
  }), { operation, fields });
  async function settled() {
    for (let i = 0; i < 100; i++) {
      const value = (await request('readComments')).value;
      if (!value.loading) return value;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Comments did not settle');
  }
  await request('moreComments', { start: true });
  let snapshot = await settled();
  assert.equal(snapshot.failed, false);
  assert.equal(snapshot.items[0].text, 'Body parent');
  assert.equal(snapshot.items[0].translationTarget, 'ja');
  await request('commentReplies', { key: 'parent' });
  snapshot = await settled();
  assert.deepEqual(snapshot.items[0].replies, [{ key: 'reply', author: 'Author reply', text: 'Body reply' }]);
  await request('moreComments'); snapshot = await settled();
  assert.deepEqual(snapshot.items.map(item => item.key), ['parent', 'second']);
  assert.equal(snapshot.hasMore, false);
  assert.equal(calls.length, 3);
  assert.equal((await request('commentTranslate', { key: 'reply', language: 'ja' })).value, false, 'a reply without an entry cannot be translated');
  assert.equal((await request('commentTranslate', { key: 'parent', language: 'en' })).value, false, 'the native target cannot be replaced by the UI language');
  assert.equal(calls.length, 3);
  assert.equal((await request('commentTranslate', { key: 'parent', language: 'ja' })).value, true);
  for (let index = 0; index < 100; index++) {
    snapshot = (await request('readComments')).value;
    if (!snapshot.items[0].translation?.loading) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(snapshot.items[0].translation.text, '原版接口返回的译文');
  assert.equal(snapshot.items[0].translation.language, 'ja');
  assert.equal(snapshot.items[0].text, 'Body parent');
  assert.equal(snapshot.items[0].replies[0].translation, undefined);
  assert.equal(calls.length, 4);
  assert.equal(typeof calls[3].body.actions[0], 'string');
  assert.equal(calls[3].body.action, undefined);
  for (const call of calls) {
    assert.match(call.headers.cookie, /SAPISID=comments-session/);
    assert.match(call.headers.authorization, /^SAPISIDHASH /);
    assert.equal(call.headers['x-goog-authuser'], '2');
  }
  assert.equal(JSON.stringify(snapshot).includes('comments-next'), false);
  assert.equal(await page.locator('ytd-comments').count(), 0);
  assert.deepEqual(errors, []);
});
