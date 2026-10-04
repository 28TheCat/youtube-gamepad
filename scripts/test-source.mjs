import { readFileSync } from 'node:fs';
import { dependencies } from './module-graph.mjs';
// Load the same prerequisites as the extension. VM test doubles still supply
// only the collaborators the original scenario uses.
export function moduleSource(file) {
  const seen = new Set(), files = [];
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dependency of dependencies[name] || []) visit(dependency);
    files.push(name);
  }
  visit(file);
  return files.map(name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')).join('\n');
}
