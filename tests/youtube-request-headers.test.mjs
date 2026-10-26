import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript-vue';

const source = ts.transpileModule(readFileSync(new URL('../src/sites/youtube-request.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
function fixture(cookie = '') {
  const exports = {}, document = { cookie };
  const config = { INNERTUBE_CONTEXT_CLIENT_NAME: 1, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand' };
  vm.runInNewContext(source, { exports, document, window: { ytcfg: { get: key => config[key] } },
    location: { origin: 'https://www.youtube.com' }, crypto: webcrypto, TextEncoder });
  return { document, headers: sid => exports.createYouTubeHeaders({ client: { clientVersion: 'page-version' } }, sid) };
}
function signedWith(headers, sid) {
  const [, timestamp, hash] = headers.Authorization.match(/^SAPISIDHASH (\d+)_([a-f0-9]{40})$/);
  assert.equal(hash, createHash('sha1').update(`${timestamp} ${sid} https://www.youtube.com`).digest('hex'));
}

test('shared headers preserve account selection and prefer SAPISID without forwarding cookies', async () => {
  const headers = await fixture('other=x;__Secure-3PAPISID=secondary;SAPISID=primary').headers();
  signedWith(headers, 'primary');
  assert.equal(headers['X-Goog-AuthUser'], '2');
  assert.equal(headers['X-Goog-PageId'], 'brand');
  assert.equal(headers['X-Youtube-Client-Version'], 'page-version');
  assert.equal(headers.Cookie, undefined);
  assert.equal(JSON.stringify(headers).includes('primary'), false);
});

test('secure SID fallback, captured identity and explicit anonymous identity remain distinct', async () => {
  const f = fixture('__Secure-3PAPISID=secure');
  signedWith(await f.headers(), 'secure');
  f.document.cookie = 'SAPISID=new-account';
  signedWith(await f.headers('captured-account'), 'captured-account');
  assert.equal((await f.headers('')).Authorization, undefined);
  assert.equal((await fixture().headers()).Authorization, undefined);
});
