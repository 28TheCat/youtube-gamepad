// Repack existing CC-CEDICT data without changing entries or attribution.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const path = new URL('../src/search/pinyin-data.js', import.meta.url);
const source = readFileSync(path, 'utf8'), window = {};
runInNewContext(source, { window });
const dictionary = window.YTGamepadPinyinData;
const groups = {};
for (const key of Object.keys(dictionary).sort()) (groups[key[0]] ||= {})[key] = dictionary[key];
const packed = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, JSON.stringify(value)]));
writeFileSync(path, source.split('// Decode')[0] + `// Decode only the initial-letter shard requested by Chinese input.
(() => {
  const packed = ${JSON.stringify(packed)};
  const shards = Object.create(null), indexes = Object.create(null);
  function shard(letter) {
    if (!Object.hasOwn(shards, letter)) {
      shards[letter] = Object.hasOwn(packed, letter) ? JSON.parse(packed[letter]) : {};
      delete packed[letter];
      indexes[letter] = Object.keys(shards[letter]);
    }
    return shards[letter];
  }
  const dictionary = new Proxy(Object.create(null), {
    get(_, key) { return typeof key === 'string' ? shard(key[0])[key] : undefined; },
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
  window.YTGamepadPinyinData = dictionary;
  window.YTGamepadPinyinKeys = letter => { shard(letter); return indexes[letter]; };
})();
`);
