// Repack existing CC-CEDICT data without changing entries or attribution.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { legacyModuleSource } from './test-source.mjs';
const path = new URL('../src/search/pinyin-data.ts', import.meta.url);
const source = readFileSync(path, 'utf8'), window = {};
runInNewContext(legacyModuleSource('src/search/pinyin-data.ts'), { window });
const dictionary = window.YTGamepadPinyinData;
const groups = {};
for (const key of Object.keys(dictionary).sort()) (groups[key[0]] ||= {})[key] = dictionary[key];
const packed = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, JSON.stringify(value)]));
writeFileSync(path, source.split('// Decode')[0] + `// Decode only the initial-letter shard requested by Chinese input.
(() => {
  const packed: Record<string,string> = ${JSON.stringify(packed)};
  const shards: Record<string,Record<string,string[]>> = Object.create(null), indexes: Record<string,string[]> = Object.create(null);
  function shard(letter: string) {
    if (!Object.hasOwn(shards, letter)) {
      shards[letter] = Object.hasOwn(packed, letter) ? JSON.parse(packed[letter]) : {};
      delete packed[letter];
      indexes[letter] = Object.keys(shards[letter]);
    }
    return shards[letter];
  }
  const dictionary = new Proxy(Object.create(null), {
    get(_, key) { if (typeof key !== 'string') return undefined; const data = shard(key[0]); return Object.hasOwn(data, key) ? data[key] : undefined; },
    getOwnPropertyDescriptor(_, key) {
      if (typeof key !== 'string') return undefined;
      const data = shard(key[0]);
      return Object.hasOwn(data, key) ? { value: data[key], enumerable: true, configurable: true } : undefined;
    },
    ownKeys() {
      for (const letter of Object.keys(packed)) shard(letter);
      return Object.values(indexes).flat().sort();
    }
  });
  YTGamepadPinyinData = dictionary;
  YTGamepadPinyinKeys = (letter: string) => { shard(letter); return indexes[letter]; };
})();
`);
