// Search feature. Receives its host, focus operations and site commands from the menu shell.
(() => {
  if (window.YTGamepadSearch) return;
  window.YTGamepadSearch = {
    /** @param {import('./types/ports.js').SearchPort} port */
    create(port) {
    const { root, host, menuState, send, buttons, focus, feedback } = port;
    const { controllerStyle, pinyin, keyboard } = port;
  let keyboardPosition = ['0', '0'];
  let cursor = [0, 0];
  let searchTarget = null, recent = [];
  let candidates = [];
  // Page storage is untrusted and readable by YouTube scripts; it is not an
  // extension-private database. Bound persisted input before using it in UI.
  const maxQueryLength = 256;
  const sanitizeRecent = value => Array.isArray(value)
    ? [...new Set(value.slice(0, 5).filter(item => typeof item === 'string' && item.length <= maxQueryLength).map(item => item.trim()).filter(Boolean))] : [];
  try { send({ type: 'MENU_SET_LANGUAGE', value: localStorage.getItem('ytg-keyboard-language') === 'zh-CN' ? 'zh-CN' : 'en' }); } catch (_) {}
  function setLanguage(value) {
    send({ type: 'MENU_SET_LANGUAGE', value }); candidates = [];
    try { localStorage.setItem('ytg-keyboard-language', value); } catch (_) {}
  }
  function refreshCandidates() {
    const container = root.querySelector('#composition');
    if (!container) return;
    candidates = pinyin.lookup(menuState().composing);
    updateShortcuts();
    container.replaceChildren(); container.hidden = menuState().language !== 'zh-CN' || !menuState().composing;
    for (const item of root.querySelectorAll('#recent button')) if (Number(item.dataset.column) === -1) item.hidden = !container.hidden;
    const title = root.querySelector('#history-title'); if (title) title.hidden = !container.hidden;
    const empty = root.querySelector('#history-empty'); if (empty) empty.hidden = !container.hidden;
    const label = document.createElement('p');
    label.textContent = menuState().composing ? 'Pinyin: ' + menuState().composing : 'Chinese pinyin · Use V for ü · Press ↑ to select a candidate';
    if (menuState().composing) label.append(controllerStyle.hint(document.createElement('span'), ' · R3 Candidates · Y Confirm · LB / RB Page'));
    container.append(label);
    if (!menuState().composing) return;
    const line = document.createElement('div'); line.className = 'candidate-row';
    const add = (text, callback) => {
      const button = document.createElement('button'); button.textContent = text;
      button.dataset.row = '-1'; button.dataset.column = String(line.children.length);
      button.addEventListener('focus', () => { port.selected = buttons().indexOf(button); });
      button.addEventListener('click', callback); line.append(button);
    };
    const start = menuState().candidatePage * 5;
    for (const candidate of candidates.slice(start, start + 5)) add(candidate.text, () => commitCandidate(candidate));
    if (menuState().candidatePage > 0) add('Previous page', () => { send({ type: 'MENU_PAGE', delta: -1 }); refreshCandidates(); focusCandidate(); });
    if (start + 5 < candidates.length) add('Next page', () => { send({ type: 'MENU_PAGE', delta: 1 }); refreshCandidates(); focusCandidate(); });
    add('Use typed text: ' + menuState().composing, () => { const raw = menuState().composing; send({ type: 'MENU_COMPOSE', value: '' }); edit(raw); refreshCandidates(); focusFirstKey(); });
    container.append(line);
  }
  function focusCandidate() { port.selected = buttons().findIndex(button => button.dataset.row === '-1'); focus(); }
  function focusFirstKey() { port.selected = buttons().findIndex(button => button.dataset.row === '0' && button.dataset.column === '0'); focus(); }
  function commitCandidate(candidate) {
    send({ type: 'MENU_COMPOSE', value: menuState().composing.slice(candidate.consumed) });
    pinyin.learn(candidate); edit(candidate.text); refreshCandidates(); focusFirstKey();
  }
  function typeText(text) {
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
  function updateShortcuts() {
    const hint = root.querySelector('#shortcuts');
    if (!hint) return;
    hint.replaceChildren();
    const shortcuts = [
      ['D-pad / left stick', 'Select'], ['A', 'Type'], ['X', 'Delete · Hold to repeat'],
      ['Y', menuState().composing ? 'Confirm candidate' : 'Space'],
      ['LB / RB', menuState().composing ? 'Change page' : 'Move cursor'],
      ['L3', 'Symbols'], ['R3', 'Candidates / history'], ['LT', 'Letter case'],
      ['RT', 'Search'], ['B', 'Back'], ['Start', 'Close']
    ];
    for (const [key, description] of shortcuts) {
      const item = document.createElement('span'); item.className = 'shortcut-item';
      const badge = document.createElement('span'); badge.className = 'shortcut-button'; controllerStyle.badge(badge, key);
      const label = document.createElement('span'); label.textContent = description;
      item.append(badge, label); hint.append(item);
    }
  }
  function addControllerBadge(button, action) {
    const shortcuts = {
      BACKSPACE: ['X', 'X Delete (hold to repeat)'], SPACE: ['Y', 'Y Space; confirm candidate when entering pinyin'],
      NUMBER_LAYOUT: ['L3', 'L3 Switch to symbols'], LETTER_LAYOUT: ['L3', 'L3 Switch to letters'], SEARCH: ['RT', 'RT Search']
    };
    const shortcut = shortcuts[action];
    if (!shortcut) return;
    const badge = document.createElement('span'); badge.className = 'key-controller-badge';
    badge.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); controllerStyle.badge(label, shortcut[0]); badge.append(label);
    button.className = 'has-controller-badge'; button.append(badge);
    controllerStyle.bind(button, shortcut[1], 'title');
  }
  function pageCandidates(delta) {
    const page = menuState().candidatePage;
    const next = Math.max(0, Math.min(Math.max(0, Math.ceil(candidates.length / 5) - 1), page + delta));
    if (next === page) return;
    const inCandidates = root.activeElement?.dataset.row === '-1';
    send({ type: 'MENU_PAGE', delta: next - page }); refreshCandidates();
    if (inCandidates) focusCandidate();
  }
  function toggleCandidates() {
    const active = root.activeElement;
    if (active?.dataset.row === '-1' || active?.dataset.column === '-1') {
      port.selected = buttons().findIndex(button => button.dataset.row === keyboardPosition[0] && button.dataset.column === keyboardPosition[1]);
      if (port.selected < 0) focusFirstKey(); else focus();
    } else {
      if (active?.dataset.row !== undefined) keyboardPosition = [active.dataset.row, active.dataset.column];
      if (menuState().composing) focusCandidate();
      else { const target = buttons().findIndex(button => button.dataset.column === '-1'); if (target >= 0) { port.selected = target; focus(); } else feedback('No recent searches yet'); }
    }
  }
  function space() {
    if (menuState().composing && candidates.length) {
      const active = root.activeElement;
      const index = active?.dataset.row === '-1' ? Number(active.dataset.column) : 0;
      const candidate = candidates[menuState().candidatePage * 5 + index];
      if (active?.dataset.row === '-1' && index >= candidates.slice(menuState().candidatePage * 5, menuState().candidatePage * 5 + 5).length) active.click();
      else commitCandidate(candidate);
    } else if (!menuState().composing) edit(' ');
    else feedback('No candidates. Use the typed text or edit your pinyin.');
  }

  try {
    const raw = localStorage.getItem('ytg-recent-searches');
    if (raw && raw.length <= 8192) recent = sanitizeRecent(JSON.parse(raw));
  } catch (_) {}
  function rememberCursor() { const input = root.querySelector('#query'); if (input) cursor = [input.selectionStart, input.selectionEnd]; }
  function syncSearch() {
    const input = root.querySelector('#query');
    port.controller.syncSearch(searchTarget, input.value, cursor);
  }
  function edit(text, remove = false) {
    const input = root.querySelector('#query');
    let [start, end] = cursor;
    if (remove && start === end && start > 0) start -= Array.from(input.value.slice(0, start)).at(-1).length;
    input.setRangeText(text, start, end, 'end');
    rememberCursor();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    syncSearch();
  }
  function moveCursor(delta) {
    const input = root.querySelector('#query');
    let position = delta < 0 ? cursor[0] : cursor[1];
    if (cursor[0] === cursor[1]) {
      if (delta < 0 && position > 0) position -= Array.from(input.value.slice(0, position)).at(-1).length;
      if (delta > 0 && position < input.value.length) position += Array.from(input.value.slice(position))[0].length;
    }
    input.setSelectionRange(position, position); rememberCursor();
    port.controller.moveSearchCursor?.(searchTarget, cursor);
  }
  function keyboardAction(key) {
    switch (key.action) {
      case 'TEXT': typeText(key.label); break;
      case 'SPACE': space(); break;
      case 'BACKSPACE': backspace(); break;
      case 'CLEAR': {
        const input = root.querySelector('#query');
        send({ type: 'MENU_COMPOSE', value: '' }); refreshCandidates();
        input.setSelectionRange(0, input.value.length); rememberCursor(); edit(''); break;
      }
      case 'SEARCH': submit(); break;
      case 'SHIFT': send({ type: 'MENU_SHIFT' }); renderKeys(); focus(); break;
      case 'NUMBER_LAYOUT': case 'LETTER_LAYOUT': {
        const active = buttons()[port.selected];
        const row = Number(active?.dataset.row || 0), column = Number(active?.dataset.column || 0);
        send({ type: 'MENU_FRAME', value: key.action }); renderKeys();
        port.selected = buttons().findIndex(button => Number(button.dataset.row) === row && Number(button.dataset.column) === column);
        focus(); break;
      }
      case 'SWITCH_LANGUAGE':
        if (menuState().composing) { feedback('Select a candidate, or press B to cancel pinyin'); focusCandidate(); break; }
        send({ type: 'MENU_LANGUAGE', value: true }); renderKeys(); port.selected = buttons().findIndex(button => button.dataset.action === 'ENGLISH'); focus(); break;
      case 'ENGLISH': case 'CHINESE':
        if (menuState().composing) { feedback('Select a candidate, or press B to cancel pinyin'); break; }
        setLanguage(key.action === 'CHINESE' ? 'zh-CN' : 'en'); send({ type: 'MENU_LANGUAGE', value: false }); send({ type: 'MENU_FRAME', value: 'LETTER_LAYOUT' }); renderKeys(); refreshCandidates(); focusFirstKey(); break;
      case 'PHYSICAL_INPUT': setLanguage('en'); send({ type: 'MENU_LANGUAGE', value: false }); renderKeys(); refreshCandidates(); root.querySelector('#query').focus(); feedback('Type with your keyboard. Press Enter to search, or B to go back.'); break;
    }
  }
  function renderKeys() {
    const container = root.querySelector('#keys');
    container.replaceChildren();
    const rows = menuState().choosingLanguage ? [[{ label: 'English', action: 'ENGLISH' }, { label: 'Chinese (Pinyin)', action: 'CHINESE' }, { label: 'Physical keyboard', action: 'PHYSICAL_INPUT' }]] : keyboard.rows(menuState().frame, menuState().uppercase);
    rows.forEach((keys, row) => {
      const line = document.createElement('div'); line.className = 'key-row' + (menuState().choosingLanguage ? ' languages' : '');
      keys.forEach((key, column) => {
        const button = document.createElement('button'); button.textContent = key.label;
        if (['SWITCH_LANGUAGE', 'BACKSPACE'].includes(key.action) && document.createElementNS) {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          if (key.action === 'BACKSPACE') {
            // Google Material Icons backspace, Apache-2.0; see THIRD_PARTY_NOTICES.md.
            path.setAttribute('d', 'M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12.59L17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12 19 15.59z');
            path.setAttribute('fill', 'currentColor');
          } else {
            // Google Material Icons language, Apache-2.0; see THIRD_PARTY_NOTICES.md.
            path.setAttribute('d', "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z");
            path.setAttribute('fill', 'currentColor');
          }
          icon.append(path); button.replaceChildren(icon);
        }
        button.setAttribute('aria-label', key.ariaLabel || key.label);
        addControllerBadge(button, key.action);
        button.dataset.row = String(row); button.dataset.column = String(column); button.dataset.action = key.action;
        button.addEventListener('mousedown', e => e.preventDefault());
        button.addEventListener('focus', () => { port.selected = buttons().indexOf(button); });
        button.addEventListener('click', () => keyboardAction(key));
        line.append(button);
      }); container.append(line);
    });
  }
  function submit() {
    if (menuState().composing) { feedback('Select a candidate before searching'); focusCandidate(); return; }
    const query = root.querySelector('#query').value.trim();
    if (!query) { feedback('Enter a search query'); return; }
    const submitted = port.controller.submitSearch(searchTarget, query, () => {
      // Commit history only when the adapter has a usable native search target.
      recent = sanitizeRecent([query, ...recent.filter(item => item !== query)]);
      try { localStorage.setItem('ytg-recent-searches', JSON.stringify(recent)); } catch (_) {}
      port.close();
    });
    if (!submitted) feedback('YouTube search is unavailable. Please try again shortly.');
  }
  function createInput(section) {
      const input = document.createElement('input');
      input.id = 'query';
      input.setAttribute('aria-label', 'Search query');
      input.autocomplete = 'off';
      input.placeholder = 'Search';
      cursor = [0, 0];
      for (const event of ['input', 'select', 'keyup', 'click']) input.addEventListener(event, () => { rememberCursor(); syncSearch(); });
      section.append(input);
  }
  function render(section, container, message, instructions) {
      const layout = document.createElement('div'); layout.className = 'search-layout';
      const history = document.createElement('div'); history.id = 'recent';
      const composition = document.createElement('div'); composition.id = 'composition'; history.append(composition);
      const caption = document.createElement('p'); caption.id = 'history-title'; caption.textContent = 'Recent searches'; history.append(caption);
      if (!recent.length) { const empty = document.createElement('p'); empty.id = 'history-empty'; empty.textContent = 'Your recent searches will appear here'; history.append(empty); }
      recent.forEach((query, row) => {
        const button = document.createElement('button'); button.textContent = '↶  ' + query;
        button.dataset.row = row; button.dataset.column = -1;
        button.addEventListener('focus', () => { port.selected = buttons().indexOf(button); });
        button.addEventListener('click', () => { const input = root.querySelector('#query'); input.value = query; submit(); });
        history.append(button);
      });
      layout.append(history, container); section.append(layout, message, instructions);
      renderKeys();
      refreshCandidates();
      root.querySelector('#query').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
  }
  function navigate(action) {
    const list = buttons(), active = list.indexOf(root.activeElement);
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
            port.selected = list.indexOf(next); focus(); return 'handled';
          }
          if (action === 'left' && column === 0 && recent.length && !menuState().composing) {
            port.selected = list.findIndex(key => Number(key.dataset.column) === -1 && Number(key.dataset.row) === Math.min(row, recent.length - 1)); focus(); return 'handled';
          }
          const rowKeys = list.filter(key => Number(key.dataset.row) === targetRow && Number(key.dataset.column) >= 0);
          const targetColumn = Math.max(0, Math.min(rowKeys.length - 1, column + (action === 'left' ? -1 : action === 'right' ? 1 : 0)));
          port.selected = list.indexOf(rowKeys[targetColumn]);
    focus(); return 'handled';
  }
  function keydown(e) {
    if (menuState().language !== 'zh-CN' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (/^[a-z']$/i.test(e.key)) { e.preventDefault(); typeText(e.key); return true; }
    if (menuState().composing && e.key === 'Backspace') { e.preventDefault(); backspace(); return true; }
    if (menuState().composing && e.key === ' ') { e.preventDefault(); space(); return true; }
    return false;
  }
  return { createInput, render, navigate, keydown, renderKeys, refreshCandidates, focusFirstKey,
    focusCandidate, keyboardAction, space, backspace, pageCandidates, toggleCandidates, moveCursor, submit,
    setTarget(value) { searchTarget = value; }, get target() { return searchTarget; },
    initializeQuery() {
      const input = root.querySelector('#query'); input.value = port.controller.readSearch(searchTarget);
      input.setSelectionRange(input.value.length, input.value.length); rememberCursor();
    },
    destroy() { searchTarget = null; candidates = []; }
  };
  } };
})();
