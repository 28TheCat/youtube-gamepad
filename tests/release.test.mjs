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
  const manifest = { manifest_version: 3, version: '0.2.0', background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' }, content_scripts: [{ js: ['actions.js', 'bindings.js', 'runtime.js', 'ui/styles.js', 'controller-style.js', 'gamepad.js'], css: ['browse.css'] }] };
  function write(file, content = '') { const path = resolve(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  write('manifest.json', JSON.stringify(manifest)); write('popup.html', '<link href="popup.css"><script src="popup.js"></script>');
  for (const file of ['actions.js', 'bindings.js', 'runtime.js', 'ui/styles.js', 'controller-style.js', 'gamepad.js', 'background.js', 'popup.js', 'popup.css', 'browse.css',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/material-icons-LICENSE.txt', 'licenses/kenney-input-prompts-LICENSE.txt']) write(file);
  const controllerAssets = JSON.parse(readFileSync(new URL('../assets/controller/kenney.json', import.meta.url), 'utf8'));
  write('assets/controller/kenney.json', JSON.stringify(controllerAssets));
  for (const file of Object.keys(controllerAssets.files)) write(file, readFileSync(new URL('../' + file, import.meta.url)));
  const { files } = releaseFiles(root);
  const inventory = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
  writeFileSync(root + '.inventory.json', JSON.stringify({ version: manifest.version, files: inventory }));
  return { root, write, manifest, files };
}

test('release inventory detects changed scripts and rejects unlisted debug data', t => {
  const s = fixture(t); assert.equal(checkRelease(s.root), s.files.length);
  assert.equal(s.files.includes('LICENSE'), true);
  s.write('gamepad.js', 'throw new Error("tampered");'); assert.throws(() => checkRelease(s.root), /Changed release file/);
  s.write('gamepad.js'); s.write('output/captured-data.txt', 'private debug data');
  assert.throws(() => checkRelease(s.root), /inventory mismatch/);
  assert.equal(releaseFiles(s.root).files.includes('output/captured-data.txt'), false);
});

test('release rejects missing dependencies and paths outside the package', t => {
  const s = fixture(t);
  s.manifest.content_scripts[0].css = ['../outside.css']; s.write('manifest.json', JSON.stringify(s.manifest));
  assert.throws(() => releaseFiles(s.root), /Unsafe release path/);
  assert.throws(() => assertLoadOrder(['gamepad.js', 'runtime.js']), /requires runtime/);
  assert.throws(() => assertLoadOrder(['runtime.js', 'runtime.js']), /Duplicate module/);
});
