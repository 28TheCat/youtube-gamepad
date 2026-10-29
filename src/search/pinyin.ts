import type { Pinyin, PinyinCandidate } from '../../types/ports';

import { readLocalStorage, writeLocalStorage } from './local-storage';
import { YTGamepadPinyinData, YTGamepadPinyinKeys } from './pinyin-data.ts';
export let YTGamepadPinyin!: Pinyin;
(() => {
  if (YTGamepadPinyin) return;
    let dictionary: Record<string,string[]>, keys: string[];
  const lookupCache: Map<string,PinyinCandidate[]> = new Map(), wordCache: Map<string,string[]> = new Map();
  function cache<T>(map: Map<string,T[]>, key: string, value: T[], limit: number) {
    if (map.size >= limit) map.delete(map.keys().next().value!);
    map.set(key, value);
    return value;
  }
  // Prefer familiar characters where a dictionary has no usage frequencies.
  const common: Record<string,string> = { ni: '你', hao: '好', wo: '我', shi: '是', de: '的', ma: '吗', men: '们', zai: '在', le: '了', bu: '不', zhong: '中', guo: '国', ren: '人', yi: '一', you: '有', ta: '他', kan: '看', yin: '音', yue: '乐', dian: '电', ying: '影', nv: '女', lv: '绿' };
  // Rankings are page-owned, untrusted hints. Accept only dictionary entries
  // with bounded integer scores, never arbitrary object/prototype properties.
  const learned: Record<string,number> = Object.create(null);
  const validCandidate = (key: unknown, text: unknown) => typeof key === 'string' && key.length <= 48
    && /^[a-z]+$/.test(key)
    && typeof text === 'string' && text.length <= 64
    && Object.hasOwn(dictionary, key) && dictionary[key].includes(text);
  function initialize() {
    if (dictionary) return;
    dictionary = YTGamepadPinyinData;
    try {
    const raw = readLocalStorage('ytg-pinyin-ranking');
    if (raw && raw.length <= 131072) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, score] of Object.entries(parsed).slice(0, 500)) {
          const split = id.indexOf(':');
          if (split > 0 && validCandidate(id.slice(0, split), id.slice(split + 1))
            && typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 100) learned[id] = score;
        }
      }
    }
    } catch (_) {}
  }
  function lowerBound(value: string) {
    let low = 0, high: number = keys.length;
    while (low < high) { const middle = (low + high) >>> 1; if (keys[middle] < value) low = middle + 1; else high = middle; }
    return low;
  }
  const normalize = (value: string) => value.toLowerCase().replace(/u:|ü/g, 'v').replace(/['\s]/g, '');
  YTGamepadPinyin = {
    normalize,
    lookup(value) {
      const input = normalize(value);
      if (!input || !/^[a-z]+$/.test(input)) return [];
      initialize();
      if (lookupCache.has(input)) return lookupCache.get(input)!.map((item) => ({ ...item }));
      keys = YTGamepadPinyinKeys?.(input[0]) || Object.keys(dictionary).sort();
      const results: PinyinCandidate[] = [], seen = new Set();
      const add = (key: string, consumed: number) => {
        const words = wordCache.get(key) || cache(wordCache, key, [...dictionary[key]].sort((a, b) => {
          const score = (word: string) => (Number(learned[key + ':' + word]) || 0) * 100 + (common[key] === word ? 50 : 0);
          return score(b) - score(a);
        }), 64);
        for (const word of words) if (!seen.has(word)) { seen.add(word); results.push({ text: word, consumed, key }); }
      };
      if (Object.hasOwn(dictionary, input)) add(input, input.length);
      // Partial syllables can show word completions without network requests.
      if (input.length >= 2) {
        for (let i = lowerBound(input), count = 0; i < keys.length && keys[i].startsWith(input) && count < 24; i++, count++) {
          if (keys[i] !== input) add(keys[i], input.length);
        }
      }
      // A long sentence can be committed one word at a time.
      for (let size = input.length - 1; size > 0; size--) {
        const prefix = input.slice(0, size);
        if (Object.hasOwn(dictionary, prefix)) { add(prefix, size); break; }
      }
      cache(lookupCache, input, results, 32);
      return results.map(item => ({ ...item }));
    },
    learn(candidate) {
      if (!candidate) return;
      initialize();
      if (!candidate || !validCandidate(candidate.key, candidate.text)) return;
      const key = candidate.key + ':' + candidate.text;
      learned[key] = Math.min(100, (Number(learned[key]) || 0) + 1);
      wordCache.delete(candidate.key);
      lookupCache.clear();
      if (Object.keys(learned).length > 500) delete learned[Object.keys(learned)[0]];
      writeLocalStorage('ytg-pinyin-ranking', JSON.stringify(learned));
    }
  };
})();
