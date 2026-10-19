import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { moduleSource } from '../scripts/test-source.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { styleSource } from '../scripts/build-styles.mjs';
import { controllerAssets } from '../scripts/controller-assets.mjs';
import { fileURLToPath } from 'node:url';

function setup() {
  const window = {}, document = { documentElement: { dataset: {} }, createElement: node };
  runInNewContext(moduleSource('src/input/controller-style.ts'), { window, document });
  return { window, document, style: window.YTGamepadControllerStyle };
}
const node = () => ({ attributes: {}, children: [], text: '',
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; },
  set textContent(value) { this.children = []; this.text = value; },
  replaceChildren(...children) { this.children = children; this.text = ''; },
  setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; }
});

test('controller families recognize names and vendor IDs with generic fallback', () => {
  const { style } = setup();
  for (const [id, family] of [['Xbox 360 Controller', 'xbox'], ['XInput STANDARD GAMEPAD', 'xbox'],
    ['Vendor: 045e Product: 02ea', 'xbox'], ['DualShock 4', 'playstation'], ['DualSense Wireless Controller', 'playstation'],
    ['Wireless Controller (Vendor: 054c Product: 09cc)', 'playstation'], ['Switch Pro Controller', 'switch'],
    ['Joy-Con (L+R)', 'switch'], ['Vendor: 057e Product: 2009', 'switch'], ['8BitDo Unknown', 'generic']]) {
    assert.equal(style.identify(id), family, id);
  }
});

test('labels preserve standard button positions and update open UI without replacing controls', () => {
  const { style } = setup();
  const badge = style.badge(node(), 'A'), text = style.bind(node(), 'A 输入 · X 删除 · Y 空格 · B 返回 · LB / RB · LT / RT · Start');
  const control = style.bind(node(), 'X 删除', 'title'); control.textContent = '删除';
  const aria = style.bind(node(), 'A 开始，B 返回', 'aria-label');
  const unregister = style.register({ querySelectorAll: () => [badge, text, control, aria] });
  style.use({ id: 'DualSense' });
  assert.equal(badge.textContent, '×');
  assert.equal(text.textContent, '× 输入 · □ 删除 · △ 空格 · ○ 返回 · L1 / R1 · L2 / R2 · Options');
  assert.equal(control.getAttribute('title'), '□ 删除'); assert.equal(control.textContent, '删除');
  assert.equal(aria.getAttribute('aria-label'), '× 开始，○ 返回');
  style.use({ id: 'Switch Pro Controller' });
  assert.equal(badge.textContent, 'B');
  assert.equal(text.textContent, 'B 输入 · Y 删除 · X 空格 · A 返回 · L / R · ZL / ZR · +');
  unregister(); style.use({ id: 'Xbox' }); assert.equal(badge.textContent, 'B');
});

test('runtime disposal clears controller globals and can reinject cleanly', () => {
  const { window, document } = setup();
  window.YTGamepadRuntime.destroy();
  assert.equal(window.YTGamepadControllerStyle, undefined);
  assert.equal(document.documentElement.dataset.ytgController, undefined);
  runInNewContext(moduleSource('src/input/controller-style.ts'), { window, document });
  assert.equal(window.YTGamepadControllerStyle.family, 'generic');
});

test('inline instructions safely reuse artwork, update controller labels and preserve other text', () => {
  const { style } = setup();
  const label = style.hint(node(), '<img src=x> A 确认 · B 返回 · Start 菜单');
  const root = { querySelectorAll: () => [label] }; style.register(root);
  assert.equal(label.textContent, '<img src=x> A 确认 · B 返回 · Start 菜单');
  assert.equal(label.children.filter(child => child.getAttribute('data-ytg-icon') === 'true').length, 3);
  style.use({ id: 'DualSense' });
  assert.equal(label.textContent, '<img src=x> × 确认 · ○ 返回 · Options 菜单');
  assert.equal(label.getAttribute('aria-label'), label.textContent);
  style.use({ id: 'Switch Pro Controller' });
  assert.equal(label.textContent, '<img src=x> B 确认 · A 返回 · + 菜单');
});

