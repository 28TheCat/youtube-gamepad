import { moduleSource } from '../scripts/test-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('menu renders and switches views when HTML string assignments are blocked', () => {
  let root;
  function node(tag) {
    return {
      tagName: tag.toUpperCase(), style: { setProperty(name, value) { this[name] = value; } }, children: [], attributes: {}, dataset: {}, value: '', selectionStart: 0, selectionEnd: 0,
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.setSelectionRange(start + text.length, start + text.length); },
      dispatchEvent() {},
      set innerHTML(value) { throw new TypeError('TrustedHTML required'); },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { this[name] = fn; },
      focus() { root.activeElement = this; this.focusHandler?.(); }, scrollIntoView() {},
      click() { this.clickHandler?.(); },
      querySelectorAll(selector) {
        return this.children.flatMap(child => [ ...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []), ...child.querySelectorAll(selector)]);
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
  const document = { createElement: node, documentElement: node('html'), body: node('body'), activeElement: null };
  // Keep click event callbacks distinct from the click method.
  document.createElement = tag => {
    const el = node(tag);
    el.addEventListener = (name, fn) => { if (name === 'click') el.clickHandler = fn; else if (name === 'focus') el.focusHandler = fn; else el[name] = fn; };
    return el;
  };
  const window = { YTGamepadSite: { perform() { return true; } } };
  runInNewContext(['app/route-state.js', 'state-machine.js', 'focus.js', 'keyboard.js', 'pinyin-data.js', 'pinyin.js', 'ui/styles.js', 'search.js'].map(file => moduleSource(file)).join('\n') + moduleSource('menu.js'), { window, document, location: { pathname: '/', search: '' }, Event: class {}, innerWidth: 1200, innerHeight: 800, HTMLInputElement: class {} });
  window.YTGamepadFocus.register('page', {
    active: () => true,
    capture: () => document.activeElement ? { region: 'page', itemKey: 'input', index: 0 } : null,
    items: () => [{ region: 'page', itemKey: 'input', index: 0 }],
    fallback: () => null,
    apply: () => document.activeElement?.focus()
  });
  runInNewContext(moduleSource('sites/youtube.js'), {
    window, document, location: { pathname: '/', search: '' }, Event: class {}, HTMLInputElement: class {}
  });
  window.YTGamepadMenu.connect(window.YTGamepadSite);
  assert.equal(window.YTGamepadMenu.handle('playPause'), 'pass');
  assert.equal(window.YTGamepadMenu.handle('help'), 'handled');
  assert.equal(window.YTGamepadMenu.handle('playPause'), 'blocked');
  assert.equal(window.YTGamepadMenu.opened, true);
  assert.equal(root.querySelectorAll('button').length, 7);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === '完整设置'), true);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === '手柄设置'), false);
  assert.equal(window.YTGamepadMenu.handle('search'), 'handled');
  assert.equal(window.YTGamepadMenu.handle('unmapped'), 'blocked');
  assert.equal(root.querySelector('#query').attributes['aria-label'], '搜索内容');
  assert.equal(root.querySelectorAll('button').length, 34);
  const input = root.querySelector('#query');
  const press = label => root.querySelectorAll('button').find(button => (button.attributes['aria-label'] || button.textContent) === label).click();
  window.YTGamepadMenu.handle('volumeDown'); press('a'); press('b'); press('c');
  window.YTGamepadMenu.handle('seekBack');
  window.YTGamepadMenu.handle('playPause');
  assert.equal(input.value, 'ac');
  window.YTGamepadMenu.handle('search');
  assert.equal(input.value, 'a c');
  window.YTGamepadMenu.handle('volumeDown'); press('Q');
  assert.equal(input.value, 'a Qc');
  press('符号'); press('?'); press('ABC');
  assert.equal(input.value, 'a Q?c');
  const keysInRow = row => root.querySelectorAll('button').filter(button => button.dataset.row === String(row)).map(button => button.textContent);
  assert.deepEqual(keysInRow(0), ['A', 'B', 'C', 'D', 'E', 'F', 'G', '⌫']);
  const toggle = root.querySelectorAll('button').find(button => button.dataset.action === 'NUMBER_LAYOUT');
  toggle.focus(); window.YTGamepadMenu.handle('confirm');
  assert.equal(root.activeElement.dataset.action, 'LETTER_LAYOUT');
  assert.deepEqual(keysInRow(0), ['1', '2', '3', '&', '#', '(', ')', '⌫']);
  assert.deepEqual(keysInRow(1), ['4', '5', '6', '@', '!', '?', ':', 'ABC']);
  assert.deepEqual(keysInRow(2), ['7', '8', '9', '.', '-', '_', '"']);
  assert.deepEqual(keysInRow(3), ['0', '/', '$', '%', '+', '[', ']']);
  window.YTGamepadMenu.handle('confirm');
  press('切换语言');
  assert.equal(root.activeElement.dataset.action, 'ENGLISH');
  window.YTGamepadMenu.handle('back');
  assert.equal(root.activeElement.dataset.action, 'SWITCH_LANGUAGE');
  assert.equal(input.value, 'a Q?c');
  input.value = 'a😀b'; input.setSelectionRange(3, 3); input.select();
  window.YTGamepadMenu.handle('playPause');
  assert.equal(input.value, 'ab');
  input.value = 'abcd'; input.setSelectionRange(1, 3); input.select();
  press('Q'); assert.equal(input.value, 'aQd');
  root.querySelectorAll('button')[6].focus();
  window.YTGamepadMenu.handle('right');
  assert.equal(root.activeElement.dataset.column, '7');
  window.YTGamepadMenu.handle('down');
  assert.equal(root.activeElement.attributes['aria-label'], '符号');
  window.YTGamepadMenu.handle('back');
  assert.equal(root.querySelectorAll('button').length, 7);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === '完整设置'), true);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === '手柄设置'), false);
  window.YTGamepadMenu.handle('help');
  assert.equal(window.YTGamepadMenu.opened, false);
  let restored = false, restoreRequests = 0;
  window.YTGamepadFocus = { open() {}, close() { restoreRequests++; } };
  let updates = 0;
  const target = { value: 'existing query', isConnected: true, focus() { restored = true; }, setSelectionRange() {}, dispatchEvent() { updates++; } };
  document.activeElement = target;
  window.YTGamepadMenu.openSearch(target);
  assert.equal(root.querySelector('#query').value, 'existing query');
  press('A');
  assert.equal(target.value, 'existing queryA');
  assert.ok(updates > 0);
  window.YTGamepadMenu.handle('back');
  assert.equal(window.YTGamepadMenu.opened, false);
  assert.equal(restoreRequests, 1);
  assert.equal(restored, false); // The menu delegates restoration; the owner performs DOM focus.
  let searches = 0;
  document.querySelector = selector => selector.includes('search-icon-legacy') ? { click() { searches++; } } : target;
  window.YTGamepadMenu.openSearch(target);
  root.querySelector('#query').value = '  fullscreen search  ';
  window.YTGamepadMenu.handle('volumeUp');
  assert.equal(searches, 1);
  assert.equal(target.value, 'fullscreen search');
  assert.equal(window.YTGamepadMenu.opened, false);
  target.value = '';
  window.YTGamepadMenu.openSearch(target);
  press('切换语言'); press('中文（拼音）');
  for (const letter of 'NIHAO') press(letter);
  assert.equal(root.querySelector('#query').value, '');
  assert.ok(root.querySelector('#composition').children[0].textContent.includes('nihao'));
  const beforeSearch = searches;
  window.YTGamepadMenu.handle('volumeUp');
  assert.equal(searches, beforeSearch);
  assert.equal(root.activeElement.dataset.row, '-1');
  press('你好');
  assert.equal(target.value, '你好');
  for (const letter of 'NI') press(letter);
  const letterFocus = root.activeElement;
  window.YTGamepadMenu.handle('seekForward');
  assert.equal(root.activeElement, letterFocus);
  assert.equal(window.YTGamepadMenu.state.candidatePage, 1);
  window.YTGamepadMenu.handle('seekBack');
  assert.equal(window.YTGamepadMenu.state.candidatePage, 0);
  window.YTGamepadMenu.handle('keyboardCandidates');
  assert.equal(root.activeElement.dataset.row, '-1');
  window.YTGamepadMenu.handle('keyboardCandidates');
  assert.equal(root.activeElement, letterFocus);
  window.YTGamepadMenu.handle('back');
  window.YTGamepadMenu.handle('keyboardSymbols');
  assert.equal(window.YTGamepadMenu.state.frame, 'NUMBER_LAYOUT');
  window.YTGamepadMenu.handle('keyboardSymbols');
  assert.equal(window.YTGamepadMenu.state.frame, 'LETTER_LAYOUT');
  for (const letter of 'ZHONGGUO') press(letter);
  window.YTGamepadMenu.handle('search');
  assert.equal(target.value, '你好中国');
  press('N'); press('I'); window.YTGamepadMenu.handle('playPause');
  assert.ok(root.querySelector('#composition').children[0].textContent.includes('拼音：n'));
  window.YTGamepadMenu.handle('back');
  assert.equal(window.YTGamepadMenu.opened, true);
  assert.equal(target.value, '你好中国');
  window.YTGamepadMenu.handle('volumeUp');
  assert.equal(searches, beforeSearch + 1);
  assert.equal(target.value, '你好中国');

});

