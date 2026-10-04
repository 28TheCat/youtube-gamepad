(() => {
  if (window.YTGamepadInput) return;
  const lifecycle = window.YTGamepadRuntime.scope('input');
  const defaults = { enabled: true, deadzone: 0.35, repeatDelay: 350, repeatInterval: 140 };
  let settings = { ...defaults }, previous = new Set(), heldDirection = '', nextRepeat = 0, index = null;
  let inputMode = 'mouse', mousePosition = null, mouseTravel = { x: 0, y: 0, time: 0 }, waitForNeutral = false, suspended = false;
  function setMode(value) {
    if (inputMode === value) return;
    const previousMode = inputMode;
    inputMode = value;
    mouseTravel = { x: 0, y: 0, time: 0 };
    document.documentElement.classList.toggle('ytg-gamepad-input', value === 'gamepad');
    document.documentElement.dataset.ytgInputMode = value;
    if (value !== 'gamepad') waitForNeutral = true;
    window.dispatchEvent(new CustomEvent('yt-gamepad-input-mode', { detail: { mode: value, previousMode } }));
  }
  const emit = (action) => {
    if (suspended) {
      suspended = false;
      window.dispatchEvent(new CustomEvent('yt-gamepad-resume', { detail: {} }));
    }
    setMode('gamepad');
    window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action } }));
  };
  const reset = () => { previous.clear(); heldDirection = ''; heldButtons.clear(); index = null; };
  const heldButtons = new Map();
  let connected = false;
  const detect = () => {
    const pad = Array.from(navigator.getGamepads?.() || []).find(p => p?.connected && p.mapping === 'standard');
    const next = Boolean(pad);
    if (next !== connected) {
      connected = next;
      if (!connected) exit('disconnect');
      window.dispatchEvent(new CustomEvent('yt-gamepad-connection', { detail: { connected } }));
    }
    return pad;
  };
  const release = () => { reset(); waitForNeutral = true; mousePosition = null; setMode('mouse'); };
  function exit(reason) {
    suspended = true;
    release();
    window.dispatchEvent(new CustomEvent('yt-gamepad-exit', { detail: { reason } }));
  }
  window.YTGamepadInput = { get connected() { return connected; }, get mode() { return inputMode; }, configure(values) { settings = { ...defaults, ...values }; reset(); if (!settings.enabled) release(); } };
  document.documentElement.dataset.ytgInputMode = inputMode;
  const buttons = { 0: 'confirm', 1: 'back', 2: 'playPause', 3: 'search', 4: 'seekBack', 5: 'seekForward', 9: 'help' };
  function poll(time) {
    lifecycle.frame(poll);
    const pad = detect();
    if (!settings.enabled || document.hidden || !document.hasFocus()) { reset(); return; }
    if (!pad) { reset(); return; }
    if (index !== pad.index) { reset(); index = pad.index; }
    const pressed = new Set(pad.buttons.map((b, i) => b.pressed ? i : -1).filter(i => i >= 0));
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    const releaseZone = settings.deadzone * .75;
    if (waitForNeutral) {
      if (Math.max(Math.abs(x), Math.abs(y)) > releaseZone || [...pressed].some(i => i in buttons || [6, 7, 10, 11, 12, 13, 14, 15].includes(i))) return;
      waitForNeutral = false;
      reset(); index = pad.index;
    }
    const searchOpen = window.YTGamepadMenu?.opened && window.YTGamepadMenu.state.view === 'search';
    const mapping = searchOpen ? { ...buttons, 10: 'keyboardSymbols', 11: 'keyboardCandidates' } : buttons;
    for (const [button, action] of Object.entries(mapping)) {
      if (pressed.has(Number(button)) && !previous.has(Number(button))) emit(action);
    }
    for (const button of [2, 4, 5]) {
      if (!searchOpen || !pressed.has(button)) { heldButtons.delete(button); continue; }
      if (!previous.has(button) || !heldButtons.has(button)) heldButtons.set(button, time + settings.repeatDelay);
      else if (time >= heldButtons.get(button)) { emit(buttons[button]); heldButtons.set(button, time + settings.repeatInterval); }
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
    if (pressed.has(7) && !previous.has(7)) emit('volumeUp');
    if (pressed.has(6) && !previous.has(6)) emit('volumeDown');
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
    if (!e.isTrusted || e.key !== 'Escape' || e.defaultPrevented || !settings.enabled || suspended) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) window.dispatchEvent(new CustomEvent('yt-gamepad-action', { detail: { action: 'back' } }));
  }, true);
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
  const published = window.YTGamepadInput;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepadInput === published) delete window.YTGamepadInput; });
  lifecycle.cleanup(() => { settings.enabled = false; reset(); setMode('mouse'); });
})();
