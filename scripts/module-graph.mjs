import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript-vue';

const root = new URL('../', import.meta.url);
const cache = new Map();

// Read emitted JavaScript so type-only imports never become runtime edges.
export function runtimeImports(file) {
  if (cache.has(file)) return cache.get(file);
  const source = readFileSync(new URL(file, root), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText;
  const ast = ts.createSourceFile(file, output, ts.ScriptTarget.ES2022, true);
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]))
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  cache.set(file, [...new Set(imports)]);
  return cache.get(file);
}

export function resolveModule(file, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const path = posix.normalize(posix.join(posix.dirname(file), specifier.split(/[?#]/, 1)[0]));
  const resolved = [path, path + '.ts', path + '.vue', path + '/index.ts']
    .find(candidate => existsSync(new URL(candidate, root)));
  if (!resolved) throw new Error(`Missing module ${specifier} in ${file}`);
  return resolved;
}

// Traverse reachable runtime modules; callers choose explicit fixture substitutions.
export function moduleGraph(entries, imports = runtimeImports) {
  const graph = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const edges = imports(file);
    graph.set(file, edges);
    for (const edge of edges) {
      const target = resolveModule(file, edge);
      if (target?.endsWith('.ts')) visit(target);
    }
  }
  for (const entry of entries) visit(entry);
  return graph;
}
