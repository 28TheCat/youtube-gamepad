import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { assertLoadOrder } from './module-graph.mjs';
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
export function releaseFiles(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
  for (const entry of manifest.content_scripts) {
    assertLoadOrder(entry.js);
    if (new Set(entry.css || []).size !== (entry.css || []).length) throw new Error('Duplicate manifest stylesheet.');
  }
  const pages = [manifest.action.default_popup, manifest.options_ui?.page].filter(Boolean);
  const assets = pages.flatMap(page => {
    const html = readFileSync(safePath(root, page), 'utf8');
    return [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]).filter(path => !path.startsWith('#'));
  });
  const files = [...new Set(['manifest.json', manifest.background.service_worker, ...pages, ...assets,
    ...manifest.content_scripts.flatMap(entry => [...entry.js, ...(entry.css || [])]),
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/material-icons-LICENSE.txt'])].sort();
  for (const file of files) {
    if (!lstatSync(safePath(root, file)).isFile()) throw new Error(`Not a release file: ${file}`);
  }
  return { files, version: manifest.version };
}
