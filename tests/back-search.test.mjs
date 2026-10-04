import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup(records = {}) {
  let root, restored = [], region = 'recommendations', origin = 'video-2';
  function node(tag) {
    const handlers = {};
    return {
      tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, value: '',
      isConnected: true, selectionStart: 0, selectionEnd: 0,
      style: { setProperty(name, value) { this[name] = value; } },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { handlers[name] = fn; },
      fire(name, event) { handlers[name]?.(event); },
      focus() { root.activeElement = this; handlers.focus?.(); },
      click() { handlers.click?.(); }, scrollIntoView() {}, dispatchEvent() {},
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.setSelectionRange(start + text.length, start + text.length); },
      querySelectorAll(selector) {
        return this.children.flatMap(child => [
          ...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []), ...child.querySelectorAll(selector)
        ]);
      },
      querySelector(selector) {
        for (const child of this.children) {
          if ('#' + child.id === selector) return child;
          const found = child.querySelector(selector); if (found) return found;
        }
        return null;
      },
      attachShadow() { root = node('shadow'); return root; }
    };
  }
  const nativeSearch = node('input'); nativeSearch.value = 'existing';
  const document = { createElement: node, documentElement: node('html'), body: node('body'), querySelector: () => nativeSearch };
  const actions = [], window = { YTGamepadSite: { perform: () => true }, YTGamepad: { act(action) { actions.push(action); return window.YTGamepadMenu.handle(action); } } };
  const context = { window, document, localStorage: { getItem(key) { return records[key] ?? null; }, setItem(key, value) { records[key] = value; } }, location: { pathname: '/watch', search: '?v=current' }, Event: class {}, HTMLInputElement: class {}, innerWidth: 1200, innerHeight: 800 };
  for (const file of ['app/route-state.js', 'state-machine.js', 'focus.js', 'keyboard.js', 'pinyin-data.js', 'pinyin.js', 'ui/styles.js', 'search.js', 'menu.js']) {
    runInNewContext(moduleSource(file), context);
  }
  window.YTGamepadFocus.register('origin', {
    active: () => true,
    capture: () => ({ region, itemKey: origin, index: 1 }),
    items: () => [{ region, itemKey: 'video-1', index: 0 }, { region, itemKey: origin, index: 1 }],
    fallback: () => ({ region, itemKey: 'default' }),
    apply: target => restored.push(target.itemKey)
  });
  const menu = window.YTGamepadMenu;
  menu.connect({ getSearchTarget: () => nativeSearch, readSearch: target => target?.value || '',
    syncSearch(target, value) { if (target) target.value = value; },
    submitSearch() { return false; }, perform: () => true, dispatchAction: action => window.YTGamepad.act(action) });
  const press = label => root.querySelectorAll('button').find(button => (button.attributes['aria-label'] || button.textContent) === label).click();
  const escape = () => {
    let prevented = 0, stopped = 0;
    root.fire('keydown', { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    assert.equal(prevented, 1); assert.equal(stopped, 1);
  };
  return { menu, window, press, escape, actions, restored, nativeSearch, get root() { return root; }, pageOrigin() { region = 'header'; origin = 'search'; } };
}

test('search history treats page storage as bounded text, never HTML', () => {
  const s = setup({ 'ytg-recent-searches': JSON.stringify(['<img onerror=alert(1)>', 'x'.repeat(257), 42, ' ', '<img onerror=alert(1)>']) });
  s.menu.openSearch(s.nativeSearch);
  const history = s.root.querySelector('#recent').querySelectorAll('button');
  assert.equal(history.length, 1);
  assert.equal(history[0].textContent, '↶  <img onerror=alert(1)>');
});

test('malformed and oversized page search histories render empty history', () => {
  for (const raw of ['{', 'null', '{}', ' '.repeat(8193)]) {
    const s = setup({ 'ytg-recent-searches': raw });
    s.menu.openSearch(s.nativeSearch);
    assert.equal(s.root.querySelector('#recent').querySelectorAll('button').length, 0);
  }
});

test('search from a quick menu returns to its entry even when the native search input exists', () => {
  const s = setup();
  s.menu.handle('help');
  const searchEntry = s.root.querySelectorAll('button')[0]; searchEntry.focus(); searchEntry.click();
  assert.equal(s.menu.state.openedFrom, 'quickMenu');
  assert.equal(s.root.querySelector('#query').value, 'existing');
  s.press('切换语言');
  s.escape();
  assert.equal(s.menu.state.view, 'search');
  assert.equal(s.root.activeElement.dataset.action, 'SWITCH_LANGUAGE');
  assert.deepEqual(s.restored, []);
  s.escape();
  assert.equal(s.menu.state.view, 'main'); assert.equal(s.menu.opened, true);
  assert.equal(s.root.activeElement.textContent, '搜索视频');
  assert.equal(s.window.YTGamepadFocus.suspended, true);
  s.escape();
  assert.equal(s.menu.opened, false);
  assert.deepEqual(s.restored, ['video-2']);
  assert.deepEqual(s.actions, ['back', 'back', 'back']);
});

test('page search returns directly to its captured entry and restores it once', () => {
  const s = setup(); s.pageOrigin();
  s.menu.openSearch(s.nativeSearch);
  assert.equal(s.menu.state.openedFrom, 'pageSearch');
  s.menu.handle('back');
  assert.equal(s.menu.opened, false);
  assert.deepEqual(s.restored, ['search']);
  s.menu.close(); assert.deepEqual(s.restored, ['search']);
});

test('pinyin consumes one back before search, menu and the original recommendation', () => {
  const s = setup(); s.menu.handle('help'); s.menu.handle('search');
  s.press('切换语言'); s.press('中文（拼音）'); s.press('N'); s.press('I');
  s.menu.handle('back');
  assert.equal(s.menu.state.composing, ''); assert.equal(s.menu.state.view, 'search');
  assert.equal(s.root.activeElement.dataset.row, '0'); assert.equal(s.root.activeElement.dataset.column, '0');
  assert.deepEqual(s.restored, []);
  s.menu.handle('back'); assert.equal(s.menu.state.view, 'main');
  s.menu.handle('back'); assert.deepEqual(s.restored, ['video-2']);
});

test('Y from a page preserves the actual origin rather than choosing the native search field', () => {
  const s = setup(); s.menu.handle('search');
  assert.equal(s.menu.state.openedFrom, 'pageSearch');
  s.menu.handle('back'); assert.equal(s.menu.opened, false);
  assert.deepEqual(s.restored, ['video-2']);
});
