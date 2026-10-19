import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript-vue';
const source = ts.transpileModule(readFileSync(new URL('../src/ui/ui-api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function fixture() { const exports = {}; vm.runInNewContext(source, { exports }); return exports.createUiApi(); }

test('local UI commands reject unavailable and invalid operations without mutating owners', async () => {
  const ui = fixture();
  assert.equal(await ui.setTheme('dark'), false);
  assert.equal(await ui.setLayout('wide'), false);
  assert.equal(ui.focus('missing'), false);
  assert.equal(ui.openPanel('account'), false);
  assert.equal(ui.closePanel(), false);
  let writes = 0;
  ui.registerTheme({ read: () => 'light', write() { writes++; } });
  ui.registerLayout({ read: () => 'page', write() { writes++; } });
  assert.equal(await ui.setTheme('arbitrary'), false);
  assert.equal(await ui.setLayout('arbitrary'), false);
  assert.equal(writes, 0);
});

test('settings writes remain ordered and report failures without inventing state', async () => {
  const ui = fixture(), calls = [];
  let theme = 'light', release;
  const gate = new Promise(resolve => { release = resolve; });
  ui.registerTheme({ read: () => theme, async write(value) { calls.push(value); if (value === 'dark') await gate; theme = value; } });
  const dark = ui.setTheme('dark'), light = ui.setTheme('light');
  await Promise.resolve(); assert.deepEqual(calls, ['dark']); assert.equal(ui.state.theme, 'light');
  release(); assert.equal(await dark, true); assert.equal(await light, true);
  assert.deepEqual(calls, ['dark', 'light']); assert.equal(ui.state.theme, 'light');
  ui.registerLayout({ read: () => 'page', async write() { throw Error('Storage unavailable'); } });
  assert.equal(await ui.setLayout('wide'), false); assert.equal(ui.state.layout, 'page');
});

test('releasing an older registration cannot erase its replacement or run queued stale writes', async () => {
  const ui = fixture(), calls = [];
  const old = ui.registerLayout({ read: () => 'normal', write() { calls.push('old'); } });
  const queued = ui.setLayout('wide');
  const next = ui.registerLayout({ read: () => 'page', write() { calls.push('next'); } });
  old(); assert.equal(await queued, false);
  assert.equal(await ui.setLayout('wide'), true); assert.deepEqual(calls, ['next']);
  next(); assert.equal(ui.state.layout, undefined);
  assert.equal(await ui.setLayout('normal'), false);
});

test('focus commands only reach current registered owners and recover after teardown', () => {
  const ui = fixture(), calls = [];
  const first = ui.registerFocus('search', () => { calls.push('first'); return true; });
  const second = ui.registerFocus('search', () => { calls.push('second'); return true; });
  first(); assert.equal(ui.focus('search'), true); assert.deepEqual(calls, ['second']);
  second(); assert.equal(ui.focus('search'), false);
  ui.registerFocus('broken', () => { throw Error('Removed target'); });
  assert.equal(ui.focus('broken'), false);
});

test('panel state comes from owners and closing unwinds the highest active layer', () => {
  const ui = fixture(); let comments = true, account = false, search = false;
  // Registration order deliberately differs from visual layer order.
  ui.registerPanel('search', { isOpen: () => search, open() { search = true; }, close() { search = false; } });
  ui.registerPanel('account', { isOpen: () => account, open() { account = true; }, close() { account = false; } });
  ui.registerPanel('comments', { isOpen: () => comments, open() { comments = true; }, close() { comments = false; } });
  assert.equal(ui.openPanel('account'), true);
  search = true; // Existing keyboard policy may open a panel independently.
  assert.equal(ui.state.openPanels.join(','), 'comments,account,search');
  assert.equal(ui.closePanel(), true); assert.equal(search, false); assert.equal(comments, true);
  assert.equal(ui.closePanel(), true); assert.equal(account, false);
  assert.equal(ui.closePanel(), true); assert.equal(comments, false);
  assert.equal(ui.closePanel(), false);
});

test('destroy invalidates pending acknowledgements and all later commands', async () => {
  const ui = fixture(); let release;
  ui.registerTheme({ read: () => 'light', write: () => new Promise(resolve => { release = resolve; }) });
  const pending = ui.setTheme('dark'); await Promise.resolve();
  ui.destroy(); release(); assert.equal(await pending, false);
  ui.registerFocus('late', () => true);
  assert.equal(ui.focus('late'), false); assert.equal(await ui.setTheme('dark'), false);
  assert.equal(ui.state.theme, undefined);
});
