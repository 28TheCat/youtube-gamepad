import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';

test('production MAIN runtime graph contains only page adapters and their data helpers', () => {
  const allowed = new Set(['entries/main', 'bridge/page-server', 'bridge/page-protocol', 'sites/youtube-feed', 'shared/browse-categories']);
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    assert.ok(allowed.has(file), `Application dependency leaked into MAIN: ${file}`);
    visited.add(file);
    const source = ts.transpileModule(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
    }).outputText;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier) continue;
      const name = statement.moduleSpecifier.text;
      assert.ok(name.startsWith('.'), `External runtime imported by MAIN: ${name}`);
      const url = new URL(name.replace(/\.ts$/, '') + '.ts', new URL(`../src/${file}.ts`, import.meta.url));
      const base = new URL('../src/', import.meta.url);
      visit(url.pathname.slice(base.pathname.length).replace(/\.ts$/, ''));
    }
  }
  visit('entries/main');
  assert.deepEqual(visited, allowed);
});

function load(file, context, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(source, { ...context, exports, require: name => {
    assert.ok(name in modules, `Unexpected runtime dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}

function fixture() {
  const document = new EventTarget(), window = new EventTarget();
  let player;
  document.querySelector = () => player;
  const context = { document, window, CustomEvent, crypto: { randomUUID: () => 'test' },
    history: { pushState() {}, replaceState() {} }, location: { pathname: '/', search: '' } };
  const protocol = load('bridge/page-protocol', context);
  const modules = { './page-protocol': protocol };
  const server = load('bridge/page-server', context, { ...modules,
    '../sites/youtube-feed': { createYouTubeFeedService: () => ({ cancel() {}, categories: () => [] }) } });
  const client = load('bridge/page-client', context, modules).createPageClient();
  return { document, window, context, protocol, server, client, setPlayer: value => { player = value; } };
}

test('MAIN handshake does not require a player and exposes only bounded metadata', () => {
  const f = fixture();
  assert.equal(f.client.ping(), false);
  const dispose = f.server.startPageServer();
  assert.equal(f.client.ping(), true);
  let shown = 0;
  f.setPlayer({ getPlayerResponse: () => ({ videoDetails: { videoId: 'abc', title: 'x'.repeat(5000),
    shortDescription: 'y'.repeat(30000), isLive: true, secret: 'hidden' } }), showControls: () => shown++ });
  const details = f.client.readVideoDetails();
  assert.equal(details.title.length, 2000);
  assert.equal(details.shortDescription.length, 20000);
  assert.equal(details.secret, undefined);
  f.client.showControls();
  assert.equal(shown, 1);
  dispose();
  assert.equal(f.client.ping(), false);
});

test('MAIN rejects malformed and privileged requests and survives reinjection', () => {
  const f = fixture();
  const original = f.context.history.pushState;
  f.server.startPageServer();
  const dispose = f.server.startPageServer();
  let responses = 0;
  f.document.addEventListener(f.protocol.PAGE_RESPONSE, () => responses++);
  for (const detail of ['{', '{}', JSON.stringify({ version: 1, id: 'test', operation: 'storage.set' }),
    JSON.stringify({ version: 1, id: 'x'.repeat(101), operation: 'ping' })]) {
    f.document.dispatchEvent(new CustomEvent(f.protocol.PAGE_REQUEST, { detail }));
  }
  assert.equal(responses, 0);
  assert.equal(f.client.ping(), true);
  assert.equal(responses, 1);
  f.window.dispatchEvent(new CustomEvent('pagehide', { detail: null }));
  assert.equal(f.client.ping(), false);
  assert.equal(f.context.history.pushState, original);
  dispose();
});

function handshakeFixture() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const { waitForPageServer } = load('bridge/page-ready', {
    Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  return { waitForPageServer, timers, tick() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); now = timer.at; timer.callback();
  } };
}

test('startup retries a late MAIN adapter and releases its timer on readiness', async () => {
  const f = handshakeFixture(), controller = new AbortController();
  let ready = false;
  const waiting = f.waitForPageServer({ ping: () => ready }, controller.signal, 300, 100);
  f.tick();
  ready = true;
  f.tick();
  assert.equal(await waiting, true);
  assert.equal(f.timers.size, 0);
});

test('startup timeout or cancellation permits native fallback without leaked retries', async () => {
  for (const cancel of [false, true]) {
    const f = handshakeFixture(), controller = new AbortController();
    let requests = 0;
    const waiting = f.waitForPageServer({ ping: () => { requests++; return false; } }, controller.signal, 200, 100);
    if (cancel) controller.abort();
    else { f.tick(); f.tick(); }
    assert.equal(await waiting, false);
    assert.equal(f.timers.size, 0);
    if (cancel) assert.equal(requests, 1);
  }
});

test('already cancelled startup never contacts the page', async () => {
  const f = handshakeFixture(), controller = new AbortController();
  controller.abort();
  assert.equal(await f.waitForPageServer({ ping() { throw new Error('Must not request'); } }, controller.signal), false);
  assert.equal(f.timers.size, 0);
});