test('button artwork is original third-party SVG data with preserved source and license', () => {
  const assets = JSON.parse(readFileSync(new URL('../assets/controller/kenney.json', import.meta.url), 'utf8'));
  assert.equal(assets.author, 'Kenney'); assert.equal(assets.license, 'CC0-1.0');
  const generated = styleSource();
  for (const [path, record] of Object.entries(assets.files)) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, path);
    assert.match(record.source, /\/Vector\/.*\.svg$/);
  }
  assert.match(readFileSync(new URL('../licenses/kenney-input-prompts-LICENSE.txt', import.meta.url), 'utf8'), /Creative Commons Zero, CC0/);
  assert.equal(assets.profiles.switch.A, 'assets/controller/switch_button_b.svg');
  assert.equal(assets.profiles.playstation.A, 'assets/controller/playstation_button_color_cross.svg');
  const active = controllerAssets(fileURLToPath(new URL('..', import.meta.url)));
  for (const path of new Set(Object.values(active.profiles).flatMap(keys => Object.values(keys)))) {
    const bytes = readFileSync(new URL('../' + path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), active.files[path].sha256);
    assert.ok(generated.includes(bytes.toString('base64')), path);
  }
  assert.equal(active.profiles.xbox.A, assets.profiles.xbox.A);
  assert.equal(active.profiles.playstation.A, assets.profiles.playstation.A);
  assert.equal(active.profiles.generic.A, active.profiles.xbox.A);
  assert.equal(active.profiles.switch.A, assets.profiles.switch.A);
  const template = JSON.parse(readFileSync(new URL('../assets/controller/template.json', import.meta.url), 'utf8'));
  assert.equal(template.author, 'nicefrog');
  assert.equal(template.license, 'CC0-1.0');
  assert.equal(createHash('sha256').update(readFileSync(new URL('../assets/controller/layout.svg', import.meta.url))).digest('hex'), template.files['assets/controller/layout.svg'].sha256);
});

test('remapped prompts update text, physical artwork keys and controller labels', () => {
  const { style } = setup();
  const badge = style.badge(node(), 'A'), hint = style.hint(node(), 'A 确认 · B 返回');
  style.register({ querySelectorAll: () => [badge, hint] });
  style.configureBindings({ confirm: 1, back: 0 });
  assert.equal(badge.textContent, 'B');
  assert.equal(badge.getAttribute('data-ytg-first-key'), 'B');
  assert.equal(hint.textContent, 'B 确认 · A 返回');
  style.use({ id: 'DualSense' });
  assert.equal(badge.textContent, '○');
  assert.equal(hint.textContent, '○ 确认 · × 返回');
});


test('right-hand navigation hints update visible text and accessible labels', () => {
  const { style, document } = setup();
  document.documentElement.dataset.ytgNavigationStick = 'right';
  const hint = style.hint(node(), 'D-pad / left stick: Select · A: Open');
  assert.match(hint.textContent, /right stick/);
  assert.match(hint.getAttribute('aria-label'), /right stick/);
  document.documentElement.dataset.ytgNavigationStick = 'left';
  style.hint(hint, 'D-pad / left stick: Select · A: Open');
  assert.match(hint.textContent, /left stick/);
});

test('keyboard prompts follow actions even when gamepad buttons are remapped', () => {
  const { document, style } = setup();
  style.configureBindings({ confirm: 1, back: 0 });
  document.documentElement.dataset.ytgInputMode = 'keyboard';
  assert.equal(style.format('A confirm · B back · X pause · Y search · Start menu'), 'Enter confirm · Esc back · Space pause · / search · F1 menu');
  const badge = style.badge(node(), 'A');
  assert.equal(badge.textContent, 'Enter');
  assert.equal(badge.getAttribute('data-ytg-icon'), 'false');
  document.documentElement.dataset.ytgInputMode = 'gamepad';
  style.use({ id: 'DualSense' });
  assert.equal(style.format('A confirm'), '○ confirm');
});
