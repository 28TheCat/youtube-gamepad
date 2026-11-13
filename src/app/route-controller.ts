import type { InteractionEvent, ModuleFactory, RouteControllerModule, RouteEffect, RoutePort } from '../../types/ports';
import { sameWatchDestination } from '../shared/watch-destination';
import { isInnerTubeBrowseRoute } from '../shared/explore-pages';

const requestTimeout = 8000;

export let YTGamepadRouteController!: ModuleFactory<RoutePort, RouteControllerModule>;
(() => {
  if (YTGamepadRouteController) return;
  YTGamepadRouteController = {
  create(port) {
    const lifecycle = port.runtime.scope('route');
    const send = <Event extends InteractionEvent>(event: Event) => port.interaction.dispatch(event);
    const app = () => port.interaction.state.app;
    let started = false, sequence = 0;
    let deadline: { id: number; timer: number | undefined } | undefined;
    const pending = () => {
      const navigation = app().navigation;
      return navigation?.source === 'extension' ? navigation : null;
    };
    function clearDeadline(id: number) {
      if (deadline?.id !== id) return;
      lifecycle.clearTimeout(deadline.timer);
      deadline = undefined;
    }
    function cancelRequest(id: number) {
      clearDeadline(id);
      if (lifecycle.destroyed || pending()?.id !== id) return;
      send({ type: 'REQUEST_CANCEL', id, route: port.routeNow() });
      port.renderMode();
    }
    function wait(id: number) {
      if (deadline) clearDeadline(deadline.id);
      send({ type: 'REQUEST_WAIT', id });
      deadline = { id, timer: lifecycle.timeout(() => cancelRequest(id), requestTimeout) };
    }
    function rememberParent(route: string) {
      try { port.history.replaceState({ ...port.history.state, ytGamepadParentRoute: route }, ''); } catch { /* Keep navigation usable. */ }
    }
    function finishRequest(id: number, route: string, evidence: 'pushState' | 'replaceState' | 'popstate') {
      const previous = app();
      if (send({ type: 'REQUEST_FINISH', id, route, evidence }).disposition !== 'handled') return;
      clearDeadline(id);
      if (!previous.navigation?.traversal && evidence === 'pushState' && previous.chainVerified) rememberParent(previous.route);
      port.renderMode();
    }
    function syncSite(type: 'NAV_FINISH' | 'NAV_CANCEL') {
      const previous = app(), route = port.routeNow();
      if (send({ type, route }).disposition !== 'handled') return;
      if (type === 'NAV_FINISH' && previous.navigation && !previous.navigation.traversal &&
        previous.settledRoute !== route) rememberParent(previous.settledRoute);
      if (previous !== app() || type === 'NAV_FINISH') port.renderMode();
    }
    function observeHistory(method: 'pushState' | 'replaceState', route: string, changed: boolean) {
      const request = pending();
      // YouTube's lifecycle events carry no request ID. Settle video opens
      // from the observed URL commit, never from an unlabelled finish or error.
      if (changed && request && sameWatchDestination(request.target, route)) {
        finishRequest(request.id, route, method);
        return;
      }
      send({ type: 'HISTORY', method, route, changed });
      if (changed) port.renderMode();
    }
    function prepareVideo(href: string | null) {
      if (lifecycle.destroyed || !port.enabled() || !href || app().navigation || app().returning) return false;
      let target: URL;
      try { target = new URL(href, port.location.origin); } catch { return false; }
      const route = port.routeNow(), destination = target.pathname + target.search;
      if (target.origin !== port.location.origin || target.pathname !== '/watch' || !target.searchParams.get('v') ||
          destination === route) return false;
      const id = ++sequence;
      const result = send({ type: 'PREPARE_VIDEO', id, route, target: destination });
      if (result.disposition === 'blocked') return false;
      wait(id);
      port.renderMode(); return id;
    }
    function execute(effect: RouteEffect) {
      if (lifecycle.destroyed) return;
      switch (effect.type) {
        case 'pause': port.pause(); break;
        case 'closeMenu': port.closeMenu(); break;
        case 'historyGo': port.history.go(effect.value); break;
        case 'historyBack': port.history.back(); break;
        case 'assign': port.location.assign(effect.value); break;
        default: effect satisfies never;
      }
    }
    function hasPreviousBrowseEntry() {
      // A full document video open loses the in-memory chain. The browser can
      // still identify the adjacent entry that holds the saved browse snapshot.
      const navigation = (port.window as Window & { navigation?: {
        currentEntry: { index: number } | null;
        entries(): { index: number; url: string | null }[];
      } }).navigation;
      const index = navigation?.currentEntry?.index;
      if (index === undefined || index < 1) return false;
      const url = navigation.entries().find(entry => entry.index === index - 1)?.url;
      return !!url && isInnerTubeBrowseRoute(url);
    }
    function pageBack() {
      if (lifecycle.destroyed) return;
      const id = ++sequence;
      const result = send({ type: 'PAGE_BACK', id, route: port.routeNow(), temporaryLayer: port.hasTemporaryLayer() });
      if (result.disposition === 'blocked') return;
      wait(id);
      port.renderMode();
      try {
        for (const effect of result.effects) {
          if (effect.type === 'assign' && (typeof port.history.state?.ytGamepadParentRoute === 'string' || hasPreviousBrowseEntry())) port.history.back();
          else execute(effect);
        }
      } catch (error) { cancelRequest(id); throw error; }
    }
    function start() {
      if (started || lifecycle.destroyed) return;
      started = true;
      if (port.remoteHistory) {
        lifecycle.listen(port.document, 'ytg-page-history-v1', event => {
          try {
            const detail = (event as CustomEvent).detail;
            if (typeof detail !== 'string' || detail.length > 40000) return;
            const value = JSON.parse(detail);
            if (value.version !== 1 || !['pushState','replaceState'].includes(value.method) ||
                value.route !== port.routeNow() || typeof value.changed !== 'boolean') return;
            observeHistory(value.method, value.route, value.changed);
          } catch { /* Ignore malformed page notifications. */ }
        });
      } else for (const method of ['pushState', 'replaceState'] as const) {
        const original = port.history[method];
        if (!original) continue;
        const wrapped = function (this: History, ...args: Parameters<History['pushState']>) {
          const before = port.routeNow(), result = original.apply(this, args);
          if (!lifecycle.destroyed) {
            const route = port.routeNow();
            observeHistory(method, route, before !== route);
          }
          return result;
        };
        port.history[method] = wrapped;
        // Preserve wrappers installed by the site after ours.
        lifecycle.cleanup(() => { if (port.history[method] === wrapped) port.history[method] = original; });
      }
      lifecycle.listen(port.document, 'yt-navigate-start', () => { send({ type: 'NAV_START' }); port.onStart(); });
      lifecycle.listen(port.document, 'yt-navigate-finish', () => syncSite('NAV_FINISH'));
      lifecycle.listen(port.document, 'yt-navigate-cancel', () => syncSite('NAV_CANCEL'));
      lifecycle.listen(port.document, 'yt-navigate-error', () => syncSite('NAV_CANCEL'));
      lifecycle.listen(port.window, 'popstate', () => {
        const request = pending(), route = port.routeNow();
        if (request?.traversal) { finishRequest(request.id, route, 'popstate'); return; }
        if (request) cancelRequest(request.id);
        send({ type: 'POPSTATE', route }); port.renderMode();
      });
    }
    return { start, prepareVideo, cancelRequest, pageBack, execute, destroy: lifecycle.destroy };
  }
  };
})();
