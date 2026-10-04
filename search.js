// Search feature. Receives its host, focus operations and site commands from the menu shell.
(() => {
  if (window.YTGamepadSearch) return;
  window.YTGamepadSearch = { create(port) {
    const { root, host, menuState, send, buttons, focus, feedback } = port;
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
    candidates = window.YTGamepadPinyin.lookup(menuState().composing);
    updateShortcuts();
    container.replaceChildren(); container.hidden = menuState().language !== 'zh-CN' || !menuState().composing;
    for (const item of root.querySelectorAll('#recent button')) if (Number(item.dataset.column) === -1) item.hidden = !container.hidden;
    const title = root.querySelector('#history-title'); if (title) title.hidden = !container.hidden;
    const empty = root.querySelector('#history-empty'); if (empty) empty.hidden = !container.hidden;
    const label = document.createElement('p');
    label.textContent = menuState().composing ? '拼音：' + menuState().composing + ' · R3 选词 · Y 确认 · LB / RB 翻页' : '中文拼音 · 用 V 输入 ü · 输入后上键选字';
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
    if (menuState().candidatePage > 0) add('上一页', () => { send({ type: 'MENU_PAGE', delta: -1 }); refreshCandidates(); focusCandidate(); });
    if (start + 5 < candidates.length) add('下一页', () => { send({ type: 'MENU_PAGE', delta: 1 }); refreshCandidates(); focusCandidate(); });
    add('原文 ' + menuState().composing, () => { const raw = menuState().composing; send({ type: 'MENU_COMPOSE', value: '' }); edit(raw); refreshCandidates(); focusFirstKey(); });
    container.append(line);
  }
  function focusCandidate() { port.selected = buttons().findIndex(button => button.dataset.row === '-1'); focus(); }
  function focusFirstKey() { port.selected = buttons().findIndex(button => button.dataset.row === '0' && button.dataset.column === '0'); focus(); }
  function commitCandidate(candidate) {
    send({ type: 'MENU_COMPOSE', value: menuState().composing.slice(candidate.consumed) });
    window.YTGamepadPinyin.learn(candidate); edit(candidate.text); refreshCandidates(); focusFirstKey();
  }
  function typeText(text) {
    if (menuState().language === 'zh-CN' && menuState().frame === 'LETTER_LAYOUT' && /^[a-z']$/i.test(text)) {
      if (menuState().composing.length >= 48) { feedback('请确认当前拼音后继续输入'); return; }
      send({ type: 'MENU_COMPOSE', value: window.YTGamepadPinyin.normalize(menuState().composing + text).slice(0, 48) }); refreshCandidates();
    } else if (menuState().composing) feedback('请先选择候选，或按 B 取消拼音');
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
      ['方向键 / 左摇杆', '选择'], ['A / ×', '输入'], ['X / □', '删除 · 长按连续'],
      ['Y / △', menuState().composing ? '确认候选' : '空格'],
      ['LB / RB', menuState().composing ? '翻页' : '移动光标'],
      ['L3', '符号'], ['R3', '候选 / 历史'], ['LT', '大小写'],
      ['RT', '搜索'], ['B / ○', '返回'], ['Start', '关闭']
    ];
    for (const [key, description] of shortcuts) {
      const item = document.createElement('span'); item.className = 'shortcut-item';
      const badge = document.createElement('span'); badge.className = 'shortcut-button'; badge.textContent = key;
      const label = document.createElement('span'); label.textContent = description;
      item.append(badge, label); hint.append(item);
    }
  }
  function addControllerBadge(button, action) {
    const shortcuts = {
      BACKSPACE: ['X / □', 'X / □ 删除（长按连续）'], SPACE: ['Y / △', 'Y / △ 空格；拼音输入时确认候选'],
      NUMBER_LAYOUT: ['L3', 'L3 切换符号'], LETTER_LAYOUT: ['L3', 'L3 切换字母'], SEARCH: ['RT', 'RT 搜索']
    };
    const shortcut = shortcuts[action];
    if (!shortcut) return;
    const badge = document.createElement('span'); badge.className = 'key-controller-badge';
    badge.setAttribute('aria-hidden', 'true');
    if (document.createElementNS) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.6');
      icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M7 6h10c2 0 3 2 3.5 4l1.2 7c.4 2-1.6 3-3 1.6L15.5 15h-7l-3.2 3.6C3.9 20 1.9 19 2.3 17l1.2-7C4 8 5 6 7 6ZM7 9v5m-2.5-2.5h5M16 10h.01M18 12h.01');
      icon.append(path); badge.append(icon);
    }
    const label = document.createElement('span'); label.textContent = shortcut[0]; badge.append(label);
    button.className = 'has-controller-badge'; button.append(badge);
    button.setAttribute('title', shortcut[1]);
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
      else { const target = buttons().findIndex(button => button.dataset.column === '-1'); if (target >= 0) { port.selected = target; focus(); } else feedback('还没有搜索历史'); }
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
    else feedback('没有候选，请选择原文或修改拼音');
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
        if (menuState().composing) { feedback('请先选择候选，或按 B 取消拼音'); focusCandidate(); break; }
        send({ type: 'MENU_LANGUAGE', value: true }); renderKeys(); port.selected = buttons().findIndex(button => button.dataset.action === 'ENGLISH'); focus(); break;
      case 'ENGLISH': case 'CHINESE':
        if (menuState().composing) { feedback('请先选择候选，或按 B 取消拼音'); break; }
        setLanguage(key.action === 'CHINESE' ? 'zh-CN' : 'en'); send({ type: 'MENU_LANGUAGE', value: false }); send({ type: 'MENU_FRAME', value: 'LETTER_LAYOUT' }); renderKeys(); refreshCandidates(); focusFirstKey(); break;
      case 'PHYSICAL_INPUT': setLanguage('en'); send({ type: 'MENU_LANGUAGE', value: false }); renderKeys(); refreshCandidates(); root.querySelector('#query').focus(); feedback('使用实体键盘输入中文，Enter 搜索，B 返回'); break;
    }
  }
  function renderKeys() {
    const container = root.querySelector('#keys');
    container.replaceChildren();
    const rows = menuState().choosingLanguage ? [[{ label: 'English', action: 'ENGLISH' }, { label: '中文（拼音）', action: 'CHINESE' }, { label: '实体键盘', action: 'PHYSICAL_INPUT' }]] : window.YTGamepadKeyboard.rows(menuState().frame, menuState().uppercase);
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
            path.setAttribute('d', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 0c-5 5-5 15 0 20m0-20c5 5 5 15 0 20M2 12h20M4 6h16M4 18h16');
            path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5');
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
    if (menuState().composing) { feedback('请先选择候选字，再搜索'); focusCandidate(); return; }
    const query = root.querySelector('#query').value.trim();
    if (!query) { feedback('请输入搜索内容'); return; }
    const submitted = port.controller.submitSearch(searchTarget, query, () => {
      // Commit history only when the adapter has a usable native search target.
      recent = sanitizeRecent([query, ...recent.filter(item => item !== query)]);
      try { localStorage.setItem('ytg-recent-searches', JSON.stringify(recent)); } catch (_) {}
      port.close();
    });
    if (!submitted) feedback('暂时找不到 YouTube 搜索按钮，请稍后重试');
  }
  function createInput(section) {
      const input = document.createElement('input');
      input.id = 'query';
      input.setAttribute('aria-label', '搜索内容');
      input.autocomplete = 'off';
      input.placeholder = '搜索';
      cursor = [0, 0];
      for (const event of ['input', 'select', 'keyup', 'click']) input.addEventListener(event, () => { rememberCursor(); syncSearch(); });
      section.append(input);
  }
  function render(section, container, message, instructions) {
      const layout = document.createElement('div'); layout.className = 'search-layout';
      const history = document.createElement('div'); history.id = 'recent';
      const composition = document.createElement('div'); composition.id = 'composition'; history.append(composition);
      const caption = document.createElement('p'); caption.id = 'history-title'; caption.textContent = '最近搜索'; history.append(caption);
      if (!recent.length) { const empty = document.createElement('p'); empty.id = 'history-empty'; empty.textContent = '搜索后会保存在这里'; history.append(empty); }
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
