import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const compiled = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
  target: 'es2022', lib: { entry: fileURLToPath(new URL('../src/sites/youtube-search.ts', import.meta.url)),
    formats: ['iife'], name: 'ParserFixture' } } });
const sandbox = { URL, console };
vm.runInNewContext((Array.isArray(compiled) ? compiled[0] : compiled).output.find(item => item.type === 'chunk').code, sandbox);
const { parseYouTubeJsBrowse } = sandbox.ParserFixture;
const video = id => ({ videoRenderer: { videoId: id, title: { simpleText: id },
  thumbnail: { thumbnails: [] }, navigationEndpoint: { watchEndpoint: { videoId: id } } } });

test('API cards preserve order and exclude unavailable entries through library parsing', () => {
  const unavailable = { playlistVideoRenderer: { ...video('unavailable').videoRenderer, isPlayable: false } };
  const result = parseYouTubeJsBrowse({ contents: [video('one'), unavailable, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:two']);
});

test('movie cards missing optional overlays use the library parser without modifying API data', () => {
  const movie = { movieRenderer: { videoId: 'legacy', title: { simpleText: 'Legacy' } } };
  Object.freeze(movie.movieRenderer);
  const result = parseYouTubeJsBrowse({ contents: [video('one'), movie, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:legacy', 'video:two']);
  assert.equal(result.items[1].title, 'Legacy');
  assert.equal(movie.movieRenderer.thumbnailOverlays, undefined);
});

test('malformed cards cannot remove adjacent valid results', () => {
  const result = parseYouTubeJsBrowse({ contents: [video('one'), { movieRenderer: null }, video('two')] });
  assert.deepEqual(Array.from(result.items, item => item.id), ['video:one', 'video:two']);
});
