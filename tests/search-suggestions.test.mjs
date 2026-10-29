import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/search/search-suggestions.ts', import.meta.url)), formats: ['iife'], name: 'SuggestionsFixture' } } });
const sandbox = { URL, URLSearchParams, Headers, Request, Response, structuredClone, TextEncoder, console, setTimeout, clearTimeout,
  location: { origin: 'https://www.youtube.com' }, document: { documentElement: { lang: 'zh-CN' } } };
vm.runInNewContext((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code, sandbox);
const { requestSearchSuggestions } = sandbox.SuggestionsFixture;
async function read(raw) {
  sandbox.fetch = async () => new Response(raw);
  return requestSearchSuggestions('', new AbortController().signal);
}

test('YouTube.js parses suggestions, bounds and deduplicates terms without executing scripts', async () => {
  assert.equal(JSON.stringify(await read('window.google.ac.h(["",[["music",0],["music",0],["<img>",0],[42],["' + 'x'.repeat(257) + '"]]]);')), '["music","<img>"]');
  assert.equal(JSON.stringify(await read('["",[]]')), '[]');
  await assert.rejects(read('window.google.ac.h([]);alert(1)'));
  await assert.rejects(read('{}'));
  await assert.rejects(read('x'.repeat(100001)));
});

test('library completion requests retain locale, same-origin credentials and cancellation', async () => {
  const controller = new AbortController();
  sandbox.fetch = async (url, options) => {
    assert.equal(url.origin, 'https://www.youtube.com');
    assert.equal(url.pathname, '/complete/search');
    assert.equal(url.searchParams.get('q'), '');
    assert.equal(url.searchParams.get('hl'), 'zh-CN');
    assert.equal(url.searchParams.get('ds'), 'yt');
    assert.ok(url.searchParams.has('sugexp'), 'parameters come from the library');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, controller.signal);
    assert.equal(options.headers, undefined, 'library cookie headers are not forwarded');
    return new Response('["",[["music",0]]]');
  };
  assert.equal(JSON.stringify(await requestSearchSuggestions('', controller.signal)), '["music"]');
  sandbox.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(requestSearchSuggestions('', controller.signal));
  controller.abort();
  sandbox.fetch = async () => { throw new Error('aborted request must not fetch'); };
  await assert.rejects(requestSearchSuggestions('', controller.signal), { name: 'AbortError' });
});
