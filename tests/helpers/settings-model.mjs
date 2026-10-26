import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript-vue';

// Exercise the production TS model without duplicating it in a VM fixture.
async function moduleURL(path) {
  let { outputText } = transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
  });
  for (const match of [...outputText.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const name = match[1];
    const resolved = name.startsWith('.') ? await moduleURL(new URL(`${name}.ts`, path)) : import.meta.resolve(name);
    outputText = outputText.replace(match[0], `from '${resolved}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
export async function importSettingsModel(file) {
  return import(await moduleURL(new URL(`../../${file}`, import.meta.url)));
}
