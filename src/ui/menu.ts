import type { Dispose, InteractionEvent, MenuDependencies, MenuModule, MenuPort, ModuleFactory } from '../../types/ports';

import { YTGamepadActions } from '../shared/actions.ts';
export let YTGamepadMenuModule!: ModuleFactory<MenuDependencies,MenuModule>, YTGamepadMenu: MenuModule | undefined;
(() => {
  YTGamepadMenuModule = {
    /** @param {import('../../types/ports.js').MenuDependencies} dependencies */
    create({ runtime, interaction, controllerStyle, focusManager, styles, createSearch, mountQuickMenu, localChannel }: import('../../types/ports.js').MenuDependencies) {
  const lifecycle = runtime.scope('menu');
  const publish = (message: import('../../types/ports').ApplicationMessage) => {
    if (localChannel) localChannel.publish(message); else window.postMessage(message, location.origin);
  };
  let controller: MenuPort;
  let selected = 0;
  let settingsOpened = false;
  let disposeQuickMenu: Dispose|undefined;
  function stopQuickMenu() { disposeQuickMenu?.(); disposeQuickMenu = undefined; }
  const menuState = () => interaction.state.menu;
  const send = (event: InteractionEvent) => interaction.dispatch(event);
  const host = document.createElement('div');
  host.id = 'yt-gamepad-menu';
  host.setAttribute('lang', 'en');
  const root = host.attachShadow({ mode: 'open' });
  lifecycle.cleanup(controllerStyle.register(root));
  document.body.append(host);
  // Synthetic gamepad clicks do not produce CSS :active. Feedback never delays the action.
  lifecycle.listen(root, 'click', event => {
    const button = (event.target as HTMLElement | null)?.closest?.<HTMLButtonElement>('button');
    if (!button || button.disabled || !button.animate || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;
    button.getAnimations().filter((animation) => animation.id === 'ytg-press').forEach((animation) => animation.cancel());
    // Let the final keyframe inherit the current focus/hover scale.
    const animation = button.animate([{ scale: '.96', offset: 0 }], { duration: 100, easing: 'cubic-bezier(.2,.8,.2,1)', id: 'ytg-press' });
    const release = lifecycle.cleanup(() => animation.cancel());
    animation.onfinish = animation.oncancel = release;
  }, true);
  function positionSearch() {
    if (!menuState().opened || menuState().view !== 'search') return;
    host.style.setProperty('--search-height', Math.max(120, innerHeight - 32) + 'px');
  }
  lifecycle.listen(window, 'resize', positionSearch);
  lifecycle.listen(window, 'scroll', positionSearch, true);
  lifecycle.listen(host, 'click', event => { if (event.composedPath()[0] === host) close(); });
  function buttons() { return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.hidden && !button.disabled && !button.closest?.<HTMLElement>('[hidden]')); }
  function focus() { const list = buttons(); selected = Math.max(0, Math.min(selected, list.length - 1)); list[selected]?.focus({ preventScroll: true }); list[selected]?.scrollIntoView({ block: 'nearest' }); }
  const search = createSearch({ root, host, menuState, send, buttons, focus, feedback, close,
    get controller() { return controller; }, get selected() { return selected; }, set selected(value) { selected = value; }
  });
  function stopSettings() {
    if (!settingsOpened) return;
    settingsOpened = false; publish({ source: 'yt-gamepad-close-settings' });
  }
  function finishClose() { search.unmount?.(); stopQuickMenu(); stopSettings(); host.setAttribute('data-closing', ''); host.style.display = 'none'; search.setTarget(null); focusManager?.close(host); controller?.interactionChanged?.(); }
  function close() { if (!menuState().opened) return; send({ type: 'MENU_CLOSE' }); finishClose(); }
  function returnToMain() { render(); selected = menuState().menuSelection; focus(); }
  function openSettings() {
    if (lifecycle.destroyed) return;
    if (!menuState().opened) focusManager?.open(host, undefined, 100);
    search.setTarget(null); stopSettings(); send({ type: 'MENU_OPEN' });
    settingsOpened = true; render(); controller.interactionChanged?.();
  }
  if (localChannel) lifecycle.cleanup(localChannel.subscribe(message => { if (message.source === 'yt-gamepad-show-settings') openSettings(); }));
  else lifecycle.listen(window, 'message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'yt-gamepad-show-settings') openSettings();
  });
  function openSearch(target: import('../../types/ports').SearchTarget = null) {
    if (lifecycle.destroyed) return;
    if (menuState().opened && menuState().view === 'search') return;
    stopSettings();
    target ||= controller.getSearchTarget();
    if (!menuState().opened) focusManager?.open(host, undefined, 100);
    const active = buttons().indexOf(root.activeElement as HTMLButtonElement);
    if (menuState().opened && active >= 0) selected = active;
    send({ type: 'MENU_SEARCH', selected });
    search.setTarget(target);
    host.style.display = 'flex'; render();
    search.initializeQuery();
    positionSearch(); controller.interactionChanged?.();
  }
  function feedback(text: string) { controllerStyle.hint(root.querySelector<HTMLElement>('#message')!, text); }
  function activate(action: string, button: HTMLButtonElement) {
    if (action === 'search') openSearch();
    else if (action === 'extensionSettings') openSettings();
    else if (action === 'close') close();
    else Promise.resolve(controller.perform(action as import('../../types/ports').Action)).then(ok => {
      if (!lifecycle.destroyed && menuState().opened && button.isConnected)
        feedback(ok ? 'Done' : 'No video or captions available on this page');
    });
  }
  function render() {
    search.unmount?.();
    stopQuickMenu();
    host.toggleAttribute?.('data-closing', false);
    selected = 0;
    const title = settingsOpened ? 'Settings' : menuState().view === 'search' ? 'Search videos' : 'Quick menu';
    const main: [string,string][] = ['search', 'playPause', 'captions', 'volumeDown', 'volumeUp'].map(id => {
      const action = YTGamepadActions.get(id)!;
      return [id, action.menuLabel || action.label] as [string,string];
    }).concat([['extensionSettings', 'All settings'], ['close', 'Back']]);
    const sheet = document.createElement('style');
    sheet.textContent = styles.menu;
    host.toggleAttribute?.('data-search', menuState().view === 'search');
    host.toggleAttribute?.('data-settings', settingsOpened);
    // Shared html tokens follow YouTube's live [dark] attribute.
    // Important paint protects the covering surface from page styles.
    host.style.setProperty('background', menuState().view === 'search' ? 'var(--ytg-background)' : 'var(--ytg-overlay-backdrop)', 'important');
    host.style.setProperty('color', 'var(--ytg-text)', 'important');
    host.style.display = menuState().view === 'search' ? 'block' : 'flex';
    if (mountQuickMenu && menuState().view === 'main' && !settingsOpened) {
      const container = document.createElement('div');
      container.style.display = 'contents';
      root.replaceChildren(sheet, container);
      disposeQuickMenu = mountQuickMenu(container, interaction, main, activate);
      controllerStyle.hint(root.querySelector<HTMLElement>('#shortcuts')!, 'D-pad: Select · A Confirm · B Back · Start Close');
      focus();
      return;
    }
    const section = document.createElement('section');
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-modal', 'true');
    section.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    if (menuState().view !== 'search') section.append(heading);
    else section.className = 'search-panel' + (search.target ? ' native-search' : '');
    const container = document.createElement('div');
    container.id = menuState().view === 'search' ? 'keys' : 'items';
    const message = document.createElement('p');
    message.id = 'message';
    message.setAttribute('role', 'status');
    const instructions = document.createElement('p');
    instructions.className = 'controls'; instructions.id = 'shortcuts';
    if (menuState().view !== 'search') controllerStyle.hint(instructions, 'D-pad: Select · A Confirm · B Back · Start Close');
    if (menuState().view !== 'search') section.append(container, message, instructions);
    root.replaceChildren(sheet, section);
    if (menuState().view === 'search') {
      search.render(section);
    } else if (settingsOpened) {
      section.className = 'settings-panel';
      const dismiss = document.createElement('button');
      dismiss.className = 'settings-close'; dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', 'Close settings');
      dismiss.addEventListener('click', close); section.append(dismiss);
      const panel = document.createElement('div'); panel.id = 'inline-settings';
      root.querySelector<HTMLElement>('#items')!.append(panel);
      const back = document.createElement('button'); back.textContent = 'Back to quick menu';
      back.addEventListener('click', () => {
        stopSettings();
        render(); selected = 5; focus();
      });
      root.querySelector<HTMLElement>('#items')!.append(back);
      publish({ source: 'yt-gamepad-open-settings' });
    } else {
      for (const [action, label] of main) {
        const button = document.createElement('button'); button.textContent = label;
        button.addEventListener('click', () => activate(action, button)); root.querySelector<HTMLElement>('#items')!.append(button);
      }
    }
    if (menuState().view === 'search') selected = buttons().findIndex(button => Number(button.dataset.column) === 0 && Number(button.dataset.row) === 0);
    focus();
    positionSearch();
  }
  lifecycle.listen(root, 'keydown', e => {
    if (!menuState().opened) return;
    if (menuState().view === 'search' && search.keydown(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (settingsOpened) {
        const back = root.querySelector<HTMLElement>('[data-inline-back]');
        if (back) back.click(); else close();
      } else controller.dispatchAction('back');
    }
    if (e.key === 'Tab') {
      const targets = [...(menuState().view === 'search' ? [root.querySelector<HTMLInputElement>('#query')] : []), ...buttons()];
      const index = targets.indexOf(root.activeElement as HTMLInputElement | HTMLButtonElement);
      e.preventDefault(); targets[(index + (e.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
    }
  });
  function navigateKeys(action?: string|number|boolean|undefined) {
    if (menuState().view === 'search') return search.navigate(action as import('../../types/ports').Action);
    const list = buttons(), active = list.indexOf(root.activeElement as HTMLButtonElement);
    if (active >= 0) selected = active;
    selected += ['up', 'left'].includes(action as string) ? -1 : 1;
    focus(); return 'handled';
  }
  YTGamepadMenu = { destroy: lifecycle.destroy,
    /** @param {import('../../types/ports.js').MenuPort} port */
    connect(port: import('../../types/ports.js').MenuPort) { controller = port; },
    get opened() { return menuState().opened; },
    get settingsOpened() { return settingsOpened; },
    get state() { return { ...menuState() }; },
    close, openSearch,
    handle(action) {
      if (lifecycle.destroyed) return 'blocked';
      if (settingsOpened && action === 'back') {
        const back = root.querySelector<HTMLElement>('[data-inline-back]') || root.querySelector<HTMLElement>('#items > button');
        back?.click(); return 'handled';
      }
      const result = send({ type: 'MENU_INPUT', action });
      let disposition = result.disposition;
      for (const effect of result.effects) {
        switch (effect.type) {
          case 'openSearch': openSearch(); break;
          case 'openMenu':
            settingsOpened = false;
            focusManager?.open(host, undefined, 100);
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
            if (menuState().composing) feedback('Press Y to confirm a candidate, or B to cancel pinyin');
            else if (!menuState().choosingLanguage) search.keyboardAction({ action: menuState().frame === 'NUMBER_LAYOUT' ? 'LETTER_LAYOUT' : 'NUMBER_LAYOUT' });
            break;
          case 'cursorBack': search.moveCursor(-1); break;
          case 'cursorForward': search.moveCursor(1); break;
          case 'shift': search.keyboardAction({ action: 'SHIFT' }); break;
          case 'submit': search.submit(); break;
          case 'click': {
            const target = root.activeElement?.tagName === 'BUTTON' ? root.activeElement : buttons()[selected];
            if (target) (target as HTMLElement).click(); else disposition = 'blocked'; break;
          }
          case 'navigate': disposition = navigateKeys(effect.value); break;
        }
      }
      return disposition;
    }
  };
  const published = YTGamepadMenu;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (YTGamepadMenu === published) YTGamepadMenu = undefined; });
  lifecycle.cleanup(() => {
    stopQuickMenu();
    stopSettings();
    send({ type: 'MENU_CLOSE' }); host.style.display = 'none';
    focusManager?.close(host, false); search.destroy(); host.remove?.(); root.replaceChildren(); controller = undefined!;
  });
  return published;
  } };
})();
