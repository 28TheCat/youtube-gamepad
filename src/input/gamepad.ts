import type { InputDependencies, InputModule, ModuleFactory } from '../../types/ports';
import { YTGamepadBindings } from './bindings.ts';
export let YTGamepadInput: InputModule | undefined, YTGamepadInputModule!: ModuleFactory<InputDependencies,InputModule>;
(() => {
  /** @param {import('../../types/ports.js').InputDependencies} dependencies */
  function create({ runtime, controllerStyle, isSearchOpen, localChannel, temporarySpeed, canRepeatMedia }: import('../../types/ports.js').InputDependencies) {
  const lifecycle = runtime.scope('input');
  const defaults = { enabled: true, rightHandMode: false, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140 };
  let settings = { ...defaults }, previous = new Set(), heldDirection = '', nextRepeat = 0, index: number|null = null;
  let inputMode: 'gamepad' | 'mouse' | 'keyboard' = 'mouse', mousePosition: { x: number; y: number; }|null = null, mouseTravel = { x: 0, y: 0, time: 0 }, waitForNeutral = false, suspended = false;
  let speedPress: number | null = null;
  const stopSpeed = () => { if (speedPress !== null) temporarySpeed?.(false); speedPress = null; };
  function setMode(value: 'gamepad' | 'mouse' | 'keyboard') {
    if (inputMode === value) return;
    const previousMode = inputMode;
    inputMode = value;
    mouseTravel = { x: 0, y: 0, time: 0 };
    document.documentElement.classList.toggle('ytg-gamepad-input', value === 'gamepad');
    document.documentElement.dataset.ytgInputMode = value;
    if (value !== 'gamepad') { waitForNeutral = true; stopSpeed(); cancelMedia(); }
    window.dispatchEvent(new CustomEvent('yt-gamepad-input-mode', { detail: { mode: value, previousMode } }));
  }
  const emit = (action: unknown) => {
    if (!mediaActions.includes(String(action))) cancelMedia();
    stopSpeed();
    if (suspended) {
      suspended = false;
      window.dispatchEvent(new CustomEvent('yt-gamepad-resume', { detail: {} }));
    }
    setMode('gamepad');
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
      if (!connected) exit('disconnect');
      window.dispatchEvent(new CustomEvent('yt-gamepad-connection', { detail: { connected } }));
    }
    return pad;
  };
  const release = () => { reset(); waitForNeutral = true; mousePosition = null; setMode('mouse'); };
  function exit(reason: string) {
    suspended = true;
    release();
    window.dispatchEvent(new CustomEvent('yt-gamepad-exit', { detail: { reason } }));
  }
  YTGamepadInput = { destroy: lifecycle.destroy, get connected() { return connected; }, get mode() { return inputMode; },
    isHeld: action => [...heldButtons.values()].some(held => held.context === 'media' && held.action === action),
    cancelSeeking() { for (const [button, held] of heldButtons) if (held.context === 'media' && ['seekBack', 'seekForward'].includes(held.action)) endButton(button, true); },
    configure(values) { settings = { ...defaults, ...values }; layouts = YTGamepadBindings.normalizeLayouts(values.bindingLayouts, values.bindings); updateBindings(layouts[activeLayout]); reset(); waitForNeutral = true; if (!settings.enabled) release(); } };
  document.documentElement.dataset.ytgInputMode = inputMode;
  let bindings = YTGamepadBindings.normalize();
  let layouts = YTGamepadBindings.normalizeLayouts(), activeLayout = '';
  const layoutNow = () => globalThis.location?.pathname === '/watch' ? 'watch' : 'browse';
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
      if (Math.max(Math.abs(x), Math.abs(y)) > releaseZone || [...pressed].some(i => i in buttons || [6, 7, 10, 11, 12, 13, 14, 15].includes(i))) return;
      waitForNeutral = false;
      reset(); index = pad.index;
    }
    const searchOpen = isSearchOpen();
    const mediaEnabled = !searchOpen && layout === 'watch' && (canRepeatMedia?.() ?? true);
    const mapping = searchOpen ? { ...buttons, [bindings.keyboardSymbols]: 'keyboardSymbols', [bindings.keyboardCandidates]: 'keyboardCandidates' } : buttons;
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
    if (temporarySpeed && layout === 'watch' && !searchOpen && !buttons[11] && pressed.has(11)) {
      if (!previous.has(11)) speedPress = time;
      if (speedPress !== null && time - speedPress >= 350) {
        setMode('gamepad');
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
    if (!dx && !dy) return;
    const time = e.timeStamp || 0;
    if (time - mouseTravel.time > 250) mouseTravel = { x: 0, y: 0, time };
    mouseTravel.x += dx; mouseTravel.y += dy; mouseTravel.time = time;
    if (Math.hypot(mouseTravel.x, mouseTravel.y) >= 8) setMode('mouse');
  }, { capture: true, passive: true });
  lifecycle.listen(document, 'pointerdown', e => { if (e.isTrusted && e.pointerType !== 'touch') setMode('mouse'); }, true);
  lifecycle.listen(document, 'wheel', e => { if (e.isTrusted) setMode('mouse'); }, { capture: true, passive: true });
  lifecycle.listen(document, 'keydown', e => { if (e.isTrusted && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) setMode('keyboard'); }, true);
  // Escape uses the same owner and navigation guards as controller B.
  // Capture once above native and shadow handlers; synthetic close events bypass it.
  lifecycle.listen(window, 'keydown', e => {
    if (!e.isTrusted || e.key !== 'Escape' || e.defaultPrevented || !settings.enabled || !detect() || suspended) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    // The isolated bridge checks browser fullscreen before falling back to back.
    if (window.dispatchEvent(new CustomEvent('yt-gamepad-escape-request', { detail: e, cancelable: true })) === false) return;
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  }, true);
  const escapeBack = (e: Pick<MessageEvent, 'source' | 'origin' | 'data'>) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'yt-gamepad-escape-back') return;
    if (settings.enabled && detect() && !suspended) window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  };
  if (localChannel) lifecycle.cleanup(localChannel.subscribe(data => escapeBack({ source: window, origin: location.origin, data })));
  else lifecycle.listen(window, 'message', escapeBack);
  lifecycle.listen(document, 'visibilitychange', () => { if (document.hidden) release(); });
  lifecycle.listen(document, 'yt-navigate-start', release);
  lifecycle.listen(document, 'yt-navigate-finish', release);
  lifecycle.listen(window, 'popstate', release);
  lifecycle.listen(window, 'pagehide', release);
  lifecycle.listen(window, 'blur', release);
  lifecycle.listen(window, 'gamepadconnected', detect);
  lifecycle.listen(window, 'gamepaddisconnected', e => {
    if (e.gamepad?.index === index) exit('disconnect');
    detect();
  });
  lifecycle.frame(poll);
  const published = YTGamepadInput;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (YTGamepadInput === published) YTGamepadInput = undefined; });
  lifecycle.cleanup(() => { settings.enabled = false; reset(); setMode('mouse'); });
  return published;
  }
  YTGamepadInputModule = { create };
})();
