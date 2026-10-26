import { pageShadowRoots, pageActiveElement, pageQuery, pageQueryAll } from '../shared/page-dom';
import { createStickScroller } from './stick-scroll';
import type { Action, CoreDependencies, CoreModule, Direction, ModuleFactory, MeasuredItem } from '../../types/ports';

import type { NavigationConfig, NavigationRoot, NavigationMemory, BrowseRestore, OverlayView, NavigationReads } from '../../types/core';
export let YTGamepadCoreModule!: ModuleFactory<CoreDependencies,CoreModule>, YTGamepad: CoreModule | undefined;
(() => {
  YTGamepadCoreModule = {
    /** @param {import('../../types/ports.js').CoreDependencies} dependencies */
    create({ runtime, navigation, focusManager, interaction, controllerStyle, mountOverlay }: import('../../types/ports.js').CoreDependencies) {
  const lifecycle = runtime.scope('core');
  const stickScroller = createStickScroller(lifecycle);
  let config: NavigationConfig = {}, current: HTMLElement | null = null, enabled = true, helpVisible = false, observer: MutationObserver | undefined, browseObserver: MutationObserver | undefined, navigating = false;
  let activeScope: NavigationRoot = document, route = location.pathname + location.search, restoring = false;
  const memories: Map<string, NavigationMemory> = new Map();
  let restoreTimer: number|undefined, restoreDeadline = 0, browseRestore: BrowseRestore = {};
  let contentReturn: {route:string;el:HTMLElement;key?:string|Element} | null = null, adjustingTarget: HTMLElement | null = null;
  let controllerCardFocus: HTMLElement | null = null;
  const indexedGrid = (el: HTMLElement | null | undefined) => el?.dataset?.browseId ? el.closest<HTMLElement>('[data-ytg-indexed-feed]') : null;
  function endAdjustment() { adjustingTarget?.classList?.remove('ytg-adjusting'); adjustingTarget = null; }
  const rowFocus = navigation?.createRowFocus?.();
  function returnToContent(list: HTMLElement[]) {
    const saved = contentReturn;
    if (!saved || saved.route !== route) return null;
    return list.find((el) => el === saved.el || (config.getSection?.(el) === 'content' && config.getKey?.(el) === saved.key));
  }
  const scopeLayers: NavigationRoot[] = [];
  const scopeViews: Map<NavigationRoot, OverlayView[]> = new Map();
  type TargetIdentity = { key: string | Element | undefined; section: string; occurrence: number };
  type TargetIndex = { list: import('../../types/core').InteractiveElement[];
    identities: Map<HTMLElement, TargetIdentity>; positions: Map<HTMLElement, number>;
    keys: Map<string, (string | Element | undefined)[]> };
  const targetIndexes = new Map<NavigationRoot, TargetIndex>();
  const overlayKeys = new Map<NavigationRoot, string | null | undefined>();
  let measurements = new WeakMap<HTMLElement[], MeasuredItem[]>();
  function invalidateGeometry() {
    measurements = new WeakMap();
    if (reads) { reads.rects = new WeakMap(); reads.styles = new WeakMap(); }
  }
  function invalidateTargets() {
    targetIndexes.clear(); overlayKeys.clear(); invalidateGeometry();
    if (reads) { reads.candidates.clear(); reads.scope = null; }
  }
  function relevantMutation(record: MutationRecord) {
    if (host.contains(record.target) || (record.target as HTMLElement).closest?.('#ytg-watch,#yt-gamepad-menu') || config.ignoreMutation?.(record)) return false;
    if (record.type === 'attributes' && record.attributeName === 'class') {
      const strip = (value: string) => value.replace(/\bytg-(?:selected|adjusting)\b/g, '').trim();
      if (strip(record.oldValue || '') === strip((record.target as HTMLElement).getAttribute('class') || '')) return false;
    }
    return true;
  }
  // An action may run before MutationObserver's microtask. Drain pending
  // changes first so cached references never authorize a removed/hidden item.
  function consumeMutations() {
    const records = [...(observer?.takeRecords?.() || []), ...(browseObserver?.takeRecords?.() || [])];
    if (records.some(record => record.type === 'childList' && record.target === document.body)) observeNativeNavigation();
    if (records.some(relevantMutation)) invalidateTargets();
  }
  function syncView(root: NavigationRoot) {
    if (!overlayKeys.has(root)) overlayKeys.set(root, config.getOverlayView?.(root));
    const key = overlayKeys.get(root);
    if (!key) return;
    const views: OverlayView[] = scopeViews.get(root) || [];
    if (views.at(-1)?.key === key) return;
    const parent = views.findIndex((view) => view.key === key);
    let saved;
    if (parent >= 0) { saved = views[parent]; views.splice(parent + 1); }
    else views.push({ key });
    scopeViews.set(root, views);
    const list = candidates(root);
    const target = saved && (list.find((el) => config.getKey?.(el) === saved.itemKey) || list[saved.index ?? 0]);
    if (!config.getPriorityLayer?.()) select(target || list[0], false);
  }
  // Selection paint uses fresh reads. Candidate membership and geometry are
  // indexed until a structure/layout notification invalidates them.
  let reads: NavigationReads | null = null;
  function withReads<T>(fn: () => T): T {
    if (reads) return fn();
    consumeMutations();
    reads = { rects: new WeakMap(), styles: new WeakMap(), candidates: new Map() };
    try { return fn(); } finally { reads = null; }
  }
  function rect(el: HTMLElement) {
    if (!reads) return el.getBoundingClientRect();
    if (!reads.rects.has(el)) reads.rects.set(el, el.getBoundingClientRect());
    return reads.rects.get(el)!;
  }
  function computed(el: HTMLElement) {
    if (!reads) return getComputedStyle(el);
    if (!reads.styles.has(el)) reads.styles.set(el, getComputedStyle(el));
    return reads.styles.get(el)!;
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
    /* Focus animation can retarget during held-direction repeats. Scroll updates snap. */
    @media(prefers-reduced-motion:no-preference){#ring{transition:transform var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985)),width var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985)),height var(--ytg-focus-duration,120ms) var(--ytg-focus-easing,cubic-bezier(.26,.86,.44,.985))}}
    #help{position:fixed;bottom:var(--ytg-space-6);left:var(--ytg-space-6);background:var(--ytg-overlay-panel);color:var(--ytg-overlay-text);padding:var(--ytg-space-4) var(--ytg-space-5);border-radius:var(--ytg-button-radius);font:var(--ytg-font-small)/1.8 var(--ytg-font-family);display:none;max-width:360px}
  `;
  style.textContent += controllerStyle.css;
  const ring = document.createElement('div'), help = document.createElement('div');
  ring.id = 'ring'; help.id = 'help';
  help.style.whiteSpace = 'pre-line';
  controllerStyle.hint(help, 'YouTube Gamepad\nD-pad / left stick: Select · A: Open\nScroll stick: Scroll\nDuring playback, ↑: Controls · B: Back\nX: Play / pause · Y: Search\nLB / RB: Browse categories, or rewind / forward 10 seconds during playback\nLT / RT: Volume down / up · Start: Quick menu');
  shadow.append(style);
  const overlay = mountOverlay?.(shadow, controllerStyle);
  if (!overlay) shadow.append(ring, help);
  else lifecycle.cleanup(() => overlay.destroy());
  function setHelp(visible: boolean) { if (overlay) overlay.update({ helpVisible: visible }); else help.style.display = visible ? 'block' : 'none'; }
  document.documentElement.append(host);
  function visible(el: HTMLElement, allowTransparent = false) {
    const r = rect(el), s = computed(el);
    // A suspended native layer still belongs to the stack. Its input is owned
    // by the covering layer, so it must not look like a dismissed dialog.
    const inert = el.closest<HTMLElement>('[inert]');
    return el.isConnected && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (allowTransparent || s.opacity !== '0') &&
      !el.closest<HTMLElement>('[hidden],[aria-hidden="true"]') && (!inert || focusManager?.isSuspendedScope(inert));
  }
  function scope() {
    if (reads?.scope) return reads.scope;
    // A dialog owns input from the start of its fade-in, before it becomes opaque.
    const result = pageQueryAll<HTMLElement>(config.overlays || '[role="dialog"]').filter(el => visible(el, true)).at(-1) || document;
    if (reads) reads.scope = result;
    return result;
  }
  function scopeContains(element: HTMLElement) {
    const root = scope();
    return root.contains(element) || (root === document && pageShadowRoots().some(shadow => shadow.contains(element)));
  }
  function candidates(root = scope()) {
    if (reads?.candidates.has(root)) return reads.candidates.get(root)!;
    const indexed = targetIndexes.get(root);
    if (indexed) { reads?.candidates.set(root, indexed.list); return indexed.list; }
    const selectors = config.selectors || 'a[href],button,input,[role="button"]';
    const browse = root === document && document.documentElement.classList.contains('ytg-custom-browse') ?
      document.getElementById?.('ytg-browse-root')?.shadowRoot : null;
    // Hidden native cards are neither queried nor measured in custom browse mode.
    const nodes = root !== document ? Array.from(root.querySelectorAll<HTMLInputElement>(config.overlayItems || 'a[href],button,input,[role="button"],[role="menuitem"],tp-yt-paper-item')) :
      browse ? Array.from(browse.querySelectorAll<HTMLInputElement>(selectors)) : pageQueryAll<HTMLInputElement>(selectors);
    const list = nodes.filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest<HTMLElement>('#yt-gamepad-overlay'));
    const result = config.filterCandidates?.(list) || list;
    const identities = new Map<HTMLElement, TargetIdentity>(), positions = new Map<HTMLElement, number>();
    const keys = new Map<string, (string | Element | undefined)[]>(), occurrences = new Map<string, Map<string | Element | undefined, number>>();
    for (const [position, el] of result.entries()) {
      const section = config.getSection?.(el) || 'content', key = config.getKey?.(el);
      if (!keys.has(section)) { keys.set(section, []); occurrences.set(section, new Map()); }
      const counts = occurrences.get(section)!, occurrence = counts.get(key) || 0;
      counts.set(key, occurrence + 1); keys.get(section)!.push(key);
      identities.set(el, { key, section, occurrence }); positions.set(el, position);
    }
    targetIndexes.set(root, { list: result, identities, positions, keys });
    reads?.candidates.set(root, result);
    return result;
  }
  function remember() {
    if (!current || !current.isConnected || activeScope !== document || restoring || navigating || route !== location.pathname + location.search) return;
    // The Vue feed owns order and selection. Saving its current identity must
    // not enumerate or measure every mounted card on each focus/scroll event.
    if (indexedGrid(current)) {
      const key = config.getKey?.(current);
      memories.set(route, { key, occurrence: 0, section: 'content', x: scrollX, y: scrollY,
        keys: key ? [key] : [], browse: config.captureBrowseState?.() });
      if (memories.size > 30) memories.delete(memories.keys().next().value!);
      return;
    }
    candidates();
    const index = targetIndexes.get(document), identity = index?.identities.get(current);
    if (!identity) return;
    memories.set(route, { ...identity, x: scrollX, y: scrollY,
      keys: index!.keys.get(identity.section) || [],
      browse: config.captureBrowseState?.() });
    if (memories.size > 30) memories.delete(memories.keys().next().value!);
  }
  function rememberScroll(event: Event) {
    if (!enabled || !current?.isConnected || activeScope !== document || restoring || navigating || route !== location.pathname + location.search) return;
    const saved = memories.get(route);
    if (!saved) return;
    // Selection changes already saved identity/order. Scrolling only changes
    // offsets; never rediscover or measure every candidate in this hot path.
    saved.x = scrollX; saved.y = scrollY;
    const target = event.target as HTMLElement | null;
    if (saved.browse && target?.matches?.('[data-ytg-browse-grid]'))
      saved.browse.gridScroll = target.scrollTop;
  }
  function initial(list: HTMLElement[]) {
    const saved = memories.get(route);
    return (saved?.key && list.filter((el) => config.getKey?.(el) === saved.key && config.getSection?.(el) === saved.section)[saved.occurrence || 0])
      || list.find((el) => (config.getSection?.(el) === config.defaultSection) && inViewport(el))
      || list.find(inViewport) || list[0];
  }
  function inViewport(el: HTMLElement) { const r = rect(el); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }
  function syncScope() {
    const next = scope();
    if (next === activeScope) { if (next !== document) syncView(next); return; }
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
      closing.forEach((layer, index) => { scopeViews.delete(layer); focusManager?.close(layer, index === closing.length - 1); });
    } else {
      const owner = previous === document ? (config.getFocusOwner?.() || 'core') : 'core';
      focusManager?.open(next, owner);
      scopeLayers.push(next);
      activeScope = next;
      if (!config.getPriorityLayer?.()) select(candidates(next)[0], false);
    }
    if (next !== document) syncView(next);
  }
  function recover(alignGamepad = false): void {
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
      if (saved && (browseReady || (ready && expired))) {
        const list = candidates().filter((el) => config.getSection?.(el) === saved?.section);
        const matches = list.filter((el) => config.getKey?.(el) === saved?.key);
        let found = saved?.key && matches[saved.occurrence || 0];
        window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
        reads.rects = new WeakMap();
        if (!found && expired) {
          found = matches[0];
          const keys = saved.keys || [], position = keys.indexOf(saved.key);
          for (let distance = 1; !found && position >= 0 && distance < keys.length; distance++) {
            for (const key of [keys[position + distance], keys[position - distance]]) {
              found = list.find((el) => key != null && config.getKey?.(el) === key);
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
    if (!config.getPriorityLayer?.() && !(activeScope === document && config.isFocusOwned?.()) && current && (!visible(current) || !scopeContains(current))) {
      // Repair within the selected region before falling back to the page.
      // The previous order survives DOM replacement and removed cards.
      const list = candidates(), saved = memories.get(route);
      const region = saved && list.filter(el => config.getSection?.(el) === saved.section);
      let target = region?.filter(el => config.getKey?.(el) === saved?.key)[saved?.occurrence || 0];
      const keys = saved?.keys || [], position = keys.indexOf(saved?.key);
      for (let distance = 1; !target && position >= 0 && distance < keys.length; distance++) {
        for (const key of [keys[position + distance], keys[position - distance]]) {
          target = region?.find(el => key != null && config.getKey?.(el) === key);
          if (target) break;
        }
      }
      select(target || region?.[Math.max(0, Math.min(position, region.length - 1))] || initial(list));
    }
    // Recheck after layout changes or returning to controller input. Wheel
    // scrolling only refreshes the ring; it must never snap the page back.
    if (alignGamepad && !navigating && current && activeScope === document &&
        document.documentElement.classList.contains('ytg-gamepad-input') &&
        !config.getPriorityLayer?.() && !config.isFocusOwned?.() &&
        config.sections?.[config.getSection?.(current) || 'content']?.layout === 'grid') alignSelection(current);
    update();
  }
  function update(animate = false) {
    if (!overlay) ring.style.transition = animate ? '' : 'none';
    if (!enabled || config.shouldShowSelection?.({ scope: activeScope }) === false || config.getPriorityLayer?.() || !current || config.ownsSelectionPaint?.(current) || !visible(current) || !scopeContains(current)) { if (overlay) overlay.update({ visible: false }); else ring.style.display = 'none'; return; }
    const target = config.getSelectionTarget?.(current) || config.getContainer?.(current) || current;
    if (!overlay) ring.style.borderColor = adjustingTarget === current ? 'var(--ytg-adjusting-color,#fbbf24)' : '';
    if (!overlay) ring.style.borderRadius = config.getSelectionRadius?.(current) || 'var(--ytg-card-radius, 14px)';
    const r = rect(target);
    const inset = parseFloat(computed(document.documentElement).getPropertyValue?.('--ytg-focus-width')) || 3;
    if (overlay) overlay.update({ visible: true, animate, adjusting: adjustingTarget === current, radius: config.getSelectionRadius?.(current) || 'var(--ytg-card-radius, 14px)', left: r.left - inset, top: r.top - inset, width: r.width + inset * 2, height: r.height + inset * 2 });
    else Object.assign(ring.style, { display: 'block', transform: `translate3d(${r.left - inset}px,${r.top - inset}px,0)`, width: `${r.width + inset * 2}px`, height: `${r.height + inset * 2}px` });
  }
  function measure(list: HTMLElement[]) {
    const cached = measurements.get(list);
    if (cached) return cached;
    const items = list.map((el) => {
      const section = activeScope === document ? (config.getSection?.(el) || 'content') : 'overlay';
      return { el, section,
        key: config.sections?.[section]?.retainRowFocus ? (config.getKey?.(el) || el) : el,
        row: activeScope === document ? config.getRow?.(el) : null,
        rect: rect(config.getContainer?.(el) || el) };
    });
    measurements.set(list, items);
    return items;
  }
  function alignSelection(el: HTMLElement) {
    const grid = el.closest<HTMLElement>('[data-ytg-browse-grid]');
    if (grid) {
      if (indexedGrid(el)) {
        // Logical neighbours are already resolved by ID. Only the destination
        // and viewport need measuring to reveal the full card/shelf.
        const target = rect(el.closest<HTMLElement>('.shorts-shelf') || el);
        const bounds = rect(grid), style = computed(grid);
        const top = bounds.top + (parseFloat(style.scrollPaddingTop) || 0);
        const bottom = bounds.bottom - (parseFloat(style.scrollPaddingBottom) || 0);
        const delta = target.top < top ? target.top - top : target.bottom > bottom ? target.bottom - bottom : 0;
        if (Math.abs(delta) <= 1) return false;
        const behavior = window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'instant';
        grid.scrollTo({ top: Math.max(0, grid.scrollTop + delta), behavior });
        invalidateGeometry();
        return true;
      }
      const items = measure(candidates().filter(item => item.closest('[data-ytg-browse-grid]') === grid));
      const from = items.find(item => item.el === el);
      if (!from) return false;
      const bounds = rect(grid), style = computed(grid);
      const top = parseFloat(style.scrollPaddingTop) || 0, bottom = parseFloat(style.scrollPaddingBottom) || 0;
      const delta = navigation.rowScroll(from, items, { top: bounds.top + top, bottom: bounds.bottom - bottom });
      // Reveal the entire row, including its title and channel, at a row boundary.
      if (Math.abs(delta) <= 1) return false;
      const behavior = window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'instant';
      grid.scrollTo({ top: Math.max(0, grid.scrollTop + delta), behavior });
      invalidateGeometry();
      return true;
    }
    const section = config.getSection?.(el) || 'content';
    if (activeScope !== document || config.sections?.[section]?.layout !== 'grid' || config.sections?.[section]?.alignRows === false) {
      const before = rect(el);
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const after = el.getBoundingClientRect();
      if (before.top !== after.top || before.left !== after.left) invalidateGeometry();
      if (reads) reads.rects = new WeakMap();
      return true;
    }
    const items = measure(candidates()), from = items.find((item) => item.el === el);
    if (!from) return;
    const viewport = config.getViewport?.() || { top: 16, bottom: innerHeight - 16 };
    const delta = navigation.rowScroll(from, items, viewport);
    if (Math.abs(delta) > 1) {
      const top = Math.max(0, scrollY + delta);
      if (top === scrollY) return false;
      window.scrollTo({ left: scrollX, top, behavior: 'instant' });
      invalidateGeometry();
      return true;
    }
    return false;
  }
  function select(el?: HTMLElement | null | undefined, scroll = true, keepColumn = false): void {
    if (!reads) return withReads(() => select(el, scroll, keepColumn));
    if (el !== current) endAdjustment();
    const scrolled = scroll && el ? alignSelection(el) : false;
    (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    current = el || null;
    const view = scopeViews.get(activeScope)?.at(-1);
    if (view && current) { candidates(activeScope); view.itemKey = config.getKey?.(current); view.index = targetIndexes.get(activeScope)?.positions.get(current); }
    if (rowFocus && current && !indexedGrid(current) && activeScope === document && config.sections?.[config.getSection?.(current) || 'content']?.retainRowFocus) {
      const items = measure(candidates()), item = items.find((entry) => entry.el === current);
      if (item) rowFocus.remember(item, items, keepColumn);
    }
    (config.getContainer?.(current) || current)?.classList?.add('ytg-selected');
    if (activeScope === document && config.getSection?.(current) === 'content')
      contentReturn = { route, el: current!, key: config.getKey?.(current) };
    config.onSelectionChange?.(current, activeScope);
    el?.focus({ preventScroll: true });
    // Track focus we put on a card, so pointer takeover can release it without
    // blurring keyboard targets, text fields or native dialog controls.
    const container = config.getContainer?.(el);
    controllerCardFocus = activeScope === document && el && container && container !== el &&
      document.documentElement.classList.contains('ytg-gamepad-input') &&
      pageActiveElement() === el ? el : null;
    // Re-read the selected target after class/focus writes, not the whole list.
    if (current) {
      reads.rects.delete(current);
      reads.rects.delete(config.getSelectionTarget?.(current) || config.getContainer?.(current) || current);
      reads.styles.delete(current);
    }
    update(!scrolled);
    remember();
  }
  function navigate(direction: Direction): void {
    if (!reads) return withReads(() => navigate(direction));
    syncScope();
    restoring = false;
    // Browse shelves also own horizontal scrolling and logical neighbours.
    if (activeScope === document && current?.closest?.('[data-ytg-browse-grid]') &&
      !current.dispatchEvent(new CustomEvent('ytg-browse-direction', { bubbles: true, composed: true, cancelable: true,
        detail: { direction, focus: (node: HTMLElement) => select(node, true, true) } }))) return;
    const list = candidates();
    if (!current || !list.includes(current)) {
      select(initial(list));
      return;
    }
    const items = measure(list);
    const from = items.find((item) => item.el === current);
    if (!from) return;
    let best = navigation.choose(from, items, direction, activeScope === document ? config.sections : { overlay: {} }, rowFocus);
    // Returning from the first video row must preserve the active feed category.
    // Geometric proximity can otherwise focus (and activate) a different chip.
    if (activeScope === document && from.section === 'content' && direction === 'up' && best?.section === 'categories') {
      best = items.find((item) => {
        if (item.section !== 'categories') return false;
        const chip = item.el.closest<HTMLElement>('[data-ytg-category]') || item.el;
        return chip.getAttribute('selected') === '' || chip.getAttribute('selected') === 'true' ||
          chip.getAttribute('aria-selected') === 'true' || chip.getAttribute('aria-pressed') === 'true' ||
          Boolean(chip.querySelector?.('[aria-selected="true"],[aria-pressed="true"],.ytChipShapeActive'));
      }) || best;
    }
    if (activeScope === document && config.rememberRegionReturn?.() &&
      ((from.section === 'sidebar' && direction === 'right') ||
       (['header', 'searchEntry', 'categories'].includes(from.section) && direction === 'down') ||
       (from.section === 'settings' && direction === 'left'))) {
      const saved = returnToContent(list);
      if (saved && (!best || best.section === 'content')) best = items.find((item) => item.el === saved) ?? null;
    }
    if (best) {
      let scroll = true;
      if (activeScope === document && from.section === 'categories' && direction === 'down' && best.section === 'content') {
        const grid = best.el.closest<HTMLElement>('[data-ytg-browse-grid]');
        const bounds = grid ? rect(grid) : config.getViewport?.() || { top: 16, bottom: innerHeight - 16 };
        const row = navigation.rowOf(best, items);
        // Entering an already visible row should only move focus. Scroll padding
        // is an alignment preference, not an obstruction to the visible cards.
        scroll = !row.every(item => item.rect.top >= bounds.top - 1 && item.rect.top + item.rect.height <= bounds.bottom + 1);
      }
      select(best.el, scroll, true);
    }
    // No target means stay on the current card; never scroll by an arbitrary distance.
  }
  // A layer must explicitly pass an action before a lower layer can see it.
  const outcome = (result: unknown) => result === 'handled' ? 'handled' : result === 'pass' ? 'pass' : 'blocked';
  function pageAction(action: Action) {
    if (adjustingTarget && (adjustingTarget !== current || !current || !visible(current) || !scopeContains(current))) endAdjustment();
    if (adjustingTarget) {
      if (action === 'confirm' || action === 'back') { endAdjustment(); update(); return 'handled'; }
      if (action === 'left' || action === 'right') { config.adjustSlider?.(current, action === 'left' ? -1 : 1); return 'handled'; }
      return 'blocked';
    }
    if (action === 'back' && activeScope === document && config.rememberRegionReturn?.() && ['sidebar', 'header', 'searchEntry', 'categories', 'settings'].includes(config.getSection?.(current) || '')) {
      const list = candidates();
      const target = returnToContent(list) || list.find((el) => config.getSection?.(el) === 'content' && inViewport(el));
      if (target) { select(target); return 'handled'; }
    }
    if (['up', 'down', 'left', 'right'].includes(action)) { navigate(action as Direction); return 'handled'; }
    if (action === 'confirm') {
      if (!current || !visible(current) || !scopeContains(current)) select(initial(candidates()));
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
  function act(action: Action): import('../../types/ports').Disposition {
    if (lifecycle.destroyed) return 'blocked';
    if (!reads) return withReads(() => act(action));
    const priority = config.getPriorityLayer?.();
    const result = interaction.dispatch({ type: 'INPUT_OWNER', action,
      enabled, navigating: navigating || !!config.isNavigating?.(), menu: !!priority,
      native: scope() !== document, panel: !!config.getInputLayer?.(), help: helpVisible });
    if (result.disposition === 'blocked') return 'blocked';
    const owner = result.effects[0]?.value;
    if (owner === 'menu') {
      const handled = outcome(priority?.handle(action));
      return handled === 'pass' ? 'blocked' : handled;
    }
    syncScope();
    if (owner === 'native') return pageAction(action);
    if (owner === 'panel') {
      const handled = outcome(config.handleLayer?.(action));
      return handled === 'pass' ? 'blocked' : handled;
    }
    if (owner === 'help') {
      if (action === 'back' || action === 'help') { helpVisible = false; setHelp(false); return 'handled'; }
      return 'blocked';
    }
    // Shortcut policy lives outside the navigation core.
    if (config.handleShortcut) {
      const result = outcome(config.handleShortcut(action));
      if (result !== 'pass') return result;
    }
    if (action === 'help') { helpVisible = true; setHelp(true); return 'handled'; }
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
  YTGamepad = {
    destroy: lifecycle.destroy,
    registerSite(values) { stickScroller.stop(); endAdjustment(); config = values; current = null; invalidateTargets(); rowFocus?.reset(); },
    configure(values) { invalidateTargets(); if (values.enabled === false) { stickScroller.stop(); endAdjustment(); } enabled = values.enabled !== false; if (!enabled) { (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected'); current = null; config.onSelectionChange?.(null, document); config.onDisable?.(); setHelp(false); helpVisible = false; } update(); },
    navigate, act,
    scroll(delta) {
      if (!delta || !enabled || navigating || config.isNavigating?.() || helpVisible ||
        config.getPriorityLayer?.()) { stickScroller.stop(); return; }
      const root = scope();
      if (root === document && (config.getInputLayer?.() || config.isFocusOwned?.())) { stickScroller.stop(); return; }
      const fallback = root === document ? pageQuery<HTMLElement>('[data-ytg-browse-grid]') || document.scrollingElement : root;
      stickScroller.scroll(delta, root, pageActiveElement() || current, fallback instanceof Element ? fallback : null);
    },
    focus(el) {
      if (!el) return;
      withReads(() => {
        const root = scope(); candidates(root);
        if (targetIndexes.get(root)?.positions.has(el) && visible(el)) select(el, false);
      });
    },
    resetContentFocus() {
      restoring = false; lifecycle.clearTimeout(restoreTimer);
      rowFocus?.reset();
      contentReturn = null; memories.delete(route);
      select(candidates().find((el) => config.getSection?.(el) === 'content'));
    },
    refresh() { invalidateTargets(); recover(); },
    get hasTemporaryLayer() { return helpVisible || scope() !== document; },
    get hasOverlay() { return activeScope !== document; },
    get current() { return current; }, get section() { return config.getSection?.(current); },
    get restoring() { return restoring; }
  };
  const unregisterFocus = focusManager?.register('core', {
    active: () => enabled && (activeScope !== document || !config.isFocusOwned?.()),
    capture() {
      const list = candidates(activeScope);
      const active = pageActiveElement() as HTMLElement | null;
      const el = active && list.includes(active) ? active : current;
      if (!el || !list.includes(el)) return null;
      return { el, pageScroll: activeScope === document ? { x: scrollX, y: scrollY } : null,
        region: activeScope === document ? config.getSection?.(el) || 'content' : 'overlay',
        itemKey: config.getKey?.(el) || el, index: list.indexOf(el), scope: activeScope };
    },
    items(region, target) {
      if (target.scope !== activeScope) return [];
      return candidates(activeScope).filter((el) => activeScope !== document || (config.getSection?.(el) || 'content') === region)
        .map((el) => ({ region, itemKey: config.getKey?.(el) || el, el }));
    },
    fallback() { return { region: 'content', el: initial(candidates(activeScope)) }; },
    apply(target, saved) {
      if (saved?.pageScroll && activeScope === document) {
        window.scrollTo({ left: saved.pageScroll.x, top: saved.pageScroll.y, behavior: 'instant' });
        if (reads) reads.rects = new WeakMap();
      }
      select(target?.el, false);
    }
  });
  if (unregisterFocus) lifecycle.cleanup(unregisterFocus);
  lifecycle.listen(window, 'yt-gamepad-action', e => { if (typeof e.detail?.action === 'string') act(e.detail.action); });
  const followFocus = (e: FocusEvent) => withReads(() => {
    const target = (e.composedPath?.()[0] || e.target) as HTMLElement;
    if (!enabled || current === target) return;
    if (indexedGrid(target) && scope() === document && visible(target)) select(target, false);
    else if (candidates().includes(target)) select(target, false);
  });
  lifecycle.listen(document, 'focusin', followFocus);
  lifecycle.listen(document, 'yt-navigate-start', () => { remember(); navigating = true; });
  for (const event of ['yt-navigate-finish', 'yt-navigate-cancel', 'yt-navigate-error']) lifecycle.listen(document, event, () => { navigating = false; });
  function routeChanged(event: { type: string; }) {
    invalidateTargets();
    if (!event || event.type === 'yt-navigate-finish') navigating = false;
    const next = location.pathname + location.search;
    if (next === route) { recover(); return; }
    const focused = current || pageActiveElement() as HTMLElement | null;
    const sidebarKey = config.getSection?.(focused) === 'sidebar' ? config.getKey?.(focused) : null;
    (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    endAdjustment();
    route = next; current = null; contentReturn = null; activeScope = document;
    scopeViews.clear();
    rowFocus?.reset();
    scopeLayers.splice(0).forEach(layer => focusManager?.close(layer, false));
    if (sidebarKey && !config.rememberRegionReturn?.()) current = candidates().find((el) => config.getSection?.(el) === 'sidebar' && config.getKey?.(el) === sidebarKey) || null;
    const restoreExpected = memories.has(route);
    restoring = restoreExpected;
    lifecycle.clearTimeout(restoreTimer); restoreDeadline = Date.now() + 5000; browseRestore = {};
    recover();
    if (enabled && !restoreExpected && !config.getPriorityLayer?.() && !config.isFocusOwned?.() && config.rememberRegionReturn?.()) published.resetContentFocus();
  }
  lifecycle.listen(document, 'yt-navigate-finish', routeChanged);
  lifecycle.listen(window, 'popstate', routeChanged);
  let pending = false, pendingAlignment = false, pendingRecovery = false;
  function scheduleFrame() {
    if (!enabled || document.hidden) return;
    if (pending) return;
    pending = true;
    lifecycle.frame(() => {
      const align = pendingAlignment, repair = pendingRecovery;
      pending = false; pendingAlignment = false; pendingRecovery = false;
      if (!enabled || document.hidden) return;
      if (repair) recover(align);
      else withReads(() => update());
    });
  }
  function scheduleRecover(alignGamepad = false) {
    if (!enabled || document.hidden) return;
    pendingRecovery = true; pendingAlignment ||= alignGamepad === true;
    scheduleFrame();
  }
  function scrolled(event: Event) { rememberScroll(event); invalidateGeometry(); scheduleFrame(); }
  lifecycle.listen(window, 'scroll', scrolled, { capture: true, passive: true });
  lifecycle.listen(window, 'resize', () => { invalidateTargets(); scheduleRecover(true); });
  lifecycle.listen(document, 'fullscreenchange', () => { invalidateTargets(); scheduleRecover(true); });
  if (document.fonts) lifecycle.listen(document.fonts, 'loadingdone', () => { invalidateTargets(); scheduleRecover(); });
  lifecycle.listen(window, 'yt-gamepad-input-mode', event => {
    const mode = event.detail?.mode;
    if (mode !== 'gamepad') {
      const target = controllerCardFocus;
      controllerCardFocus = null;
      // The native focus ring is no longer suppressed in mouse mode. Remove
      // only our own lingering DOM focus; keep current for controller return.
      if (mode === 'mouse' && target && pageActiveElement() === target) target.blur();
    }
    scheduleRecover(mode === 'gamepad');
  });
  lifecycle.listen(document, 'visibilitychange', () => { if (!document.hidden) { invalidateTargets(); scheduleRecover(); } });
  // Vue owns browse updates. Only native player controls and popup layers
  // need DOM observation; never subscribe to the hidden native feed subtree.
  const observeNativeNavigation = () => {
    observer!.disconnect();
    observer!.observe(document.documentElement, { attributes: true, attributeOldValue: true,
      attributeFilter: ['class', 'style', 'lang', 'dir', 'data-ytg-language', 'data-ytg-native'] });
    observer!.observe(document.body, { childList: true });
    for (const root of document.querySelectorAll('#movie_player,ytd-popup-container')) {
      observer!.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true,
        characterData: true, attributeFilter: ['hidden', 'aria-hidden', 'aria-expanded', 'disabled', 'aria-disabled', 'inert', 'style', 'class'] });
    }
  };
  observer = lifecycle.observer(records => {
    if (records.some(record => record.type === 'childList' && record.target === document.body)) observeNativeNavigation();
    if (!records.some(relevantMutation)) return;
    invalidateTargets();
    scheduleRecover(true);
  });
  observeNativeNavigation();
  lifecycle.listen(document, 'yt-navigate-finish', observeNativeNavigation);
  const observeBrowse = () => {
    const roots = pageShadowRoots();
    for (const root of roots) if (!observedBrowseRoots.has(root)) {
      observedBrowseRoots.add(root);
      // Focus transitions within a shadow tree are retargeted to the same
      // host and do not reach document. Listen at the owning boundary too.
      lifecycle.listen(root, 'focusin', followFocus);
      lifecycle.listen(root, 'scroll', scrolled, { capture: true, passive: true });
      browseObserver!.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded', 'aria-pressed', 'selected', 'disabled', 'aria-disabled', 'inert', 'data-ytg-category-hidden', 'data-ytg-category-order'] });
    }
    if (roots.length) scheduleRecover();
  };
  // Rendering a feed or changing focus must not realign a saved scroll position.
  // The browse surface explicitly refreshes after Vue patches; repair only
  // removals/visibility here, without observing our own selection class writes.
  browseObserver = lifecycle.observer(records => { if (records.some(relevantMutation)) { invalidateTargets(); scheduleRecover(); } });
  const observedBrowseRoots = new Set<ShadowRoot>();
  lifecycle.cleanup(() => observedBrowseRoots.clear());
  lifecycle.listen(document, 'ytg-browse-mounted', observeBrowse);
  observeBrowse();
  const published = YTGamepad;
  lifecycle.cleanup(() => { if (YTGamepad === published) YTGamepad = undefined; });
  lifecycle.cleanup(() => {
    endAdjustment();
    enabled = false; (config.getContainer?.(current) || current)?.classList?.remove('ytg-selected');
    scopeLayers.splice(0).forEach(layer => focusManager?.close(layer, false));
    current = null; memories.clear(); scopeViews.clear(); invalidateTargets(); contentReturn = null; host.remove?.();
  });
  return published;
  } };
})();
