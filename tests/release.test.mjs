import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { releaseFiles } from '../scripts/release-files.mjs';
import { checkRelease } from '../scripts/check-release.mjs';
import { assertLoadOrder } from '../scripts/module-graph.mjs';

function fixture(t) {
  const parent = resolve(tmpdir()), root = mkdtempSync(resolve(parent, 'ytg-release-test-'));
  t.after(() => {
    if (dirname(root) !== parent || !basename(root).startsWith('ytg-release-test-')) throw new Error('Unexpected fixture directory');
    rmSync(root, { recursive: true });
    rmSync(root + '.inventory.json', { force: true });
  });
  const manifest = { manifest_version: 3, version: '0.2.0', background: { service_worker: 'src/background/background.ts' },
    action: { default_popup: 'src/popup/popup.html' }, content_scripts: [{ js: ['src/shared/actions.ts', 'src/input/bindings.ts', 'src/shared/runtime.ts', 'src/ui/styles.ts', 'src/input/controller-style.ts', 'src/input/gamepad.ts'], css: ['src/app/browse.css'] }] };
  function write(file, content = '') { const path = resolve(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  write('manifest.json', JSON.stringify(manifest)); write('src/popup/popup.html', '<link href="popup.css"><script src="popup.js"></script><script src="../shared/actions.ts"></script>');
  for (const file of ['src/shared/actions.ts', 'src/input/bindings.ts', 'src/shared/runtime.ts', 'src/ui/styles.ts', 'src/input/controller-style.ts', 'src/input/gamepad.ts', 'src/background/background.ts', 'src/popup/popup.js', 'src/popup/popup.css', 'src/app/browse.css',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/material-icons-LICENSE.txt', 'licenses/kenney-input-prompts-LICENSE.txt']) write(file);
  const controllerAssets = JSON.parse(readFileSync(new URL('../assets/controller/kenney.json', import.meta.url), 'utf8'));
  write('licenses/vue-LICENSE.txt', readFileSync(new URL('../licenses/vue-LICENSE.txt', import.meta.url)));
  write('licenses/pinia-LICENSE.txt', readFileSync(new URL('../licenses/pinia-LICENSE.txt', import.meta.url)));
  write('assets/controller/kenney.json', JSON.stringify(controllerAssets));
  const controllerFont = JSON.parse(readFileSync(new URL('../assets/controller/controller-font/prompts.json', import.meta.url), 'utf8'));
  for (const file of ['assets/controller/controller-font/prompts.json', 'assets/controller/controller-font/upstream-revision.txt',
    'assets/controller/controller-font/keymap_keyboard.ttf', 'assets/controller/controller-font/FREEWARE.txt',
    'licenses/controller-font-FREEWARE.txt', ...Object.keys(controllerFont.files)]) {
    write(file, readFileSync(new URL('../' + file, import.meta.url)));
  }
  for (const file of Object.keys(controllerAssets.files)) write(file, readFileSync(new URL('../' + file, import.meta.url)));
  write('assets/controller/layout.svg', readFileSync(new URL('../assets/controller/layout.svg', import.meta.url)));
  const { files } = releaseFiles(root);
  const inventory = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
  writeFileSync(root + '.inventory.json', JSON.stringify({ version: manifest.version, files: inventory }));
  return { root, write, manifest, files };
}

test('release inventory detects changed scripts and rejects unlisted debug data', t => {
  const s = fixture(t); assert.equal(checkRelease(s.root), s.files.length);
  assert.equal(s.files.includes('LICENSE'), true);
  s.write('src/input/gamepad.ts', 'throw new Error("tampered");'); assert.throws(() => checkRelease(s.root), /Changed release file/);
  s.write('src/input/gamepad.ts'); s.write('output/captured-data.txt', 'private debug data');
  assert.throws(() => checkRelease(s.root), /inventory mismatch/);
  assert.equal(releaseFiles(s.root).files.includes('output/captured-data.txt'), false);
});

test('release rejects missing dependencies and paths outside the package', t => {
  const s = fixture(t);
  s.manifest.content_scripts[0].css = ['../outside.css']; s.write('manifest.json', JSON.stringify(s.manifest));
  assert.throws(() => releaseFiles(s.root), /Unsafe release path/);
  assert.throws(() => assertLoadOrder(['src/input/gamepad.ts', 'src/shared/runtime.ts']), /requires src\/shared\/runtime/);
  assert.throws(() => assertLoadOrder(['src/shared/runtime.ts', 'src/shared/runtime.ts']), /Duplicate module/);
});

test('nested extension pages resolve sibling assets and reject external or escaping paths', t => {
  const s = fixture(t);
  assert.equal(s.files.includes('src/popup/popup.css'), true);
  assert.equal(s.files.includes('src/shared/actions.ts'), true);
  for (const path of ['../../../outside.js', '/outside.js', 'https://example.com/script.js']) {
    s.write('src/popup/popup.html', `<script src="${path}"></script>`);
    assert.throws(() => releaseFiles(s.root), /Unsafe release path/);
  }
});
