import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { releaseFiles } from '../scripts/release-files.mjs';
import { checkRelease } from '../scripts/check-release.mjs';
import { entries } from '../scripts/extension-entries.mjs';

function fixture(t) {
  const parent = resolve(tmpdir()), root = mkdtempSync(resolve(parent, 'ytg-release-test-'));
  t.after(() => {
    if (dirname(root) !== parent || !basename(root).startsWith('ytg-release-test-')) throw new Error('Unexpected fixture directory');
    rmSync(root, { recursive: true });
    rmSync(root + '.inventory.json', { force: true });
  });
  const manifest = { manifest_version: 3, version: '0.2.0', background: { service_worker: 'bundles/background.js' },
    action: { default_popup: 'src/popup/popup.html' }, content_scripts: [
      { world: 'MAIN', js: ['bundles/main.js'], css: ['src/app/browse.css'] },
      { world: 'ISOLATED', js: ['bundles/content.js'] }
    ] };
  function write(file, content = '') { const path = resolve(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  write('manifest.json', JSON.stringify(manifest)); write('src/popup/popup.html', '<link href="popup.css"><script src="../../bundles/popup.js"></script>');
  for (const file of ['bundles/main.js', 'bundles/content.js', 'bundles/background.js', 'bundles/popup.js', 'src/popup/popup.css', 'src/app/browse.css',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/material-icons-LICENSE.txt', 'licenses/kenney-input-prompts-LICENSE.txt']) write(file);
  const controllerAssets = JSON.parse(readFileSync(new URL('../assets/controller/kenney.json', import.meta.url), 'utf8'));
  write('licenses/mingcute-LICENSE.txt', readFileSync(new URL('../licenses/mingcute-LICENSE.txt', import.meta.url)));
  write('licenses/vue-LICENSE.txt', readFileSync(new URL('../licenses/vue-LICENSE.txt', import.meta.url)));
  write('licenses/pinia-LICENSE.txt', readFileSync(new URL('../licenses/pinia-LICENSE.txt', import.meta.url)));
  for (const name of ['youtubei', 'fflate', 'meriyah', 'protobuf', 'protobuf-BSD']) {
    write(`licenses/${name}-LICENSE.txt`, readFileSync(new URL(`../licenses/${name}-LICENSE.txt`, import.meta.url)));
  }
  write('assets/controller/kenney.json', JSON.stringify(controllerAssets));
  for (const file of Object.keys(controllerAssets.files)) write(file, readFileSync(new URL('../' + file, import.meta.url)));
  write('assets/controller/layout.svg', readFileSync(new URL('../assets/controller/layout.svg', import.meta.url)));
  write('assets/controller/template.json', readFileSync(new URL('../assets/controller/template.json', import.meta.url)));
  write('licenses/nicefrog-gamepad-LICENSE.txt', readFileSync(new URL('../licenses/nicefrog-gamepad-LICENSE.txt', import.meta.url)));
  const { files } = releaseFiles(root);
  const inventory = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
  writeFileSync(root + '.inventory.json', JSON.stringify({ version: manifest.version, files: inventory }));
  return { root, write, manifest, files };
}

test('release inventory detects changed scripts and rejects unlisted debug data', t => {
  const s = fixture(t); assert.equal(checkRelease(s.root), s.files.length);
  assert.equal(s.files.includes('LICENSE'), true);
  s.write('bundles/main.js', 'throw new Error("tampered");'); assert.throws(() => checkRelease(s.root), /Changed release file/);
  s.write('bundles/main.js'); s.write('output/captured-data.txt', 'private debug data');
  assert.throws(() => checkRelease(s.root), /inventory mismatch/);
  assert.equal(releaseFiles(s.root).files.includes('output/captured-data.txt'), false);
});

test('release rejects paths outside the package', t => {
  const s = fixture(t);
  s.manifest.content_scripts[0].css = ['../outside.css']; s.write('manifest.json', JSON.stringify(s.manifest));
  assert.throws(() => releaseFiles(s.root), /Unsafe release path/);
});

test('release requires one registered bundle per content world in source and built packages', t => {
  const s = fixture(t);
  for (const file of ['bundles/main.js', 'bundles/content.js', 'bundles/background.js', 'bundles/popup.js']) s.write(entries[file]);
  assert.deepEqual(releaseFiles(s.root, { source: true }).files, s.files);
  for (const js of [[], ['bundles/main.js', 'bundles/content.js'], ['bundles/main.js', 'bundles/main.js'],
    ['src/shared/runtime.ts'], ['src/shared/actions.ts', 'src/input/bindings.ts'], ['bundles/unknown.js'], ['toString']]) {
    s.manifest.content_scripts[0].js = js;
    s.write('manifest.json', JSON.stringify(s.manifest));
    for (const source of [false, true]) {
      assert.throws(() => releaseFiles(s.root, { source }), /Expected one registered bundle per content world/);
    }
  }
});

test('release rejects missing bundles and source entries', t => {
  const s = fixture(t);
  rmSync(resolve(s.root, 'bundles/main.js'));
  assert.throws(() => releaseFiles(s.root), /ENOENT/);
  assert.throws(() => releaseFiles(s.root, { source: true }), /ENOENT/);
});

test('nested extension pages resolve sibling assets and reject external or escaping paths', t => {
  const s = fixture(t);
  assert.equal(s.files.includes('src/popup/popup.css'), true);
  assert.equal(s.files.includes('bundles/popup.js'), true);
  for (const path of ['../../../outside.js', '/outside.js', 'https://example.com/script.js']) {
    s.write('src/popup/popup.html', `<script src="${path}"></script>`);
    assert.throws(() => releaseFiles(s.root), /Unsafe release path/);
  }
});
