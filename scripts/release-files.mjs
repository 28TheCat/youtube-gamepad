import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, posix } from 'node:path';
import { entries } from './extension-entries.mjs';
import { controllerAssets as loadControllerAssets } from './controller-assets.mjs';
export function safePath(root, file) {
  if (!file || file.includes('\\') || isAbsolute(file) || file.split('/').some(part => !part || part === '..' || part === '.')) {
    throw new Error(`Unsafe release path: ${file}`);
  }
  const target = resolve(root, file), rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path leaves release root: ${file}`);
  // Check every component so a directory symlink cannot introduce external data.
  let cursor = target;
  while (cursor !== root) {
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink in release path: ${file}`);
    cursor = dirname(cursor);
  }
  return target;
}
export function releaseFiles(root, { source = false } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
  for (const entry of manifest.content_scripts) {
    if (entry.js.length !== 1 || !Object.hasOwn(entries, entry.js[0])) {
      throw new Error('Expected one registered bundle per content world');
    }
    if (new Set(entry.css || []).size !== (entry.css || []).length) throw new Error('Duplicate manifest stylesheet.');
  }
  const pages = [manifest.action.default_popup, manifest.options_ui?.page].filter(Boolean);
  const assets = pages.flatMap(page => {
    const html = readFileSync(safePath(root, page), 'utf8');
    return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => match[1]).filter(path => !path.startsWith('#'))
      .map(path => {
        if (path.includes('\\') || posix.isAbsolute(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) {
          throw new Error(`Unsafe release path: ${path}`);
        }
        return posix.normalize(posix.join(posix.dirname(page), path));
      });
  });
  const controllerManifest = 'assets/controller/kenney.json';
  const controllerAssets = loadControllerAssets(root);
  const files = [...new Set(['manifest.json', manifest.background.service_worker, ...pages, ...assets,
    ...Object.values(manifest.icons || {}),
    ...manifest.content_scripts.flatMap(entry => [...entry.js, ...(entry.css || [])]),
    controllerManifest, 'assets/controller/template.json', 'licenses/nicefrog-gamepad-LICENSE.txt', ...Object.keys(controllerAssets.files),
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/material-icons-LICENSE.txt', 'licenses/kenney-input-prompts-LICENSE.txt',
    'licenses/vue-LICENSE.txt', 'licenses/pinia-LICENSE.txt', 'licenses/mingcute-LICENSE.txt',
    'licenses/youtubei-LICENSE.txt', 'licenses/fflate-LICENSE.txt', 'licenses/meriyah-LICENSE.txt',
    'licenses/protobuf-LICENSE.txt', 'licenses/protobuf-BSD-LICENSE.txt'])].sort();
  for (const file of files) {
    if (source && file in entries) {
      if (!lstatSync(safePath(root, entries[file])).isFile()) throw new Error(`Missing entry: ${entries[file]}`);
      continue;
    }
    if (!lstatSync(safePath(root, file)).isFile()) throw new Error(`Not a release file: ${file}`);
  }
  return { files, version: manifest.version };
}
