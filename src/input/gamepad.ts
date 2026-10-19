import type { InputDependencies, InputModule, ModuleFactory } from '../../types/ports';
import { YTGamepadBindings } from './bindings.ts';
export let YTGamepadInput: InputModule | undefined, YTGamepadInputModule!: ModuleFactory<InputDependencies,InputModule>;
(() => {
  /** @param {import('../../types/ports.js').InputDependencies} dependencies */
  function create({ runtime, controllerStyle, isSearchOpen, localChannel, temporarySpeed, canRepeatMedia, canHandleInput }: import('../../types/ports.js').InputDependencies) {
  const lifecycle = runtime.scope('input');
  const defaults = { enabled: true, rightHandMode: false, deadzone: 0.35, repeatDelay: 150, repeatInterval: 80 };
  let settings = { ...defaults }, previous = new Set(), heldDirection = '', nextRepeat = 0, index: number|null = null;
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
  let speedRoute = '';
  const stopSpeed = () => { if (speedPress !== null) temporarySpeed?.(false); speedPress = null; };
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
    if (value !== 'gamepad') { waitForNeutral = true; stopSpeed(); cancelMedia(); }
    window.dispatchEvent(new CustomEvent('yt-gamepad-input-mode', { detail: { mode: value, previousMode, source } }));
  }
  const emit = (action: unknown) => {
    if (!mediaActions.includes(String(action))) cancelMedia();
    stopSpeed();
    lastGamepadAt = now(); lastGamepadAction = String(action);
    setMode('gamepad', 'gamepad-action');
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action } }));
  };
  const mediaActions = ['seekBack', 'seekForward', 'volumeDown', 'volumeUp'];
  const heldButtons = new Map<number, { action: string; next: number; context: 'search' | 'media' }>();
  function endButton(button: number, cancelled: boolean) {
    const held = heldButtons.get(button);
    heldButtons.delete(button);
    if (held?.context === 'media') window.dispatchEvent(new CustomEvent('yt-gamepad-button-end', { detail: { action: held.action, cancelled } }));
  }
  function cancelMedia() { for (const [button, held] of heldButtons) if (held.context === 'media') endButton(button, true); }
  const reset = () => { stopSpeed(); cancelMedia(); previous.clear(); heldDirection = ''; heldButtons.clear(); index = null; };
  let connected = false;
  const detect = () => {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected && p.mapping === 'standard').filter((p): p is Gamepad => p !== null);
    const active = (p: Gamepad) => p.buttons.some((b) => b.pressed) ||
      p.axes.slice(settings.rightHandMode ? 2 : 0, settings.rightHandMode ? 4 : 2).some((axis) => Math.abs(axis) > settings.deadzone);
    const current = pads.find(p => p.index === index);
    const pad = (current && active(current) ? current : pads.find(active)) || current || pads[0];
    controllerStyle.use(pad);
    const next = Boolean(pad);
    if (next !== connected) {
      connected = next;
      if (!connected) release('disconnect', true);
      window.dispatchEvent(new CustomEvent('yt-gamepad-connection', { detail: { connected } }));
    }
    return pad;
  };
  const release = (source: string, resetMode = false) => {
    reset(); waitForNeutral = true; mousePosition = null; mouseTravel = { x: 0, y: 0, time: 0 };
    if (resetMode) { lastGamepadAt = -Infinity; lastGamepadAction = ''; }
    if (resetMode) setMode('mouse', source); else trace(source, 'preserve');
  };
  YTGamepadInput = { destroy: lifecycle.destroy, get connected() { return connected; }, get mode() { return inputMode; },
    get recentSources() { return recentSources.map(entry => ({ ...entry })); },
    isHeld: action => [...heldButtons.values()].some(held => held.context === 'media' && held.action === action),
    cancelSeeking() { for (const [button, held] of heldButtons) if (held.context === 'media' && ['seekBack', 'seekForward'].includes(held.action)) endButton(button, true); },
    configure(values) { settings = { ...defaults, ...values }; shortcuts = YTGamepadBindings.normalizeShortcuts(values.shortcutLayouts); layouts = YTGamepadBindings.normalizeLayouts(values.bindingLayouts, values.bindings); updateBindings(layouts[activeLayout]); reset(); waitForNeutral = true; if (!settings.enabled) release('disabled', true); } };
  document.documentElement.dataset.ytgInputMode = inputMode;
  document.documentElement.classList.toggle('ytg-gamepad-input', inputMode === 'gamepad');
  let bindings = YTGamepadBindings.normalize();
  let layouts = YTGamepadBindings.normalizeLayouts(), activeLayout = '';
  let shortcuts = YTGamepadBindings.normalizeShortcuts();
  const layoutNow = () => globalThis.location?.pathname === '/watch' || globalThis.location?.pathname.startsWith('/shorts/') ? 'watch' : 'browse';
  activeLayout = layoutNow();
  let buttons: Record<number,string> = {};
  const updateBindings = (raw?: unknown) => {
    document.documentElement.dataset.ytgNavigationStick = settings.rightHandMode ? 'right' : 'left';
    bindings = YTGamepadBindings.normalize(settings.rightHandMode ? YTGamepadBindings.rightHand : raw);
    buttons = Object.fromEntries(Object.entries(bindings).filter(([action]) => !action.startsWith('keyboard')).map(([action, button]) => [button, action]));
    controllerStyle.configureBindings?.(bindings);
    window.dispatchEvent(new CustomEvent('yt-gamepad-navigation-stick', { detail: {} }));
  };
  updateBindings();
  function poll(time: number) {
    lifecycle.frame(poll);
    const layout = layoutNow();
    if (layout !== activeLayout) {
      activeLayout = layout; updateBindings(layouts[layout]); reset(); waitForNeutral = true;
    }
    const pad = detect();
    if (!settings.enabled || document.hidden || !document.hasFocus()) { reset(); return; }
    if (!pad) { reset(); return; }
    if (index !== pad.index) { reset(); index = pad.index; }
    const pressed = new Set(pad.buttons.map((b, i) => b.pressed ? i : -1).filter(i => i >= 0));
    const stick = settings.rightHandMode ? 2 : 0;
    const x = pad.axes[stick] || 0, y = pad.axes[stick + 1] || 0;
    const releaseZone = settings.deadzone * .75;
    if (waitForNeutral) {
      if (Math.max(Math.abs(x), Math.abs(y)) > releaseZone || [...pressed].some(i => i in buttons || [6, 7, 8, 10, 11, 12, 13, 14, 15].includes(i))) return;
      waitForNeutral = false;
      reset(); index = pad.index;
    }
    const searchOpen = isSearchOpen();
    const mediaEnabled = !searchOpen && layout === 'watch' && (canRepeatMedia?.() ?? true);
    const mapping = searchOpen ? { ...buttons, [bindings.keyboardSymbols]: 'keyboardSymbols', [bindings.keyboardCandidates]: 'keyboardCandidates' } : { ...buttons };
    // Keep configuration navigable even when A/B have custom page shortcuts.
    if (!settings.rightHandMode && !document.querySelector?.('#yt-gamepad-menu')?.hasAttribute('data-settings')) {
      for (const [key, shortcut] of Object.entries(shortcuts[layout] || {})) {
        const button = Object.keys(YTGamepadBindings.keys).find(index => YTGamepadBindings.keys[Number(index)] === key);
        if (button !== undefined) mapping[Number(button)] = YTGamepadBindings.keyboardActions[shortcut];
      }
    }
    for (const [button, action] of Object.entries(mapping)) {
      if (pressed.has(Number(button)) && !previous.has(Number(button))) {
        const context = searchOpen && ['playPause', 'seekBack', 'seekForward'].includes(action) ? 'search'
          : mediaEnabled && mediaActions.includes(action) ? 'media' : null;
        if (context) heldButtons.set(Number(button), { action, next: time + settings.repeatDelay, context });
        emit(action);
      }
    }
    for (const [button, held] of heldButtons) {
      if (held.context === 'media' ? !mediaEnabled : !searchOpen) { endButton(button, true); continue; }
      if (!pressed.has(button)) { endButton(button, false); continue; }
      if (time >= held.next) { held.next = time + settings.repeatInterval; emit(held.action); }
    }
    let direction = pressed.has(12) ? 'up' : pressed.has(13) ? 'down' : pressed.has(14) ? 'left' : pressed.has(15) ? 'right' : '';
    if (!direction && Math.max(Math.abs(x), Math.abs(y)) > (heldDirection ? releaseZone : settings.deadzone)) {
      direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    }
    if (direction !== heldDirection) {
      heldDirection = direction;
      nextRepeat = time + settings.repeatDelay;
      if (direction) emit(direction);
    } else if (direction && time >= nextRepeat) {
      emit(direction); nextRepeat = time + settings.repeatInterval;
    }
    // R3 is physical, and never overrides a user's ordinary button binding.
    // Only a fresh press can arm it; cancellation cannot restart a held press.
    if (temporarySpeed && layout === 'watch' && !searchOpen && !mapping[11] && pressed.has(11)) {
      const route = location.pathname + location.search;
      if (!previous.has(11)) { speedPress = time; speedRoute = route; }
      if (speedPress !== null && route !== speedRoute) stopSpeed();
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
  lifecycle.listen(document, 'yt-navigate-start', () => {
    if (document.documentElement.dataset.ytgShortsSwitching === undefined) release('route-start');
    else { stopSpeed(); cancelMedia(); }
  });
  lifecycle.listen(document, 'yt-navigate-finish', () => { if (document.documentElement.dataset.ytgShortsSwitching === undefined) release('route-finish'); });
  lifecycle.listen(window, 'popstate', () => release('history'));
  lifecycle.listen(window, 'pagehide', () => release('pagehide'));
  lifecycle.listen(window, 'blur', () => release('blur'));
  lifecycle.listen(window, 'gamepadconnected', detect);
  lifecycle.listen(window, 'gamepaddisconnected', e => {
    if (e.gamepad?.index === index) release('disconnect', true);
    detect();
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
