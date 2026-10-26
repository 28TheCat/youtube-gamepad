import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { accountData } from './helpers/account-data.mjs';

const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-account.ts', import.meta.url)), formats: ['iife'], name: 'AccountFixture' } } });
const code = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk').code;
function fixture(handler) {
  const calls = [], settings = { INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' }, user: {} },
    LOGGED_IN: true, SESSION_INDEX: 2, DELEGATED_SESSION_ID: 'brand' };
  let cookie = 'SAPISID=fixture', now = Date.now();
  const sandbox = { URL, AbortController, structuredClone, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout, console,
    Date: class extends Date { static now() { return now; } }, location: { origin: 'https://www.youtube.com' },
    window: { ytcfg: { get: key => settings[key] } },
    document: { get cookie() { return cookie; }, querySelector() { throw Error('Native account read'); } },
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
      return { ok: true, json: async () => handler ? await handler(calls.length) : accountData() };
    } };
  vm.runInNewContext(code, Object.assign(sandbox, { Headers, Request, Response }));
  return { service: sandbox.AccountFixture.createAccountService(), calls, settings,
    signOut() { settings.LOGGED_IN = false; }, advance() { now += 61000; } };
}
test('account API reuses the page identity and exposes display data without private endpoints', async () => {
  const s = fixture(), value = await s.service.read();
  assert.equal(value.accounts.length, 2);
  assert.equal(value.accounts[0].name, 'Example Creator');
  assert.equal(value.accounts[0].selected, true);
  assert.equal(value.accounts[1].name, '<img> Other creator');
  assert.equal(s.calls[0].url, '/youtubei/v1/account/accounts_list');
  assert.equal(s.calls[0].body.requestType, 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER');
  assert.equal(s.calls[0].headers['x-goog-authuser'], '2');
  assert.equal(s.calls[0].headers['x-goog-pageid'], 'brand');
  assert.match(s.calls[0].headers.authorization, /^SAPISIDHASH /);
  assert.equal(JSON.stringify(value).includes('private'), false);
  value.accounts[0].name = 'Modified by caller';
  assert.equal((await s.service.read()).accounts[0].name, 'Example Creator');
  assert.equal(s.calls.length, 1);
  s.service.destroy();
});
test('account requests share a pending load and refresh after expiry', async () => {
  const s = fixture();
  const [a, b] = await Promise.all([s.service.read(), s.service.read()]);
  assert.deepEqual(a, b); assert.equal(s.calls.length, 1);
  s.advance(); await s.service.read(); assert.equal(s.calls.length, 2); s.service.destroy();
});
test('logout clears cached profile without fetching or guessing a current account', async () => {
  const s = fixture(); await s.service.read(); s.signOut();
  const value = await s.service.read();
  assert.equal(value.signedIn, false); assert.equal(value.accounts.length, 0);
  assert.equal(s.calls.length, 1); s.service.destroy();
});
test('malformed accounts can be retried without falling back to native menu data', async () => {
  const s = fixture(count => count === 1 ? { actions: [] } : accountData());
  await assert.rejects(s.service.read(), /Account list unavailable/);
  assert.equal((await s.service.read(true)).accounts.length, 2); s.service.destroy();
});
test('changing the page identity rejects a pending response from the previous identity', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture(count => count === 1 ? gate : accountData(1));
  const first = s.service.read();
  while (!s.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  s.settings.SESSION_INDEX = 3;
  const second = s.service.read(); release(accountData(0));
  await assert.rejects(first, /cancelled/);
  assert.equal((await second).accounts[1].selected, true); s.service.destroy();
});
