import type { ControllerStyle } from '../../types/ports';

import { YTGamepadRuntime } from '../shared/runtime.ts';
import { YTGamepadBindings } from './bindings.ts';
import { YTGamepadStyles } from '../ui/styles.ts';
import { t } from '../shared/i18n';
export let YTGamepadControllerStyle: ControllerStyle | undefined;
// Prompts follow action bindings and the active controller's physical labels.
(() => {
  if (YTGamepadControllerStyle) return;
    const lifecycle = YTGamepadRuntime.scope('controller-style');
  const profiles: Record<ControllerStyle['family'],Record<string,string>> = {
    xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', L3: 'L3', R3: 'R3', Start: 'Menu' },
    playstation: { A: '×', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', L3: 'L3', R3: 'R3', Start: 'Options' },
    switch: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', L3: 'L Stick', R3: 'R Stick', Start: '+' },
    generic: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', L3: 'L3', R3: 'R3', Start: 'Start' }
  };
  profiles.xbox.Select = 'View'; profiles.playstation.Select = 'Share';
  profiles.switch.Select = '−'; profiles.generic.Select = 'Select';
  const roots: Set<ShadowRoot | Document> = new Set();
  let family: ControllerStyle['family'] = 'generic';
  let bindings = YTGamepadBindings.normalize();
  const actionForKey = Object.fromEntries(Object.entries(YTGamepadBindings.defaults).map(([action, button]) => [YTGamepadBindings.keys[button], action]));
  const boundKey = (key: string) => actionForKey[key] ? YTGamepadBindings.keys[bindings[actionForKey[key]]] : key;
  const keyboardKeys: Record<string, string> = { A: 'Enter', B: 'Esc', X: 'Space', Y: '/', LB: 'PageUp', RB: 'PageDown', LT: '−', RT: '=', Start: 'F1' };
  const keyboardMode = () => document.documentElement.dataset.ytgInputMode === 'keyboard';
  function identify(id = '') {
    if (/playstation|dualshock|dualsense|\bsony\b|054c|\bps[345]\b/i.test(id)) return 'playstation';
    if (/nintendo|switch|joy[- ]?con|057e/i.test(id)) return 'switch';
    if (/xbox|xinput|045e|microsoft/i.test(id)) return 'xbox';
    return 'generic';
  }
  const keysPattern = /\b(?:Start|LB|RB|LT|RT|L3|R3|A|B|X|Y)\b|[←→↑↓]/g;
  const navigationText = (text: string) => document.documentElement.dataset.ytgNavigationStick === 'right'
    ? text.replace(/left stick/gi, 'right stick').replace(/左摇杆/g, '右摇杆') : text;
  const format = (text: string) => navigationText(text).replace(keysPattern, (key: string) => keyboardMode() ? keyboardKeys[key] || key : profiles[family][boundKey(key)] || boundKey(key));
  function repaint() {
    for (const root of roots) for (const node of root.querySelectorAll<HTMLElement>('[data-ytg-key],[data-ytg-text],[data-ytg-title],[data-ytg-aria],[data-ytg-hint]')) paint(node);
  }
  function paint(node: HTMLElement) {
    const key = node.getAttribute('data-ytg-key');
    if (key !== null) {
      node.textContent = format(key);
      node.setAttribute('data-ytg-family', family);
      node.setAttribute('data-ytg-bound-key', key.split(' / ').map(boundKey).join(' / '));
      const parts = key.split(' / ').map(boundKey);
      node.setAttribute('data-ytg-first-key', parts[0]);
      node.setAttribute('data-ytg-second-key', parts[1] || parts[0]);
      node.setAttribute('data-ytg-icon', !keyboardMode() && parts.every((part) => Object.hasOwn(profiles[family], part) || /^[←→↑↓]$/.test(part)) ? 'true' : 'false');
      node.setAttribute('aria-label', format(key));
    }
    const sourceHint = node.getAttribute('data-ytg-hint');
    const hint = sourceHint === null ? null : navigationText(t(sourceHint));
    if (hint !== null) {
      const pieces = [], matches = hint.matchAll(keysPattern);
      let offset = 0;
      const text = (value: string|null) => { const span = document.createElement('span'); span.textContent = value; pieces.push(span); };
      for (const match of matches) {
        if (match.index > offset) text(hint.slice(offset, match.index));
        const icon = document.createElement('span');
        icon.setAttribute('data-ytg-key', match[0]); icon.setAttribute('aria-hidden', 'true');
        paint(icon); pieces.push(icon); offset = match.index + match[0].length;
      }
      if (offset < hint.length) text(hint.slice(offset));
      node.replaceChildren(...pieces);
      node.setAttribute('aria-label', format(hint));
    }
    for (const [marker, attribute] of [['data-ytg-text', null], ['data-ytg-title', 'title'], ['data-ytg-aria', 'aria-label']] as const) {
      const template = node.getAttribute(marker);
      if (template == null) continue;
      if (attribute) node.setAttribute(attribute, format(t(template)));
      else node.textContent = format(t(template));
    }
  }
  function bind<T extends HTMLElement>(node: T, template: string, attribute?: string) {
    node.setAttribute(attribute === 'title' ? 'data-ytg-title' : attribute === 'aria-label' ? 'data-ytg-aria' : 'data-ytg-text', template);
    paint(node);
    return node;
  }
  YTGamepadControllerStyle = {
    identify, format, bind,
    configureBindings(raw) {
      const next = YTGamepadBindings.normalize(raw);
      if (Object.keys(next).every(action => next[action] === bindings[action])) return;
      bindings = next; repaint();
    },
    css: YTGamepadStyles.controller,
    hint(node, text) { node.setAttribute('data-ytg-hint', text); paint(node); return node; },
    badge(node, key) { node.setAttribute('data-ytg-key', key); paint(node); return node; },
    register(root) { roots.add(root); return () => roots.delete(root); },
    get family() { return family; },
    use(pad) {
      const next = identify(pad?.id);
      if (next === family) return;
      family = next;
      document.documentElement.dataset.ytgController = family;
      repaint();
    }
  };
  document.documentElement.dataset.ytgController = family;
  lifecycle.listen(document, 'ytg-language-changed', repaint);
  lifecycle.listen(window, 'yt-gamepad-navigation-stick', repaint);
  lifecycle.listen(window, 'yt-gamepad-input-mode', repaint);
  const published = YTGamepadControllerStyle;
  lifecycle.cleanup(() => { roots.clear(); delete document.documentElement.dataset.ytgController; if (YTGamepadControllerStyle === published) YTGamepadControllerStyle = undefined; });
})();
