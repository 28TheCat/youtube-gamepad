import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const window = {};
const source = ['src/search/pinyin-data.ts', 'src/search/pinyin.ts'].map(file => moduleSource(file)).join('\n');
runInNewContext(source, { window });
const ime = window.YTGamepadPinyin;
test('full pinyin words and ü normalization work offline', () => {
  assert.ok(ime.lookup('nihao').some(item => item.text === '你好'));
  assert.ok(ime.lookup('zhongguo').some(item => item.text === '中国'));
  assert.ok(ime.lookup('dianying').some(item => item.text === '电影'));
  assert.ok(ime.lookup('nv').some(item => item.text === '女'));
  assert.equal(ime.normalize("LÜ ' se"), 'lvse');
  assert.equal(ime.lookup('ni')[0].text, '你');
});
test('unlisted sentences can commit a word prefix and leave the rest composing', () => {
  const candidate = ime.lookup('nihaomawoxiang').find(item => item.text === '你好');
  assert.ok(candidate); assert.equal(candidate.consumed, 5);
  assert.equal('nihaomawoxiang'.slice(candidate.consumed), 'mawoxiang');
  assert.equal(ime.lookup('constructor').length, 0);
  assert.equal(ime.lookup('123').length, 0);
});
