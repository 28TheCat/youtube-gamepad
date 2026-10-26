import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-comments.ts', import.meta.url)),
    formats: ['iife'], name: 'CommentsFixture' } } });
const code = (Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code;
const continuation = token => ({ continuationItemRenderer: { trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
  continuationEndpoint: { continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' } },
  button: { buttonRenderer: { text: { simpleText: 'More' }, navigationEndpoint: {
    continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' }
  } } } } });
function response(ids, token, { initial = false, replies = false } = {}) {
  const items = ids.map(id => ({ commentThreadRenderer: {
    commentViewModel: { commentViewModel: { commentId: id, commentKey: `entity:${id}` } },
    ...(replies ? { replies: { commentRepliesRenderer: { subThreads: [continuation(`replies:${id}`)] } } } : {})
  } }));
  if (token) items.push(continuation(token));
  const endpoints = [{ appendContinuationItemsAction: { continuationItems: items } }];
  if (initial) endpoints.unshift({ reloadContinuationItemsCommand: { continuationItems: [] } });
  return { onResponseReceivedEndpoints: endpoints, frameworkUpdates: { entityBatchUpdate: { mutations: ids.map(id => ({
    entityKey: `entity:${id}`, payload: { commentEntityPayload: {
      key: `entity:${id}`, properties: { content: { content: `Text ${id}` }, publishedTime: 'today' },
      author: { displayName: `Author ${id}`, channelId: 'UCtest', avatarThumbnailUrl: `https://yt3.ggpht.com/${id}=s88` }, toolbar: { replyCount: replies ? '2' : '0' }
    } }
  })) } } };
}
function fixture(handler) {
  const calls = [];
  const location = { pathname: '/watch', search: '?v=first', origin: 'https://www.youtube.com' };
  const document = new EventTarget();
  document.cookie = 'SAPISID=fixture-session';
  document.querySelector = document.querySelectorAll = () => { throw new Error('Native DOM read'); };
  const sandbox = { document, location, Event, URL, URLSearchParams, AbortController, Request, Response, Headers,
    structuredClone, TextEncoder, TextDecoder, btoa, atob, crypto: webcrypto, setTimeout, clearTimeout, console,
    window: { ytcfg: { get: key => ({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'page-version' }, user: {} },
      INNERTUBE_CONTEXT_CLIENT_NAME: 1, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand-account' })[key] } },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body });
      const raw = await handler(body, calls.length, options);
      return { ok: true, json: async () => raw };
    } };
  vm.runInNewContext(code, sandbox);
  const service = sandbox.CommentsFixture.createCommentsService();
  async function idle() {
    for (let i = 0; i < 100; i++) {
      if (!service.read().loading) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Comments did not settle');
  }
  return { service, calls, location, idle, sandbox };
}
test('direct Shorts routes load comments for their video and retain the Shorts route on snapshots', async () => {
  const f = fixture(() => response(['short'], undefined, { initial: true }));
  f.location.pathname = '/shorts/first'; f.location.search = '';
  assert.equal(f.service.more(true), true); await f.idle();
  assert.equal(f.service.read().route, '/shorts/first');
  assert.equal(f.service.read().items[0].text, 'Text short');
  f.service.destroy();
});

test('comments use actual library parsing and authenticated page requests, append without duplicates and stop at the end', async () => {
  const f = fixture((_body, count) => count === 1 ? response(['one'], 'comments-next', { initial: true, replies: true }) : response(['one', 'two']));
  f.service.more(true); f.service.more(true);
  await f.idle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.read().items[0].text, 'Text one');
  assert.equal(f.service.read().items[0].author, 'Author one');
  assert.equal(f.service.read().items[0].avatar, 'https://yt3.ggpht.com/one=s88');
  f.service.more(); await f.idle();
  assert.equal(f.calls[1].body.continuation, 'comments-next');
  assert.deepEqual(Array.from(f.service.read().items, item => item.key), ['one', 'two']);
  assert.equal(f.service.more(), false);
  for (const { url, body, options } of f.calls) {
    assert.equal(url, '/youtubei/v1/next');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(body.context.client.clientVersion, 'page-version');
    assert.equal(options.headers['X-Goog-AuthUser'], '2');
    assert.equal(options.headers['X-Goog-PageId'], 'brand-account');
    assert.match(options.headers.Authorization, /^SAPISIDHASH /);
    assert.equal(options.headers.Cookie, undefined);
  }
  assert.equal(JSON.stringify(f.service.read()).includes('comments-next'), false);
  f.service.destroy();
});
test('replies and their continuation append to their parent only', async () => {
  const f = fixture((_body, count) => count === 1 ? response(['parent'], undefined, { initial: true, replies: true })
    : count === 2 ? response(['reply1'], 'reply-next') : response(['reply2']));
  f.service.more(true); await f.idle();
  assert.equal(f.service.replies('unknown'), false);
  assert.equal(f.service.read().items[0].replyCount, 2);
  f.service.replies('parent'); await f.idle();
  assert.equal(f.calls[1].body.continuation, 'replies:parent');
  assert.equal(f.service.read().items[0].replies[0].text, 'Text reply1');
  assert.deepEqual(JSON.parse(JSON.stringify(f.service.read().items[0].replies)),
    [{ key: 'reply1', author: 'Author reply1', text: 'Text reply1', avatar: 'https://yt3.ggpht.com/reply1=s88' }]);
  f.service.replies('parent'); await f.idle();
  assert.equal(f.calls[2].body.continuation, 'reply-next');
  assert.deepEqual(Array.from(f.service.read().items[0].replies, reply => reply.text), ['Text reply1', 'Text reply2']);
  assert.deepEqual(Array.from(f.service.read().items[0].replies, reply => reply.key), ['reply1', 'reply2']);
  assert.equal(f.service.read().items[0].hasReplies, false);
  assert.equal(f.service.read().items.length, 1);
  f.service.destroy();
});

test('API JSON goes directly to the parser without constructing a network response', async () => {
  const f = fixture((_body, count) => {
    const raw = count === 1 ? response(['parent'], 'next', { initial: true, replies: true })
      : count === 2 ? response(['reply']) : response(['second']);
    raw.toJSON = () => { throw new Error('API JSON must not be serialized again'); };
    return raw;
  });
  f.sandbox.Response = class { constructor() { throw new Error('Synthetic Response is forbidden'); } };
  f.sandbox.Request = class { constructor() { throw new Error('Synthetic Request is forbidden'); } };
  f.service.more(true); await f.idle();
  assert.equal(f.service.read().items[0]?.text, 'Text parent');
  f.service.replies('parent'); await f.idle();
  assert.equal(f.service.read().items[0]?.replies[0].text, 'Text reply');
  f.service.more(); await f.idle();
  assert.deepEqual(Array.from(f.service.read().items, item => item.key), ['parent', 'second']);
  assert.equal(f.service.read().failed, false);
  assert.equal(f.calls.length, 3);
  f.service.destroy();
});
test('failed pagination preserves comments and retries the same token', async () => {
  const f = fixture((_body, count) => {
    if (count === 1) return response(['one'], 'retry-token', { initial: true });
    if (count === 2) return { error: { code: 400 } };
    return response(['two']);
  });
  f.service.more(true); await f.idle(); f.service.more(); await f.idle();
  assert.equal(f.service.read().failed, true);
  assert.equal(f.service.read().items.length, 1);
  f.service.more(); await f.idle();
  assert.equal(f.calls[1].body.continuation, f.calls[2].body.continuation);
  assert.equal(f.service.read().failed, false);
  assert.equal(f.service.read().items.length, 2);
  f.service.destroy();
});
test('reply failures preserve expanded replies and retry the reply continuation', async () => {
  const f = fixture((_body, count) => {
    if (count === 1) return response(['parent'], undefined, { initial: true, replies: true });
    if (count === 2) return response(['reply1'], 'retry-reply');
    if (count === 3) return { error: { code: 400 } };
    return response(['reply2']);
  });
  f.service.more(true); await f.idle(); f.service.replies('parent'); await f.idle();
  f.service.replies('parent'); await f.idle();
  assert.equal(f.service.read().failed, true);
  assert.deepEqual(Array.from(f.service.read().items[0].replies, reply => reply.text), ['Text reply1']);
  f.service.more(); await f.idle();
  assert.equal(f.calls[2].body.continuation, f.calls[3].body.continuation);
  assert.deepEqual(Array.from(f.service.read().items[0].replies, reply => reply.text), ['Text reply1', 'Text reply2']);
  f.service.destroy();
});

test('navigation aborts old requests and late responses cannot overwrite the new video', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.service.more(true);
  for (let i = 0; !finish && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(finish, 'request reached the transport');
  f.location.search = '?v=second'; f.service.routeChanged();
  assert.equal(f.calls[0].options.signal.aborted, true);
  finish(response(['old'], undefined, { initial: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.service.read().items.length, 0);
  assert.equal(f.service.read().route, '/watch?v=second');
  f.service.destroy();
});
