import type { InputDependencies, InputModule, ModuleFactory } from '../../types/ports';
import { YTGamepadBindings } from './bindings.ts';
import { findPrimaryController } from './primary-controller.ts';
export let YTGamepadInput: InputModule | undefined, YTGamepadInputModule!: ModuleFactory<InputDependencies,InputModule>;
(() => {
  /** @param {import('../../types/ports.js').InputDependencies} dependencies */
  function create({ runtime, controllerStyle, isSearchOpen, localChannel, temporarySpeed, canRepeatMedia, canHandleInput, inputContext, scroll }: import('../../types/ports.js').InputDependencies) {
  const lifecycle = runtime.scope('input');
  const defaults = { enabled: true, rightHandMode: false, deadzone: 0.35, repeatDelay: 150, repeatInterval: 80 };
  let settings = { ...defaults }, previous = new Set<number>(), heldDirection = '', nextRepeat = 0, index: number|null = null;
  let generation = 0, directionNeedsNeutral = false, scrollNeedsNeutral = false;
  let inputMode: 'gamepad' | 'mouse' | 'keyboard' = 'mouse', mousePosition: { x: number; y: number; }|null = null, mouseTravel = { x: 0, y: 0, time: 0 }, waitForNeutral = false;
  const modeStorageKey = 'yt-gamepad-input-mode';
  try {
    const saved = globalThis.sessionStorage?.getItem(modeStorageKey);
    if (saved === 'gamepad' || saved === 'keyboard' || saved === 'mouse') inputMode = saved;
  } catch { /* Input still works when tab storage is unavailable. */ }
  const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const recentSources: import('../../types/ports').InputSourceTrace[] = [];
  let lastGamepadAt = -Infinity, lastGamepadAction = '';
  function trace(source: string, decision: 'switch' | 'preserve' | 'ignored', previousMode = inputMode) {
    recentSources.push({ source, decision, previousMode, mode: inputMode, time: now() });
    if (recentSources.length > 32) recentSources.shift();
  }
  let speedPress: number | null = null;
  let scrollTime: number | null = null;
  function stopScroll() {
    if (scrollTime === null) return;
    scrollTime = null;
    scroll?.(0);
  }
  function stopSpeed() {
    if (speedPress === null) return;
    speedPress = null;
    temporarySpeed?.(false);
  }
  function setMode(value: 'gamepad' | 'mouse' | 'keyboard', source: string) {
    if (inputMode === value) { trace(source, 'preserve'); return; }
    const previousMode = inputMode;
    inputMode = value;
    if (source !== 'destroy') {
      try { globalThis.sessionStorage?.setItem(modeStorageKey, value); } catch { /* Keep in-memory ownership. */ }
    }
    trace(source, 'switch', previousMode);
    mouseTravel = { x: 0, y: 0, time: 0 };
    document.documentElement.classList.toggle('ytg-gamepad-input', value === 'gamepad');
    document.documentElement.dataset.ytgInputMode = value;
    if (value !== 'gamepad') suspendHolds();
    window.dispatchEvent(new CustomEvent('yt-gamepad-input-mode', { detail: { mode: value, previousMode, source } }));
  }
  const emit = (action: string, phase: 'press' | 'repeat') => {
    if (!mediaActions.includes(action)) cancelMedia();
    stopSpeed();
    lastGamepadAt = now(); lastGamepadAction = action;
    setMode('gamepad', 'gamepad-action');
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action, phase } }));
  };
  const mediaActions = ['seekBack', 'seekForward', 'volumeDown', 'volumeUp'];
  const heldButtons = new Map<number, { action: string; next: number; context: 'search' | 'media' }>();
  function endButton(button: number, phase: 'release' | 'cancel') {
    const held = heldButtons.get(button);
    heldButtons.delete(button);
    if (held?.context === 'media') window.dispatchEvent(new CustomEvent('yt-gamepad-button-end', { detail: { action: held.action, cancelled: phase === 'cancel' } }));
  }
  function cancelMedia() { for (const [button, held] of heldButtons) if (held.context === 'media') endButton(button, 'cancel'); }
  function cancelHolds(keepDirection = false) {
    ++generation;
    for (const button of heldButtons.keys()) endButton(button, 'cancel');
    stopSpeed();
    scrollNeedsNeutral ||= scrollTime !== null;
    stopScroll();
    if (!keepDirection) {
      directionNeedsNeutral ||= !!heldDirection;
      heldDirection = '';
    }
  }
  function reset() {
    cancelHolds();
    previous.clear();
  }
  function suspendHolds() {
    waitForNeutral = true;
    reset();
  }
  let connected = false;
  const detect = () => {
    const pad = findPrimaryController(index);
    const nextIndex = pad?.index ?? null;
    if (index !== null && nextIndex !== index) release('disconnect', true);
    index = nextIndex;
    controllerStyle.use(pad);
    const next = Boolean(pad);
    if (next !== connected) {
      connected = next;
      window.dispatchEvent(new CustomEvent('yt-gamepad-connection', { detail: { connected } }));
    }
    return pad;
  };
  const release = (source: string, resetMode = false) => {
    suspendHolds(); mousePosition = null; mouseTravel = { x: 0, y: 0, time: 0 };
    if (resetMode) { lastGamepadAt = -Infinity; lastGamepadAction = ''; }
    if (resetMode) setMode('mouse', source); else trace(source, 'preserve');
  };
  YTGamepadInput = { destroy: lifecycle.destroy, get connected() { return connected; }, get mode() { return inputMode; },
    get recentSources() { return recentSources.map(entry => ({ ...entry })); },
    isHeld: action => [...heldButtons.values()].some(held => held.context === 'media' && held.action === action),
    cancelSeeking() { for (const [button, held] of heldButtons) if (held.context === 'media' && ['seekBack', 'seekForward'].includes(held.action)) endButton(button, 'cancel'); },
    configure(values) { settings = { ...defaults, ...values }; shortcuts = YTGamepadBindings.normalizeShortcuts(values.shortcutLayouts); layouts = YTGamepadBindings.normalizeLayouts(values.bindingLayouts, values.bindings); updateBindings(layouts[activeLayout]); if (settings.enabled) suspendHolds(); else release('disabled', true); } };
  document.documentElement.dataset.ytgInputMode = inputMode;
  document.documentElement.classList.toggle('ytg-gamepad-input', inputMode === 'gamepad');
  let bindings = YTGamepadBindings.normalize();
  let layouts = YTGamepadBindings.normalizeLayouts(), activeLayout = '';
  let shortcuts = YTGamepadBindings.normalizeShortcuts();
  const layoutNow = () => YTGamepadBindings.layoutForPath(globalThis.location?.pathname || '');
  const routeNow = () => (globalThis.location?.pathname || '') + (globalThis.location?.search || '');
  const shortsSwitching = () => document.documentElement.dataset.ytgShortsSwitching !== undefined;
  let lastRoute = routeNow(), lastSearchOpen = false, lastContext: string | undefined;
  activeLayout = layoutNow();
  let pageButtons: Record<number, string>, settingsButtons: Record<number, string>, searchButtons: Record<number, string>;
  let displayedMapping: Record<number, string> | undefined;
  function currentMapping(searchOpen = isSearchOpen()) {
    const mapping = searchOpen ? searchButtons
      : document.querySelector?.('#yt-gamepad-menu')?.hasAttribute('data-settings') ? settingsButtons : pageButtons;
    if (mapping !== displayedMapping) {
      displayedMapping = mapping;
      controllerStyle.configureBindings?.(bindings, mapping);
    }
    return mapping;
  }
  const updateBindings = (raw?: unknown) => {
    document.documentElement.dataset.ytgNavigationStick = settings.rightHandMode ? 'right' : 'left';
    bindings = YTGamepadBindings.normalize(settings.rightHandMode ? YTGamepadBindings.rightHand : raw);
    settingsButtons = YTGamepadBindings.buttonActions(bindings, activeLayout);
    searchButtons = YTGamepadBindings.buttonActions(bindings, activeLayout, undefined, true);
    pageButtons = settings.rightHandMode ? settingsButtons : YTGamepadBindings.buttonActions(bindings, activeLayout, shortcuts[activeLayout]);
    currentMapping();
    window.dispatchEvent(new CustomEvent('yt-gamepad-navigation-stick', { detail: {} }));
  };
  updateBindings();
  function poll(time: number) {
    lifecycle.frame(poll);
    const layout = layoutNow();
    const route = routeNow();
    if (layout !== activeLayout) {
      activeLayout = layout;
      updateBindings(layouts[layout]);
      release('route-change');
    } else if (route !== lastRoute) {
      if (shortsSwitching()) cancelHolds(true);
      else release('route-change');
    }
    lastRoute = route;
    const searchOpen = isSearchOpen();
    const mapping = currentMapping(searchOpen);
    const pad = detect();
    if (!inputAllowed() || document.hidden || !document.hasFocus()) {
      if (!waitForNeutral) release('input-unavailable');
      return;
    }
    if (!pad) return;
    const pressed = new Set(pad.buttons.map((b, i) => b.pressed ? i : -1).filter(i => i >= 0));
    const stick = settings.rightHandMode ? 2 : 0;
    const x = pad.axes[stick] || 0, y = pad.axes[stick + 1] || 0;
    const scrollY = Math.max(-1, Math.min(1, pad.axes[settings.rightHandMode ? 1 : 3] || 0));
    const releaseZone = settings.deadzone * .75;
    const context = inputContext?.();
    if (context !== lastContext || searchOpen !== lastSearchOpen) cancelHolds();
    lastContext = context;
    lastSearchOpen = searchOpen;
    const mediaEnabled = !searchOpen && layout === 'watch' && (canRepeatMedia?.() ?? true);
    if (waitForNeutral) {
      if (Math.max(Math.abs(x), Math.abs(y), scroll ? Math.abs(scrollY) : 0) > releaseZone || [...pressed].some(i => i in mapping || i === 11 || i >= 12 && i <= 15)) return;
      waitForNeutral = false;
      directionNeedsNeutral = false;
      scrollNeedsNeutral = false;
    }
    const frameGeneration = generation;
    function stillOwnsInput() {
      if (generation !== frameGeneration) return false;
      if (!inputAllowed() || document.hidden || !document.hasFocus() || routeNow() !== route) {
        release('input-changed');
        return false;
      }
      const nextSearchOpen = isSearchOpen(), nextContext = inputContext?.();
      if (nextSearchOpen === searchOpen && nextContext === context) return true;
      previous = pressed;
      lastSearchOpen = nextSearchOpen;
      lastContext = nextContext;
      cancelHolds();
      return false;
    }
    for (const [button, action] of Object.entries(mapping)) {
      if (pressed.has(Number(button)) && !previous.has(Number(button))) {
        const context = searchOpen && ['playPause', 'seekBack', 'seekForward'].includes(action) ? 'search'
          : mediaEnabled && mediaActions.includes(action) ? 'media' : null;
        if (context) heldButtons.set(Number(button), { action, next: time + settings.repeatDelay, context });
        emit(action, 'press');
        if (!stillOwnsInput()) return;
      }
    }
    for (const [button, held] of heldButtons) {
      if (held.context === 'media' ? !mediaEnabled : !searchOpen) { endButton(button, 'cancel'); continue; }
      if (!pressed.has(button)) { endButton(button, 'release'); continue; }
      if (time >= held.next) {
        held.next = time + settings.repeatInterval;
        emit(held.action, 'repeat');
        if (!stillOwnsInput()) return;
      }
    }
    let direction = pressed.has(12) ? 'up' : pressed.has(13) ? 'down' : pressed.has(14) ? 'left' : pressed.has(15) ? 'right' : '';
    if (!direction && Math.max(Math.abs(x), Math.abs(y)) > (heldDirection || directionNeedsNeutral ? releaseZone : settings.deadzone)) {
      const horizontal = heldDirection === 'left' || heldDirection === 'right';
      const strengths: Record<string, number> = { left: -x, right: x, up: -y, down: y };
      const heldStrength = strengths[heldDirection] || 0;
      const otherStrength = Math.abs(horizontal ? y : x);
      // Keep the current direction near diagonals until the other axis is clearly stronger.
      direction = heldStrength > releaseZone && otherStrength <= heldStrength * 1.25
        ? heldDirection
        : Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    if (directionNeedsNeutral) {
      if (!direction) directionNeedsNeutral = false;
    } else if (direction !== heldDirection) {
      heldDirection = direction;
      nextRepeat = time + settings.repeatDelay;
      if (direction) {
        emit(direction, 'press');
        if (!stillOwnsInput()) return;
      }
    } else if (direction && time >= nextRepeat) {
      emit(direction, 'repeat'); nextRepeat = time + settings.repeatInterval;
      if (!stillOwnsInput()) return;
    }
    if (Math.abs(scrollY) <= releaseZone) scrollNeedsNeutral = false;
    else if (searchOpen) scrollNeedsNeutral = true;
    if (scroll && !searchOpen && !scrollNeedsNeutral && Math.abs(scrollY) > (scrollTime !== null ? releaseZone : settings.deadzone)) {
      const elapsed = scrollTime === null ? 16 : Math.max(0, Math.min(50, time - scrollTime));
      const strength = Math.max(0, (Math.abs(scrollY) - settings.deadzone) / (1 - settings.deadzone));
      if (scrollTime === null) {
        lastGamepadAt = now(); lastGamepadAction = '';
        setMode('gamepad', 'gamepad-scroll');
      }
      cancelMedia(); stopSpeed();
      scrollTime = time;
      scroll(Math.sign(scrollY) * (120 + 1380 * strength * strength) * elapsed / 1000);
    } else stopScroll();
    // R3 is physical, and never overrides a user's ordinary button binding.
    // Only a fresh press can arm it; cancellation cannot restart a held press.
    if (temporarySpeed && mediaEnabled && scrollTime === null && !mapping[11] && pressed.has(11)) {
      if (!previous.has(11)) speedPress = time;
      if (speedPress !== null && time - speedPress >= 350) {
        lastGamepadAt = now(); lastGamepadAction = '';
        setMode('gamepad', 'gamepad-speed');
        if (!temporarySpeed(true)) stopSpeed();
      }
    } else if (speedPress !== null) stopSpeed();
    previous = pressed;
  }
  lifecycle.listen(document, 'mousemove', e => {
    if (!e.isTrusted) return;
    const dx = e.movementX || (mousePosition ? e.clientX - mousePosition.x : 0);
    const dy = e.movementY || (mousePosition ? e.clientY - mousePosition.y : 0);
    mousePosition = { x: e.clientX, y: e.clientY };
    if (inputMode === 'mouse') return;
    if (!dx && !dy) return;
    const time = e.timeStamp || 0;
    // Bound the entire gesture, rather than chaining small movements indefinitely.
    if (time - mouseTravel.time > 250) mouseTravel = { x: 0, y: 0, time };
    mouseTravel.x += dx; mouseTravel.y += dy;
    if (Math.hypot(mouseTravel.x, mouseTravel.y) >= 24) setMode('mouse', 'mouse-move');
  }, { capture: true, passive: true });
  lifecycle.listen(document, 'pointerdown', e => { if (e.isTrusted && e.pointerType !== 'touch') setMode('mouse', 'pointer-down'); }, true);
  lifecycle.listen(document, 'wheel', e => { if (e.isTrusted) setMode('mouse', 'wheel'); }, { capture: true, passive: true });
  const editable = (target: HTMLElement | null) => !!(target?.isContentEditable || target?.closest?.('input,textarea,select,[role="textbox"],[role="slider"],[role="spinbutton"],[role="combobox"],[contenteditable]:not([contenteditable="false"])'));
  function keyboardEcho(e: KeyboardEvent) {
    const target = (e.composedPath?.()[0] || e.target) as HTMLElement | null;
    if (inputMode !== 'gamepad' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || editable(target) || isSearchOpen() && e.key.length === 1 && e.key !== ' ') return false;
    const action = YTGamepadBindings.keyboardActions[e.key];
    if (!action || action !== lastGamepadAction || now() - lastGamepadAt > 200) return false;
    trace('keyboard-echo', 'ignored');
    return true;
  }
  lifecycle.listen(document, 'keydown', e => {
    if (!e.isTrusted || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    if (keyboardEcho(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    setMode('keyboard', 'keyboard-key');
  }, true);
  const keyboardActions: Record<string, string> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'confirm', ' ': 'playPause', '/': 'search', F1: 'help',
    PageUp: 'seekBack', PageDown: 'seekForward', '-': 'volumeDown', '=': 'volumeUp'
  };
  const inputAllowed = () => settings.enabled && (canHandleInput?.() ?? true);
  lifecycle.listen(window, 'keydown', e => {
    if (!e.isTrusted || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || !inputAllowed()) return;
    const action = keyboardActions[e.key];
    if (!action) return;
    // The deepest target matters for search and settings inside shadow roots.
    const target = (e.composedPath?.()[0] || e.target) as HTMLElement | null;
    // Focused switches use their native Space/Enter activation, rather than
    // treating Space as the global playback shortcut.
    if ((e.key === ' ' || e.key === 'Enter') && target?.closest?.('[role="switch"],[data-shorts-action]')) return;
    if (target?.isContentEditable || target?.closest?.('input,textarea,select,[role="textbox"],[role="slider"],[role="spinbutton"],[role="combobox"],[contenteditable]:not([contenteditable="false"])')) return;
    // Search's physical typing (including its pinyin handler) owns printable keys.
    if (isSearchOpen() && e.key.length === 1) return;
    if (keyboardEcho(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    setMode('keyboard', 'keyboard-action');
    if (e.repeat && !['up', 'down', 'left', 'right'].includes(action)) return;
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action } }));
  }, true);
  // Keep browser context menus on native content; custom surfaces use B/back.
  lifecycle.listen(document, 'contextmenu', e => {
    if (!e.isTrusted || !inputAllowed()) return;
    const owned = e.composedPath?.().some(node => ['ytg-browse-root', 'ytg-browse-grid', 'ytg-watch', 'yt-gamepad-menu'].includes((node as HTMLElement)?.id));
    if (!owned) return;
    e.preventDefault(); e.stopImmediatePropagation(); setMode('mouse', 'context-menu');
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  }, true);
  // Escape uses the same owner and navigation guards as controller B.
  // Capture once above native and shadow handlers; synthetic close events bypass it.
  lifecycle.listen(window, 'keydown', e => {
    if (!e.isTrusted || e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !inputAllowed()) return;
    if ((e.composedPath?.()[0] as HTMLElement | undefined)?.hasAttribute?.('data-shortcut-recorder')) return;
    if (keyboardEcho(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    setMode('keyboard', 'keyboard-escape');
    if (e.repeat) return;
    // The isolated bridge checks browser fullscreen before falling back to back.
    if (window.dispatchEvent(new CustomEvent('yt-gamepad-escape-request', { detail: e, cancelable: true })) === false) return;
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  }, true);
  const escapeBack = (e: Pick<MessageEvent, 'source' | 'origin' | 'data'>) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'yt-gamepad-escape-back') return;
    if (inputAllowed()) window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  };
  if (localChannel) lifecycle.cleanup(localChannel.subscribe(data => escapeBack({ source: window, origin: location.origin, data })));
  else lifecycle.listen(window, 'message', escapeBack);
  lifecycle.listen(document, 'visibilitychange', () => { if (document.hidden) release('hidden'); });
  // Shorts buffer held directions across their own in-place queue changes.
  lifecycle.listen(document, 'ytg-shorts-queue-move', () => {
    const route = routeNow();
    if (!lastRoute.startsWith('/shorts/') || !route.startsWith('/shorts/') || route === lastRoute) return;
    lastRoute = route;
    cancelHolds(true);
  });
  for (const event of ['yt-navigate-start', 'yt-navigate-finish', 'yt-navigate-cancel', 'yt-navigate-error']) {
    lifecycle.listen(document, event, () => {
      if (shortsSwitching()) cancelHolds(true);
      else release(event);
    });
  }
  lifecycle.listen(window, 'popstate', () => release('history'));
  lifecycle.listen(window, 'pagehide', () => release('pagehide'));
  lifecycle.listen(window, 'blur', () => release('blur'));
  lifecycle.listen(window, 'gamepadconnected', detect);
  lifecycle.listen(window, 'gamepaddisconnected', e => {
    detect();
    if (e.gamepad?.index === index) release('disconnect', true);
  });
  lifecycle.frame(poll);
  const published = YTGamepadInput;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (YTGamepadInput === published) YTGamepadInput = undefined; });
  lifecycle.cleanup(() => { settings.enabled = false; reset(); setMode('mouse', 'destroy'); recentSources.length = 0; });
  return published;
  }
  YTGamepadInputModule = { create };
})();
