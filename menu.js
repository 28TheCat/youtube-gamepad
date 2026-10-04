(() => {
  const lifecycle = window.YTGamepadRuntime.scope('menu');
  let controller;
  let selected = 0;
  const interaction = window.YTGamepadInteraction;
  const menuState = () => interaction.state.menu;
  const send = event => interaction.dispatch(event);
  const host = document.createElement('div');
  host.id = 'yt-gamepad-menu';
  const root = host.attachShadow({ mode: 'open' });
  document.body.append(host);
  function positionSearch() {
    if (!menuState().opened || menuState().view !== 'search') return;
    host.style.setProperty('--search-height', Math.max(120, innerHeight - 32) + 'px');
  }
  lifecycle.listen(window, 'resize', positionSearch);
  lifecycle.listen(window, 'scroll', positionSearch, true);
  function buttons() { return Array.from(root.querySelectorAll('button')).filter(button => !button.hidden); }
  function focus() { const list = buttons(); selected = Math.max(0, Math.min(selected, list.length - 1)); list[selected]?.focus({ preventScroll: true }); list[selected]?.scrollIntoView({ block: 'nearest' }); }
  const search = window.YTGamepadSearch.create({ root, host, menuState, send, buttons, focus, feedback, close,
    get controller() { return controller; }, get selected() { return selected; }, set selected(value) { selected = value; }
  });
  function finishClose() { host.style.display = 'none'; search.setTarget(null); window.YTGamepadFocus?.close(host); controller?.interactionChanged?.(); }
  function close() { if (!menuState().opened) return; send({ type: 'MENU_CLOSE' }); finishClose(); }
  function returnToMain() { render(); selected = menuState().menuSelection; focus(); }
  function openSearch(target = null) {
    if (lifecycle.destroyed) return;
    if (menuState().opened && menuState().view === 'search') return;
    target ||= controller.getSearchTarget();
    if (!menuState().opened) window.YTGamepadFocus?.open(host, undefined, 100);
    const active = buttons().indexOf(root.activeElement);
    if (menuState().opened && active >= 0) selected = active;
    send({ type: 'MENU_SEARCH', selected });
    search.setTarget(target);
    host.style.display = 'flex'; render();
    search.initializeQuery();
    positionSearch(); controller.interactionChanged?.();
  }
  function feedback(text) { root.querySelector('#message').textContent = text; }
  function render() {
    selected = 0;
    const title = menuState().view === 'search' ? '搜索视频' : '快捷菜单';
    const main = [['search','搜索视频'],['playPause','播放 / 暂停'],['captions','开启 / 关闭字幕'],['volumeDown','音量 −'],['volumeUp','音量 ＋'],['extensionSettings','完整设置'],['close','返回']];
    const sheet = document.createElement('style');
    sheet.textContent = window.YTGamepadStyles.menu;
    host.toggleAttribute?.('data-search', menuState().view === 'search');
    // Shared html tokens follow YouTube's live [dark] attribute.
    // Important paint protects the covering surface from page styles.
    host.style.setProperty('background', menuState().view === 'search' ? 'var(--ytg-background)' : 'var(--ytg-overlay-backdrop)', 'important');
    host.style.setProperty('color', 'var(--ytg-text)', 'important');
    host.style.display = menuState().view === 'search' ? 'block' : 'flex';
    const section = document.createElement('section');
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-modal', 'true');
    section.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    if (menuState().view !== 'search') section.append(heading);
    else section.className = 'search-panel' + (search.target ? ' native-search' : '');
    if (menuState().view === 'search') {
      search.createInput(section);
    }
    const container = document.createElement('div');
    container.id = menuState().view === 'search' ? 'keys' : 'items';
    const message = document.createElement('p');
    message.id = 'message';
    message.setAttribute('role', 'status');
    const instructions = document.createElement('p');
    instructions.className = 'controls'; instructions.id = 'shortcuts';
    instructions.textContent = menuState().view === 'search' ? '方向键 / 左摇杆选择 · A 输入 · X 删除 · Y 空格 · LB / RB 移动光标 · LT 大小写 · RT 搜索 · B 返回 · Start 关闭' : '方向键选择 · A 确认 · B 返回 · Start 关闭';
    if (menuState().view !== 'search') section.append(container, message, instructions);
    root.replaceChildren(sheet, section);
    if (menuState().view === 'search') {
      search.render(section, container, message, instructions);
    } else {
      for (const [action, label] of main) {
        const button = document.createElement('button'); button.textContent = label;
        button.addEventListener('click', () => {
          if (action === 'search') openSearch();
          else if (action === 'extensionSettings') {
            window.postMessage({ source: 'yt-gamepad-open-settings' }, location.origin);
            feedback('正在打开完整设置');
          }
          else if (action === 'close') close();
          else feedback(controller.perform(action) ? '已执行' : '当前页面没有可用的视频或字幕');
        }); root.querySelector('#items').append(button);
      }
    }
    if (menuState().view === 'search') selected = buttons().findIndex(button => Number(button.dataset.column) === 0 && Number(button.dataset.row) === 0);
    focus();
    positionSearch();
  }
  lifecycle.listen(root, 'keydown', e => {
    if (!menuState().opened) return;
    if (menuState().view === 'search' && search.keydown(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); controller.dispatchAction('back'); }
    if (e.key === 'Tab') {
      const targets = [...(menuState().view === 'search' ? [root.querySelector('#query')] : []), ...buttons()];
      const index = targets.indexOf(root.activeElement);
      e.preventDefault(); targets[(index + (e.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
    }
  });
  function navigateKeys(action) {
    if (menuState().view === 'search') return search.navigate(action);
    const list = buttons(), active = list.indexOf(root.activeElement);
    if (active >= 0) selected = active;
    selected += ['up', 'left'].includes(action) ? -1 : 1;
    focus(); return 'handled';
  }
  window.YTGamepadMenu = {
    connect(port) { controller = port; },
    get opened() { return menuState().opened; },
    get state() { return { ...menuState() }; },
    close, openSearch,
    handle(action) {
      if (lifecycle.destroyed) return 'blocked';
      const result = send({ type: 'MENU_INPUT', action });
      let disposition = result.disposition;
      for (const effect of result.effects) {
        switch (effect.type) {
          case 'openSearch': openSearch(); break;
          case 'openMenu':
            window.YTGamepadFocus?.open(host, undefined, 100);
            search.setTarget(null); send({ type: 'MENU_OPEN' }); host.style.display = 'flex'; render(); controller.interactionChanged?.(); break;
          case 'closeMenu':
            // MENU_BACK already committed a closed state; help uses the close command.
            if (menuState().opened) close(); else finishClose(); break;
          case 'languageFocus': search.renderKeys(); selected = buttons().findIndex(button => button.dataset.action === 'SWITCH_LANGUAGE'); focus(); break;
          case 'compositionFocus': search.refreshCandidates(); search.focusFirstKey(); break;
          case 'mainFocus': returnToMain(); break;
          case 'space': search.space(); break;
          case 'backspace': search.backspace(); break;
          case 'pageBack': search.pageCandidates(-1); break;
          case 'pageForward': search.pageCandidates(1); break;
          case 'keyboardCandidates': search.toggleCandidates(); break;
          case 'keyboardSymbols':
            if (menuState().composing) feedback('请先按 Y 确认候选，或按 B 取消拼音');
            else if (!menuState().choosingLanguage) search.keyboardAction({ action: menuState().frame === 'NUMBER_LAYOUT' ? 'LETTER_LAYOUT' : 'NUMBER_LAYOUT' });
            break;
          case 'cursorBack': search.moveCursor(-1); break;
          case 'cursorForward': search.moveCursor(1); break;
          case 'shift': search.keyboardAction({ action: 'SHIFT' }); break;
          case 'submit': search.submit(); break;
          case 'click': {
            const target = root.activeElement?.tagName === 'BUTTON' ? root.activeElement : buttons()[selected];
            if (target) target.click(); else disposition = 'blocked'; break;
          }
          case 'navigate': disposition = navigateKeys(effect.value); break;
        }
      }
      return disposition;
    }
  };
  const published = window.YTGamepadMenu;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepadMenu === published) delete window.YTGamepadMenu; });
  lifecycle.cleanup(() => {
    send({ type: 'MENU_CLOSE' }); host.style.display = 'none';
    window.YTGamepadFocus?.close(host, false); search.destroy(); host.remove?.(); root.replaceChildren(); controller = null;
  });
})();
