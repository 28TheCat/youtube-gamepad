import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';

function scope() {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/sites/request-scope.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, AbortController, setTimeout, clearTimeout });
  return exports.createRequestScope();
}

test('cancel invalidates every old request without letting its cleanup clear a new request', () => {
  const requests = scope(), first = requests.begin(), second = requests.begin();
  requests.cancel();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.current, false);
  assert.equal(requests.pending, false);
  const replacement = requests.begin();
  first.finish(); second.finish();
  assert.equal(requests.pending, true);
  assert.equal(replacement.current, true);
  replacement.finish();
  assert.equal(requests.pending, false);
});

test('timeout invalidates a request and destruction prevents reuse', async () => {
  const requests = scope(), request = requests.begin(1);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(request.current, false);
  request.finish();
  const next = requests.begin();
  requests.destroy();
  assert.equal(next.signal.aborted, true);
  assert.equal(requests.pending, false);
  assert.throws(() => requests.begin(), /destroyed/);
  next.finish();
});

