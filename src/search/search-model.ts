import type { SearchInstance, SearchPort, SearchTarget, PinyinCandidate, KeyboardKey, Action, Disposition } from '../../types/ports.js';
import { createSearchText } from './search-text';
import type { MountSearch, SearchRenderer, SearchView } from './search-view';

/** Search policy and state; the injected renderer owns all markup. */
export function createSearchModel(port: SearchPort, mount: MountSearch): SearchInstance {
  const { root, menuState, send, buttons, focus, feedback } = port;
  const { controllerStyle, pinyin, keyboard } = port;
  const text = createSearchText();
  let renderer: SearchRenderer | undefined;
  let keyboardPosition = ['0', '0'];
  
  let searchTarget: SearchTarget = null, recent: string[] = [];
  let candidates: readonly PinyinCandidate[] = [];
  // Page storage is untrusted and readable by YouTube scripts; it is not an
  // extension-private database. Bound persisted input before using it in UI.
  const maxQueryLength = 256;
  const sanitizeRecent = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.slice(0, 5).filter((item): item is string => typeof item === 'string' && item.length <= maxQueryLength).map(item => item.trim()).filter(Boolean))] : [];
  try { send({ type: 'MENU_SET_LANGUAGE', value: localStorage.getItem('ytg-keyboard-language') === 'zh-CN' ? 'zh-CN' : 'en' }); } catch (_) {}
  function setLanguage(value: 'en' | 'zh-CN') {
    send({ type: 'MENU_SET_LANGUAGE', value }); candidates = [];
    try { localStorage.setItem('ytg-keyboard-language', value); } catch (_) {}
  }
  function snapshot(): SearchView {
    const state = menuState();
    const start = state.candidatePage * 5;
    return { query: text.state.query, composing: state.composing,
      chinese: state.language === 'zh-CN', choosingLanguage: state.choosingLanguage,
      rows: state.choosingLanguage ? [[{ label: 'English', action: 'ENGLISH' }, { label: 'Chinese (Pinyin)', action: 'CHINESE' }, { label: 'Physical keyboard', action: 'PHYSICAL_INPUT' }]] : keyboard.rows(state.frame, state.uppercase),
      recent: [...recent], candidates: candidates.slice(start, start + 5),
      previous: state.candidatePage > 0, next: start + 5 < candidates.length };
  }
  function updateView() { renderer?.update(snapshot()); }
  function refreshCandidates() { candidates = pinyin.lookup(menuState().composing); updateView(); }
  function focusCandidate() { port.selected = buttons().findIndex(button => button.dataset.row === '-1'); focus(); }
  function focusFirstKey() { port.selected = buttons().findIndex(button => button.dataset.row === '0' && button.dataset.column === '0'); focus(); }
  function commitCandidate(candidate: PinyinCandidate) {
    send({ type: 'MENU_COMPOSE', value: menuState().composing.slice(candidate.consumed) });
    pinyin.learn(candidate); edit(candidate.text); refreshCandidates(); focusFirstKey();
  }
  function typeText(text: string) {
    if (menuState().language === 'zh-CN' && menuState().frame === 'LETTER_LAYOUT' && /^[a-z']$/i.test(text)) {
      if (menuState().composing.length >= 48) { feedback('Confirm the current pinyin before typing more'); return; }
      send({ type: 'MENU_COMPOSE', value: pinyin.normalize(menuState().composing + text).slice(0, 48) }); refreshCandidates();
    } else if (menuState().composing) feedback('Select a candidate, or press B to cancel pinyin');
    else edit(text);
  }
  function backspace() {
    if (menuState().composing) { send({ type: 'MENU_COMPOSE', value: menuState().composing.slice(0, -1) }); refreshCandidates(); }
    else edit('', true);
  }
  function pageCandidates(delta: number) {
    const page = menuState().candidatePage;
    const next = Math.max(0, Math.min(Math.max(0, Math.ceil(candidates.length / 5) - 1), page + delta));
    if (next === page) return;
    const inCandidates = (root.activeElement as HTMLElement | null)?.dataset.row === '-1';
    send({ type: 'MENU_PAGE', delta: next - page }); refreshCandidates();
    if (inCandidates) focusCandidate();
  }
  function toggleCandidates() {
    const active = root.activeElement as HTMLButtonElement | null;
    if (active?.dataset.row === '-1' || active?.dataset.column === '-1') {
      port.selected = buttons().findIndex(button => button.dataset.row === keyboardPosition[0] && button.dataset.column === keyboardPosition[1]);
      if (port.selected < 0) focusFirstKey(); else focus();
    } else {
      if (active?.dataset.row !== undefined) keyboardPosition = [active.dataset.row!, active.dataset.column!];
      if (menuState().composing) focusCandidate();
      else { const target = buttons().findIndex(button => button.dataset.column === '-1'); if (target >= 0) { port.selected = target; focus(); } else feedback('No recent searches yet'); }
    }
  }
  function space() {
    if (menuState().composing && candidates.length) {
      const active = root.activeElement as HTMLButtonElement | null;
      const index = active?.dataset.row === '-1' ? Number(active.dataset.column!) : 0;
      const candidate = candidates[menuState().candidatePage * 5 + index];
      if (active?.dataset.row === '-1' && index >= candidates.slice(menuState().candidatePage * 5, menuState().candidatePage * 5 + 5).length) active?.click();
      else if (candidate) commitCandidate(candidate);
    } else if (!menuState().composing) edit(' ');
    else feedback('No candidates. Use the typed text or edit your pinyin.');
  }

  try {
    const raw = localStorage.getItem('ytg-recent-searches');
    if (raw && raw.length <= 8192) recent = sanitizeRecent(JSON.parse(raw));
  } catch (_) {}
  function inputElement() { return root.querySelector<HTMLInputElement>('#query'); }
  function rememberCursor() {
    const input = inputElement();
    if (input) text.setQuery(input.value, [input.selectionStart ?? 0, input.selectionEnd ?? 0]);
  }
  function syncSearch() { port.controller.syncSearch(searchTarget, text.state.query, text.state.selection); }
  function paintQuery() { updateView(); inputElement()?.setSelectionRange(...text.state.selection); }
  function edit(value: string, remove = false) {
    text.insertText(value, remove); paintQuery(); syncSearch();
  }
  function moveCursor(delta: number) {
    text.moveCursor(delta); inputElement()?.setSelectionRange(...text.state.selection);
    port.controller.moveSearchCursor?.(searchTarget, text.state.selection);
  }
  function keyboardAction(key: Pick<KeyboardKey, 'action'> & Partial<KeyboardKey>) {
    switch (key.action) {
      case 'TEXT': typeText(key.label || ''); break;
      case 'SPACE': space(); break;
      case 'BACKSPACE': backspace(); break;
      case 'CLEAR': {
        const input = inputElement()!;
        send({ type: 'MENU_COMPOSE', value: '' }); refreshCandidates();
        input.setSelectionRange(0, input.value.length); rememberCursor(); edit(''); break;
      }
      case 'SEARCH': submit(); break;
      case 'SHIFT': send({ type: 'MENU_SHIFT' }); updateView(); focus(); break;
      case 'NUMBER_LAYOUT': case 'LETTER_LAYOUT': {
        const active = buttons()[port.selected];
        const row = Number(active?.dataset.row || 0), column = Number(active?.dataset.column || 0);
        send({ type: 'MENU_FRAME', value: key.action }); updateView();
        port.selected = buttons().findIndex(button => Number(button.dataset.row) === row && Number(button.dataset.column) === column);
        focus(); break;
      }
      case 'SWITCH_LANGUAGE':
        if (menuState().composing) { feedback('Select a candidate, or press B to cancel pinyin'); focusCandidate(); break; }
        send({ type: 'MENU_LANGUAGE', value: true }); updateView(); port.selected = buttons().findIndex(button => button.dataset.action === 'ENGLISH'); focus(); break;
      case 'ENGLISH': case 'CHINESE':
        if (menuState().composing) { feedback('Select a candidate, or press B to cancel pinyin'); break; }
        setLanguage(key.action === 'CHINESE' ? 'zh-CN' : 'en'); send({ type: 'MENU_LANGUAGE', value: false }); send({ type: 'MENU_FRAME', value: 'LETTER_LAYOUT' }); updateView(); refreshCandidates(); focusFirstKey(); break;
      case 'PHYSICAL_INPUT': setLanguage('en'); send({ type: 'MENU_LANGUAGE', value: false }); updateView(); refreshCandidates(); inputElement()?.focus(); feedback('Type with your keyboard. Press Enter to search, or B to go back.'); break;
    }
  }
  function submit() {
    if (menuState().composing) { feedback('Select a candidate before searching'); focusCandidate(); return; }
    const query = text.state.query.trim();
    if (!query) { feedback('Enter a search query'); return; }
    const submitted = port.controller.submitSearch(searchTarget, query, () => {
      // Commit history when the adapter accepts a validated search destination.
      recent = sanitizeRecent([query, ...recent.filter(item => item !== query)]);
      try { localStorage.setItem('ytg-recent-searches', JSON.stringify(recent)); } catch (_) {}
      port.close();
    });
    if (!submitted) feedback('YouTube search is unavailable. Please try again shortly.');
  }
  function unmount() { renderer?.dispose(); renderer = undefined; }
  function render(section: HTMLElement) {
    unmount();
    renderer = mount(section, snapshot(), {
      input() { rememberCursor(); syncSearch(); updateView(); },
      focus(button) { port.selected = buttons().indexOf(button); },
      key: keyboardAction, candidate: commitCandidate,
      page(delta) { pageCandidates(delta); focusCandidate(); },
      raw() { const value = menuState().composing; send({ type: 'MENU_COMPOSE', value: '' }); edit(value); refreshCandidates(); focusFirstKey(); },
      recent(query) { text.setQuery(query); paintQuery(); submit(); }, submit
    }, controllerStyle);
    refreshCandidates();
  }
  function navigate(action: Action): Disposition {
    const list = buttons(), active = list.indexOf(root.activeElement as HTMLButtonElement);
    if (active >= 0) port.selected = active;
          const current = list[port.selected];
          if (!current) return 'blocked';
          const row = Number(current.dataset.row), column = Number(current.dataset.column);
          if (row === -1) {
            if (action === 'right') focusFirstKey();
            else if (action === 'up' || action === 'down') {
              const options = list.filter(button => button.dataset.row === '-1');
              port.selected = list.indexOf(options[Math.max(0, Math.min(options.length - 1, column + (action === 'up' ? -1 : 1)))]); focus();
            }
            return 'handled';
          }
          if (column === 0 && action === 'left' && menuState().composing && !menuState().choosingLanguage) { focusCandidate(); return 'handled'; }
          const targetRow = Math.max(0, Math.min(menuState().choosingLanguage ? 0 : 4, row + (action === 'up' ? -1 : action === 'down' ? 1 : 0)));
          if (column === -1) {
            const history = list.filter(key => Number(key.dataset.column) === -1);
            const next = action === 'right' ? list.find(key => Number(key.dataset.row) === Math.min(row, 4) && Number(key.dataset.column) === 0) : history[Math.max(0, Math.min(history.length - 1, row + (action === 'up' ? -1 : action === 'down' ? 1 : 0)))];
            port.selected = next ? list.indexOf(next) : port.selected; focus(); return 'handled';
          }
          if (action === 'left' && column === 0 && recent.length && !menuState().composing) {
            port.selected = list.findIndex(key => Number(key.dataset.column) === -1 && Number(key.dataset.row) === Math.min(row, recent.length - 1)); focus(); return 'handled';
          }
          const rowKeys = list.filter(key => Number(key.dataset.row) === targetRow && Number(key.dataset.column) >= 0);
          const targetColumn = Math.max(0, Math.min(rowKeys.length - 1, column + (action === 'left' ? -1 : action === 'right' ? 1 : 0)));
          port.selected = list.indexOf(rowKeys[targetColumn]!);
    focus(); return 'handled';
  }
  function keydown(e: KeyboardEvent) {
    if (menuState().language !== 'zh-CN' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (/^[a-z']$/i.test(e.key)) { e.preventDefault(); typeText(e.key); return true; }
    if (menuState().composing && e.key === 'Backspace') { e.preventDefault(); backspace(); return true; }
    if (menuState().composing && e.key === ' ') { e.preventDefault(); space(); return true; }
    return false;
  }
  return { render, navigate, keydown, renderKeys: updateView, refreshCandidates, focusFirstKey,
    keyboardAction, space, backspace, pageCandidates, toggleCandidates, moveCursor, submit,
    setTarget(value: SearchTarget) { searchTarget = value; }, get target() { return searchTarget; },
    initializeQuery() { text.setQuery(port.controller.readSearch(searchTarget)); paintQuery(); },
    unmount,
    destroy() { unmount(); searchTarget = null; candidates = []; text.setQuery(''); }

  };

}
