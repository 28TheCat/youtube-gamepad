(() => {
  window.YTGamepadCoreModule = {
    /** @param {import('../../types/ports.js').CoreDependencies} dependencies */
    create({ runtime, navigation, focusManager, interaction, controllerStyle }) {
  const lifecycle = runtime.scope('core');
  let config = {}, current = null, enabled = true, helpVisible = false, observer, navigating = false;
  let activeScope = document, route = location.pathname + location.search, restoring = false;
  const memories = new Map();
  let restoreTimer, restoreDeadline = 0, browseRestore = {};
  let contentReturn = null, adjustingTarget = null;
  let controllerCardFocus = null;
  function endAdjustment() { adjustingTarget?.classList?.remove('ytg-adjusting'); adjustingTarget = null; }
  const rowFocus = navigation?.createRowFocus?.();
  function returnToContent(list) {
    if (contentReturn?.route !== route) return null;
    return list.find(el => el === contentReturn.el || (config.getSection?.(el) === 'content' && config.getKey?.(el) === contentReturn.key));
  }
  const scopeLayers = [];
  // DOM reads live only for one synchronous action; no stale cross-frame cache.
  let reads = null;
  function withReads(fn) {
    if (reads) return fn();
    reads = { rects: new WeakMap(), styles: new WeakMap(), candidates: new Map() };
    try { return fn(); } finally { reads = null; }
  }
  function rect(el) {
    if (!reads) return el.getBoundingClientRect();
    if (!reads.rects.has(el)) reads.rects.set(el, el.getBoundingClientRect());
    return reads.rects.get(el);
  }
  function computed(el) {
    if (!reads) return getComputedStyle(el);
    if (!reads.styles.has(el)) reads.styles.set(el, getComputedStyle(el));
    return reads.styles.get(el);
  }
  const host = document.createElement('div');
  host.id = 'yt-gamepad-overlay';
  host.setAttribute('lang', 'en');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  lifecycle.cleanup(controllerStyle.register(shadow));
  const style = document.createElement('style');
  style.textContent = `
    #ring{position:fixed;left:0;top:0;border:var(--ytg-focus-width,3px) solid var(--ytg-focus-color,#f1f1f1);border-radius:var(--ytg-card-radius,14px);box-sizing:border-box;display:none}
    /* Finish before the default 140ms held-direction repeat. Scroll updates snap. */
    @media(prefers-reduced-motion:no-preference){#ring{transition:transform var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985)),width var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985)),height var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985))}}
    #help{position:fixed;bottom:var(--ytg-space-6);left:var(--ytg-space-6);background:var(--ytg-overlay-panel);color:var(--ytg-overlay-text);padding:var(--ytg-space-4) var(--ytg-space-5);border-radius:var(--ytg-button-radius);font:var(--ytg-font-small)/1.8 var(--ytg-font-family);display:none;max-width:360px}
  `;
  style.textContent += controllerStyle.css;
  const ring = document.createElement('div'), help = document.createElement('div');
  ring.id = 'ring'; help.id = 'help';
  help.style.whiteSpace = 'pre-line';
  controllerStyle.hint(help, 'YouTube Gamepad\nD-pad / left stick: Select · A: Open\nDuring playback, ↑: Controls · B: Back\nX: Play / pause · Y: Search\nLB / RB: Browse categories, or rewind / forward 10 seconds during playback\nLT / RT: Volume down / up · Start: Quick menu');
  shadow.append(style, ring, help);
  document.documentElement.append(host);
  function visible(el, allowTransparent = false) {
    const r = rect(el), s = computed(el);
    // A suspended native layer still belongs to the stack. Its input is owned
    // by the covering layer, so it must not look like a dismissed dialog.
    const inert = el.closest('[inert]');
    return el.isConnected && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (allowTransparent || s.opacity !== '0') &&
      !el.closest('[hidden],[aria-hidden="true"]') && (!inert || focusManager?.isSuspendedScope(inert));
  }
  function scope() {
    if (reads?.scope) return reads.scope;
    // A dialog owns input from the start of its fade-in, before it becomes opaque.
    const result = Array.from(document.querySelectorAll(config.overlays || '[role="dialog"]')).filter(el => visible(el, true)).at(-1) || document;
    if (reads) reads.scope = result;
    return result;
  }
  function candidates(root = scope()) {
    if (reads?.candidates.has(root)) return reads.candidates.get(root);
    const list = Array.from(root.querySelectorAll(root === document ? (config.selectors || 'a[href],button,input,[role="button"]') : (config.overlayItems || 'a[href],button,input,[role="button"],[role="menuitem"],tp-yt-paper-item'))).filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('#yt-gamepad-overlay'));
    const result = config.filterCandidates?.(list) || list;
    reads?.candidates.set(root, result);
    return result;
  }
  function remember() {
    if (!current || !current.isConnected || activeScope !== document || restoring || navigating || route !== location.pathname + location.search) return;
    memories.set(route, { key: config.getKey?.(current), section: config.getSection?.(current), x: scrollX, y: scrollY,
      keys: candidates().filter(el => config.getSection?.(el) === config.getSection?.(current)).map(el => config.getKey?.(el)),
      browse: config.captureBrowseState?.() });
    if (memories.size > 30) memories.delete(memories.keys().next().value);
  }
  function initial(list) {
    const saved = memories.get(route);
    return (saved?.key && list.find(el => config.getKey?.(el) === saved.key && config.getSection?.(el) === saved.section))
      || list.find(el => (config.getSection?.(el) === config.defaultSection) && inViewport(el))
      || list.find(inViewport) || list[0];
  }
  function inViewport(el) { const r = rect(el); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
  function syncScope() {
    const next = scope();
    if (next === activeScope) return;
    const previous = activeScope;
    endAdjustment();
    // Update the underlying surface before restoring focus into it.
    config.onScopeChange?.(next);
    if (previous === document) remember();
    const parent = next === document ? -1 : scopeLayers.indexOf(next);
    if (next === document || parent >= 0) {
      activeScope = next;
      const closing = scopeLayers.splice(parent + 1).reverse();
      // Restore once, after the entire closed branch has been removed.
      closing.forEach((layer, index) => focusManager?.close(layer, index === closing.length - 1));
    } else {
      const owner = previous === document ? (config.getFocusOwner?.() || 'core') : 'core';
      focusManager?.open(next, owner);
      scopeLayers.push(next);
      activeScope = next;
      if (!config.getPriorityLayer?.()) select(candidates(next)[0], false);
    }
  }
  function recover(alignGamepad = false) {
    if (!reads) return withReads(() => recover(alignGamepad));
    // A view callback can synchronously add/close a native layer during an
    // action. Explicit refresh must observe that new DOM rather than its cache.
    reads.scope = null;
    reads.candidates.clear();
    reads.rects = new WeakMap();
    reads.styles = new WeakMap();
    if (!enabled || navigating || config.isNavigating?.() || route !== location.pathname + location.search) return;
    syncScope();
    if (restoring) {
      lifecycle.clearTimeout(restoreTimer);
      const saved = memories.get(route), expired = Date.now() >= restoreDeadline;
      const ready = !focusManager?.suspended && activeScope === document && !config.getPriorityLayer?.() && !config.isFocusOwned?.();
      const browseReady = ready && (config.restoreBrowseState?.(saved?.browse, browseRestore) !== false);
      if (browseReady || (ready && expired)) {
        const list = candidates().filter(el => config.getSection?.(el) === saved?.section);
        let found = saved?.key && list.find(el => config.getKey?.(el) === saved.key);
        window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
        reads.rects = new WeakMap();
        if (!found && expired) {
          const keys = saved.keys || [], position = keys.indexOf(saved.key);
          for (let distance = 1; !found && position >= 0 && distance < keys.length; distance++) {
            for (const key of [keys[position + distance], keys[position - distance]]) {
              found = list.find(el => key != null && config.getKey?.(el) === key);
              if (found) break;
            }
          }
          found ||= initial(candidates());
        }
        const page = document.scrollingElement;
        const scrollReady = !page || (page.scrollHeight - innerHeight >= saved.y - 1 && page.scrollWidth - innerWidth >= saved.x - 1);
        if (found && (expired || scrollReady)) {
          restoring = false;
          select(found, false);
          update(); return;
        }
      }
      if (ready && expired) restoring = false;
      else {
        restoreTimer = lifecycle.timeout(() => recover(), 100);
        update(); return;
      }
    }
    if (!config.getPriorityLayer?.() && !(activeScope === document && config.isFocusOwned?.()) && current && (!visible(current) || !scope().contains(current))) select(initial(candidates()));
    // Recheck after layout changes or returning to controller input. Wheel
    // scrolling only refreshes the ring; it must never snap the page back.
    if (alignGamepad && !navigating && current && activeScope === document &&
        document.documentElement.classList.contains('ytg-gamepad-input') &&
        !config.getPriorityLayer?.() && !config.isFocusOwned?.() &&
        config.sections?.[config.getSection?.(current)]?.layout === 'grid') alignSelection(current);
    update();
  }
  function update(animate = false) {
    ring.style.transition = animate ? '' : 'none';
    if (!enabled || config.shouldShowSelection?.({ scope: activeScope }) === false || config.getPriorityLayer?.() || !current || config.ownsSelectionPaint?.(current) || !visible(current) || !scope().contains(current)) { ring.style.display = 'none'; return; }
    const target = config.getSelectionTarget?.(current) || config.getContainer?.(current) || current;
    ring.style.borderColor = adjustingTarget === current ? 'var(--ytg-adjusting-color,#fbbf24)' : '';
    ring.style.borderRadius = config.getSelectionRadius?.(current) || 'var(--ytg-card-radius, 14px)';
    const r = rect(target);
    Object.assign(ring.style, { display: 'block', transform: `translate3d(${r.left - 3}px,${r.top - 3}px,0)`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }
  function measure(list) {
    return list.map(el => {
      const section = activeScope === document ? (config.getSection?.(el) || 'content') : 'overlay';
      return { el, section,
        key: config.sections?.[section]?.retainRowFocus ? (config.getKey?.(el) || el) : el,
        row: activeScope === document ? config.getRow?.(el) : null,
        rect: rect(config.getContainer?.(el) || el) };
    });
  }
  function alignSelection(el) {
    const section = config.getSection?.(el) || 'content';
    if (activeScope !== document || config.sections?.[section]?.layout !== 'grid' || config.sections?.[section]?.alignRows === false) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      if (reads) reads.rects = new WeakMap();
      return true;
    }
    const items = measure(candidates()), from = items.find(item => item.el === el);
    if (!from) return;
    const viewport = config.getViewport?.() || { top: 16, bottom: innerHeight - 16 };
    const delta = navigation.rowScroll(from, items, viewport);
    if (Math.abs(delta) > 1) {
      window.scrollTo({ left: scrollX, top: Math.max(0, scrollY + delta), behavior: 'instant' });
      if (reads) reads.rects = new WeakMap();
      return true;
    }
    return false;
  }
  function select(el, scroll = true, keepColumn = false) {
    if (!reads) return withReads(() => select(el, scroll, keepColumn));
    if (el !== current) endAdjustment();
    const scrolled = scroll && el ? alignSelection(el) : false;
    (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    current = el || null;
    if (rowFocus && current && activeScope === document && config.sections?.[config.getSection?.(current)]?.retainRowFocus) {
      const items = measure(candidates()), item = items.find(entry => entry.el === current);
      if (item) rowFocus.remember(item, items, keepColumn);
    }
    (config.getContainer?.(current) || current)?.classList?.add('ytg-selected');
    if (activeScope === document && config.getSection?.(current) === 'content')
      contentReturn = { route, el: current, key: config.getKey?.(current) };
    config.onSelectionChange?.(current, activeScope);
    el?.focus({ preventScroll: true });
    // Track focus we put on a card, so pointer takeover can release it without
    // blurring keyboard targets, text fields or native dialog controls.
    const container = config.getContainer?.(el);
    controllerCardFocus = activeScope === document && el && container && container !== el &&
      document.documentElement.classList.contains('ytg-gamepad-input') &&
      document.activeElement === el ? el : null;
    // Re-read the selected target after class/focus writes, not the whole list.
    if (current) {
      reads.rects.delete(current);
      reads.rects.delete(config.getSelectionTarget?.(current) || config.getContainer?.(current) || current);
      reads.styles.delete(current);
    }
    update(!scrolled);
    remember();
  }
  function navigate(direction) {
    if (!reads) return withReads(() => navigate(direction));
    syncScope();
    restoring = false;
    const list = candidates();
    if (!list.includes(current)) {
      select(initial(list));
      return;
    }
    const items = measure(list);
    const from = items.find(item => item.el === current);
    let best = navigation.choose(from, items, direction, activeScope === document ? config.sections : { overlay: {} }, rowFocus);
    if (activeScope === document && config.rememberRegionReturn?.() &&
      ((from.section === 'sidebar' && direction === 'right') || (from.section === 'header' && direction === 'down'))) {
      const saved = returnToContent(list);
      if (saved && (!best || best.section === 'content')) best = items.find(item => item.el === saved);
    }
    if (best) select(best.el, true, true);
    // No target means stay on the current card; never scroll by an arbitrary distance.
  }
  // A layer must explicitly pass an action before a lower layer can see it.
  const outcome = result => result === 'handled' ? 'handled' : result === 'pass' ? 'pass' : 'blocked';
  function pageAction(action) {
    if (adjustingTarget && (adjustingTarget !== current || !visible(current) || !scope().contains(current))) endAdjustment();
    if (adjustingTarget) {
      if (action === 'confirm' || action === 'back') { endAdjustment(); update(); return 'handled'; }
      if (action === 'left' || action === 'right') { config.adjustSlider?.(current, action === 'left' ? -1 : 1); return 'handled'; }
      return 'blocked';
    }
    if (action === 'back' && activeScope === document && config.rememberRegionReturn?.() && ['sidebar', 'header'].includes(config.getSection?.(current))) {
      const list = candidates();
      const target = returnToContent(list) || list.find(el => config.getSection?.(el) === 'content' && inViewport(el));
      if (target) { select(target); return 'handled'; }
    }
    if (['up', 'down', 'left', 'right'].includes(action)) { navigate(action); return 'handled'; }
    if (action === 'confirm') {
      if (!current || !visible(current) || !scope().contains(current)) select(initial(candidates()));
      remember();
      if (current && config.isSlider?.(current)) {
        adjustingTarget = current; current.classList?.add('ytg-adjusting'); update(); return 'handled';
      }
      if (current && config.beforeActivate?.(current) === true) return 'handled';
      if (!current) return 'blocked';
      current.click(); return 'handled';
    }
    remember();
    const result = config.onAction?.(action, { scope: activeScope, current });
    // Older site callbacks consumed an action without returning a result.
    return result === undefined ? (config.onAction ? 'handled' : 'pass') : outcome(result);
  }
  function act(action) {
    if (lifecycle.destroyed) return 'blocked';
    if (!reads) return withReads(() => act(action));
    const priority = config.getPriorityLayer?.();
    const result = interaction.dispatch({ type: 'INPUT_OWNER', action,
      enabled, navigating: navigating || config.isNavigating?.(), menu: !!priority,
      native: scope() !== document, panel: !!config.getInputLayer?.(), help: helpVisible });
    if (result.disposition === 'blocked') return 'blocked';
    const owner = result.effects[0]?.value;
    if (owner === 'menu') {
      const handled = outcome(priority.handle(action));
      return handled === 'pass' ? 'blocked' : handled;
    }
    syncScope();
    if (owner === 'native') return pageAction(action);
    if (owner === 'panel') {
      const handled = outcome(config.handleLayer?.(action));
      return handled === 'pass' ? 'blocked' : handled;
    }
    if (owner === 'help') {
      if (action === 'back' || action === 'help') { helpVisible = false; help.style.display = 'none'; return 'handled'; }
      return 'blocked';
    }
    // Shortcut policy lives outside the navigation core.
    if (config.handleShortcut) {
      const result = outcome(config.handleShortcut(action));
      if (result !== 'pass') return result;
    }
    if (action === 'help') { helpVisible = true; help.style.display = 'block'; return 'handled'; }
    if (config.handleRegion) {
      const result = outcome(config.handleRegion(action, { current, scope: activeScope }));
      if (result !== 'pass') { update(); return result; }
    }
    if (config.handleBase) {
      const result = outcome(config.handleBase(action, { current, scope: activeScope }));
      if (result !== 'pass') { update(); return result; }
    } else if (config.interceptAction?.(action, { current })) { update(); return 'handled'; }
    return pageAction(action);
  }
  window.YTGamepad = {
    registerSite(values) { endAdjustment(); config = values; current = null; rowFocus?.reset(); },
    configure(values) { if (values.enabled === false) endAdjustment(); enabled = values.enabled !== false; if (!enabled) { (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected'); current = null; config.onSelectionChange?.(null, document); config.onDisable?.(); help.style.display = 'none'; helpVisible = false; } update(); },
    navigate, act,
    focus(el) { if (el && candidates().includes(el)) select(el, false); },
    resetContentFocus() {
      restoring = false; lifecycle.clearTimeout(restoreTimer);
      rowFocus?.reset();
      contentReturn = null; memories.delete(route);
      select(candidates().find(el => config.getSection?.(el) === 'content'));
    },
    refresh: recover,
    get hasTemporaryLayer() { return helpVisible || scope() !== document; },
    get hasOverlay() { return activeScope !== document; },
    get current() { return current; }, get section() { return config.getSection?.(current); },
    get restoring() { return restoring; }
  };
  const unregisterFocus = focusManager?.register('core', {
    active: () => enabled && (activeScope !== document || !config.isFocusOwned?.()),
    capture() {
      const list = candidates(activeScope);
      const el = list.includes(document.activeElement) ? document.activeElement : current;
      if (!el || !list.includes(el)) return null;
      return { region: activeScope === document ? config.getSection?.(el) || 'content' : 'overlay',
        itemKey: config.getKey?.(el) || el, index: list.indexOf(el), scope: activeScope };
    },
    items(region, target) {
      if (target.scope !== activeScope) return [];
      return candidates(activeScope).filter(el => activeScope !== document || (config.getSection?.(el) || 'content') === region)
        .map(el => ({ region, itemKey: config.getKey?.(el) || el, el }));
    },
    fallback() { return { el: initial(candidates(activeScope)) }; },
    apply(target) { select(target?.el, false); }
  });
  if (unregisterFocus) lifecycle.cleanup(unregisterFocus);
  lifecycle.listen(window, 'yt-gamepad-action', e => { if (typeof e.detail?.action === 'string') act(e.detail.action); });
  lifecycle.listen(document, 'focusin', e => withReads(() => { if (enabled && current !== e.target && candidates().includes(e.target)) select(e.target, false); }));
  lifecycle.listen(document, 'yt-navigate-start', () => { remember(); navigating = true; });
  for (const event of ['yt-navigate-finish', 'yt-navigate-cancel', 'yt-navigate-error']) lifecycle.listen(document, event, () => { navigating = false; });
  function routeChanged(event) {
    if (!event || event.type === 'yt-navigate-finish') navigating = false;
    const next = location.pathname + location.search;
    if (next === route) { recover(); return; }
    const focused = current || document.activeElement;
    const sidebarKey = config.getSection?.(focused) === 'sidebar' ? config.getKey?.(focused) : null;
    (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    endAdjustment();
    route = next; current = null; contentReturn = null; activeScope = document;
    rowFocus?.reset();
    scopeLayers.splice(0).forEach(layer => focusManager?.close(layer, false));
    if (sidebarKey && !config.rememberRegionReturn?.()) current = candidates().find(el => config.getSection?.(el) === 'sidebar' && config.getKey?.(el) === sidebarKey) || null;
    const restoreExpected = memories.has(route);
    restoring = restoreExpected;
    lifecycle.clearTimeout(restoreTimer); restoreDeadline = Date.now() + 5000; browseRestore = {};
    recover();
    if (enabled && !restoreExpected && !config.getPriorityLayer?.() && !config.isFocusOwned?.() && config.rememberRegionReturn?.()) published.resetContentFocus();
  }
  lifecycle.listen(document, 'yt-navigate-finish', routeChanged);
  lifecycle.listen(window, 'popstate', routeChanged);
  let pending = false, pendingAlignment = false;
  function scheduleRecover(alignGamepad = false) {
    if (!enabled || document.hidden) return;
    pendingAlignment ||= alignGamepad === true;
    if (pending) return;
    pending = true;
    lifecycle.frame(() => {
      const align = pendingAlignment;
      pending = false; pendingAlignment = false;
      if (!document.hidden) recover(align);
    });
  }
  lifecycle.listen(window, 'scroll', () => { scheduleRecover(); remember(); }, true);
  lifecycle.listen(window, 'resize', () => scheduleRecover(true));
  lifecycle.listen(window, 'yt-gamepad-input-mode', event => {
    const mode = event.detail?.mode;
    if (mode !== 'gamepad') {
      const target = controllerCardFocus;
      controllerCardFocus = null;
      // The native focus ring is no longer suppressed in mouse mode. Remove
      // only our own lingering DOM focus; keep current for controller return.
      if (mode === 'mouse' && target && document.activeElement === target) target.blur();
    }
    scheduleRecover(mode === 'gamepad');
  });
  lifecycle.listen(document, 'visibilitychange', () => { if (!document.hidden) scheduleRecover(); });
  observer = lifecycle.observer(records => {
    if (!enabled || document.hidden || pending || records.every(record => host.contains(record.target) ||
      record.target.closest?.('#ytg-watch,#yt-gamepad-menu') || config.ignoreMutation?.(record) ||
      (record.type === 'attributes' && record.attributeName === 'class' &&
        (record.oldValue || '').replace(/\bytg-selected\b/g, '').trim() ===
        (record.target.getAttribute('class') || '').replace(/\bytg-selected\b/g, '').trim()))) return;
    scheduleRecover(true);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'aria-hidden', 'aria-expanded', 'style', 'class'] });
  const published = window.YTGamepad;
  published.destroy = lifecycle.destroy;
  lifecycle.cleanup(() => { if (window.YTGamepad === published) delete window.YTGamepad; });
  lifecycle.cleanup(() => {
    endAdjustment();
    enabled = false; (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    scopeLayers.splice(0).forEach(layer => focusManager?.close(layer, false));
    current = null; memories.clear(); contentReturn = null; host.remove?.();
  });
  return published;
  } };
})();
