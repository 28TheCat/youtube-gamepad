import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ProtoUtils } from 'youtubei.js/web';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  lib: { entry: fileURLToPath(new URL('../src/sites/native-comment-translation.ts', import.meta.url)), formats: ['iife'], name: 'NativeTranslation' } } });
const sandbox = { atob, TextDecoder, Uint8Array };
vm.runInNewContext((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code, sandbox);
const read = sandbox.NativeTranslation.nativeCommentTranslations;
const endpoint = (language, type = 22) => ({ performCommentActionEndpoint: {
  action: ProtoUtils.encodeCommentActionParams(type, { text: 'Native text', target_language: language })
} });

test('native translation commands preserve arbitrary target languages', () => {
  for (const language of ['en', 'ja', 'de', 'ar', 'ko', 'es', 'zh-Hans', 'zh-Hant', 'pt-BR']) {
    const command = endpoint(language);
    const result = read({ contents: [{ commentViewModel: { commentId: 'one', translateButton: { onTap: { innertubeCommand: command } } } }] });
    assert.equal(result.get('one').language, language);
    assert.equal(result.get('one').action, command.performCommentActionEndpoint.action);
  }
});

test('entity references and text alone never imply a native translation offer', () => {
  const result = read({ contents: [
    { commentId: 'chinese', text: '这是一条中文评论', commentKey: 'entity-one' },
    { commentId: 'english', text: 'This is an English comment' }
  ], frameworkUpdates: { entityBatchUpdate: { mutations: [
    { payload: { commentEntityPayload: { key: 'entity-one', properties: { translateButtonEntityKey: 'state-only' } } } },
    { payload: { triStateButtonStateEntityPayload: { key: 'state-only', stateIdentifier: 'TRI_STATE_IDENTIFIER_UNTOGGLED_STATE' } } }
  ] } } });
  assert.equal(result.get('chinese'), undefined);
  assert.equal(result.get('english'), undefined);
});

test('surface entities belong only to the referenced comment and replies cannot lend their offers to parents', () => {
  const result = read({ contents: [
    { commentId: 'surface', commentSurfaceKey: 'surface-key' },
    { commentId: 'parent', replies: [{ commentId: 'reply', translateButton: endpoint('ar') }] }
  ], frameworkUpdates: { entityBatchUpdate: { mutations: [
    { payload: { commentSurfaceEntityPayload: { key: 'surface-key', translateButton: endpoint('de') } } }
  ] } } });
  assert.equal(result.get('surface').language, 'de');
  assert.equal(result.get('parent'), undefined);
  assert.equal(result.get('reply').language, 'ar');
});

test('malformed commands and non-translation actions do not create entries', () => {
  for (const command of [endpoint('ja', 1), { performCommentActionEndpoint: { action: '%bad' } },
    { performCommentActionEndpoint: { action: 'CBY=' } }, { performCommentActionEndpoint: { actions: {} } }]) {
    assert.equal(read({ contents: [{ commentId: 'one', translateButton: command }] }).get('one'), undefined);
  }
});
