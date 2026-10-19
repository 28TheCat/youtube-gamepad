import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';

function site(pageAccess) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/sites/youtube.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({}), window: {},
    document: { body: null, querySelector() { throw Error('Unexpected native DOM access'); },
      querySelectorAll() { throw Error('Unexpected native DOM access'); } } });
  return exports.YTGamepadSiteModule.create({ pageAccess,
    runtime: { scope: () => ({ cleanup() {}, listen() {}, destroy() {} }) } });
}

test('comments, replies and pagination use the page port without scanning native markup', () => {
  const items = [{ key: 'comment', author: 'Author', text: 'Text', expanded: [] }];
  const calls = [];
  const port = site({ readComments: () => ({ items, failed: false }),
    moreComments: start => { calls.push(['more', start]); return true; },
    commentReplies: key => { calls.push(['replies', key]); return true; } });
  assert.equal(port.readComments(), items);
  assert.equal(port.loadComments(true), true);
  assert.equal(port.loadComments(), true);
  assert.equal(port.expandReplies('comment'), true);
  assert.deepEqual(calls, [['more', true], ['more', false], ['replies', 'comment']]);
  assert.equal(port.readWatchFeatures().comments, 'available');
  assert.equal('syncCommentPreload' in port, false);
});

test('a missing page port returns empty comments and cannot trigger native scrolling or clicks', () => {
  const port = site();
  assert.equal(port.readComments().length, 0);
  assert.equal(port.loadComments(true), false);
  assert.equal(port.expandReplies('comment'), false);
});

test('failed comment snapshots retain existing items and report the failure', () => {
  const items = [{ key: 'existing', author: '', text: 'Retained', expanded: [] }];
  const port = site({ readComments: () => ({ items, failed: true }) });
  assert.equal(port.readComments(), items);
  assert.equal(port.readWatchFeatures().comments, 'failed');
});
