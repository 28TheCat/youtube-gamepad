import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeImports, resolveModule, moduleGraph } from '../scripts/module-graph.mjs';

test('runtime graph follows emitted imports, reexports and dynamic imports through cycles', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const folder = mkdtempSync(join(root, 'tests/.module-graph-'));
  try {
    writeFileSync(join(folder, 'entry.ts'), `import type { Missing } from './type-only';
import './side-effect'; export { value } from './child';
export const lazy = () => import('./lazy'); import 'external-runtime';`);
    writeFileSync(join(folder, 'side-effect.ts'), 'export {};');
    writeFileSync(join(folder, 'child.ts'), "import './entry'; export const value = 1;");
    writeFileSync(join(folder, 'lazy.ts'), 'export {};');
    const entry = relative(root, join(folder, 'entry.ts')).replaceAll('\\', '/');
    assert.deepEqual(runtimeImports(entry), ['./side-effect', './child', './lazy', 'external-runtime']);
    const graph = moduleGraph([entry]);
    assert.equal(graph.size, 4);
    assert.equal(resolveModule(entry, './child.ts'), entry.replace('entry.ts', 'child.ts'));
    assert.equal(resolveModule(entry, 'external-runtime'), undefined);
    assert.throws(() => resolveModule(entry, './missing'), /Missing module/);
  } finally {
    assert.equal(dirname(folder), join(root, 'tests'));
    rmSync(folder, { recursive: true, force: true });
  }
});
