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
      getAttribute(name) { return this.attributes[name] ?? null; },
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
  const searches = [];
  runInNewContext(['src/app/route-state.ts', 'src/app/state-machine.ts', 'src/navigation/focus.ts', 'src/search/keyboard.ts', 'src/search/pinyin-data.ts', 'src/search/pinyin.ts', 'src/ui/styles.ts', 'src/search/search.ts'].map(file => moduleSource(file)).join('\n') + moduleSource('src/ui/menu.ts'), { window, document, location: { pathname: '/', search: '' }, Event: class {}, innerWidth: 1200, innerHeight: 800, HTMLInputElement: class {} });
  window.YTGamepadFocus.register('page', {
    active: () => true,
    capture: () => document.activeElement ? { region: 'page', itemKey: 'input', index: 0 } : null,
    items: () => [{ region: 'page', itemKey: 'input', index: 0 }],
    fallback: () => null,
    apply: () => document.activeElement?.focus()
  });
  runInNewContext(moduleSource('src/sites/youtube.ts'), {
    window, document, URLSearchParams, location: { pathname: '/', search: '', assign(href) { searches.push(href); } }, Event: class {}, HTMLInputElement: class {}
  });
  window.YTGamepadMenu.connect(window.YTGamepadSite);
  assert.equal(window.YTGamepadMenu.handle('playPause'), 'pass');
  assert.equal(window.YTGamepadMenu.handle('help'), 'handled');
  assert.equal(window.YTGamepadMenu.handle('playPause'), 'blocked');
  assert.equal(window.YTGamepadMenu.opened, true);
  assert.equal(root.querySelectorAll('button').length, 7);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === 'All settings'), true);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === 'Gamepad settings'), false);
  assert.equal(window.YTGamepadMenu.handle('search'), 'handled');
  assert.equal(window.YTGamepadMenu.handle('unmapped'), 'blocked');
  assert.equal(root.querySelector('#query').attributes['aria-label'], 'Search query');
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
  press('Symbols'); press('?'); press('ABC');
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
  press('Switch input language');
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
  assert.equal(root.activeElement.attributes['aria-label'], 'Symbols');
  window.YTGamepadMenu.handle('back');
  assert.equal(root.querySelectorAll('button').length, 7);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === 'All settings'), true);
  assert.equal(root.querySelectorAll('button').some(button => button.textContent === 'Gamepad settings'), false);
  window.YTGamepadMenu.handle('help');
  assert.equal(window.YTGamepadMenu.opened, false);
  let restored = false, restoreRequests = 0;
  window.YTGamepadFocus.close = () => { restoreRequests++; };
  let updates = 0;
  const target = { value: 'existing query', isConnected: true, matches: selector => selector === '[data-ytg-search-input]', focus() { restored = true; }, setSelectionRange() {}, dispatchEvent() { updates++; } };
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
  document.querySelector = () => target;
  window.YTGamepadMenu.openSearch(target);
  root.querySelector('#query').value = '  fullscreen search  ';
  root.querySelector('#query').input();
  window.YTGamepadMenu.handle('volumeUp');
  assert.deepEqual(searches, ['/results?search_query=fullscreen+search']);
  assert.equal(target.value, 'fullscreen search');
  assert.equal(window.YTGamepadMenu.opened, false);
  target.value = '';
  window.YTGamepadMenu.openSearch(target);
  press('Switch input language'); press('Chinese (Pinyin)');
  for (const letter of 'NIHAO') press(letter);
  assert.equal(root.querySelector('#query').value, '');
  assert.ok(root.querySelector('#composition').children[0].textContent.includes('nihao'));
  const beforeSearch = searches.length;
  window.YTGamepadMenu.handle('volumeUp');
  assert.equal(searches.length, beforeSearch);
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
  assert.ok(root.querySelector('#composition').children[0].textContent.includes('Pinyin: n'));
  window.YTGamepadMenu.handle('back');
  assert.equal(window.YTGamepadMenu.opened, true);
  assert.equal(target.value, '你好中国');
  window.YTGamepadMenu.handle('volumeUp');
  assert.equal(searches.length, beforeSearch + 1);
  assert.equal(target.value, '你好中国');

});

