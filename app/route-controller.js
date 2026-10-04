// Owns browser history interception and route notifications; rules stay in route-state.
(() => {
  if (window.YTGamepadRouteController) return;
  window.YTGamepadRouteController = { create(port) {
    const lifecycle = window.YTGamepadRuntime.scope('route');
    const send = event => port.interaction.dispatch(event);
    const app = () => port.interaction.state.app;
    let started = false;
    function cancel() { send({ type: 'NAV_CANCEL', route: port.routeNow() }); port.renderMode(); }
    function finish() {
      const previous = app(); send({ type: 'NAV_FINISH', route: port.routeNow() });
      if (previous.mode !== app().mode || previous.settledRoute !== app().settledRoute) port.renderMode();
    }
    function prepareVideo(href) {
      if (lifecycle.destroyed || !port.enabled() || !href || app().navigation || app().returning) return false;
      let target;
      try { target = new URL(href, port.location.origin); } catch (_) { return false; }
      if (target.origin !== port.location.origin || target.pathname !== '/watch' || !target.searchParams.get('v') ||
          target.pathname + target.search === port.routeNow()) return false;
      const result = send({ type: 'PREPARE_VIDEO', route: port.routeNow(), target: target.pathname + target.search });
      if (result.disposition === 'blocked') return false;
      port.renderMode(); return true;
    }
    function execute(effect) {
      if (lifecycle.destroyed) return;
      switch (effect.type) {
        case 'pause': port.pause(); break;
        case 'closeMenu': port.closeMenu(); break;
        case 'historyGo': port.history.go(effect.value); break;
        case 'historyBack': port.history.back(); break;
        case 'assign': port.location.assign(effect.value); break;
      }
    }
    function pageBack() {
      if (lifecycle.destroyed) return;
      const result = send({ type: 'PAGE_BACK', route: port.routeNow(), temporaryLayer: port.hasTemporaryLayer() });
      if (result.disposition === 'blocked') return;
      port.renderMode(); result.effects.forEach(execute);
    }
    function start() {
      if (started || lifecycle.destroyed) return;
      started = true;
      for (const method of ['pushState', 'replaceState']) {
        const original = port.history[method];
        if (!original) continue;
        const wrapped = function (...args) {
          const before = port.routeNow(), result = original.apply(this, args);
          if (!lifecycle.destroyed) send({ type: 'HISTORY', method, route: port.routeNow(), changed: before !== port.routeNow() });
          return result;
        };
        port.history[method] = wrapped;
        // Preserve wrappers installed by the site after ours.
        lifecycle.cleanup(() => { if (port.history[method] === wrapped) port.history[method] = original; });
      }
      lifecycle.listen(port.document, 'yt-navigate-start', () => { send({ type: 'NAV_START' }); port.onStart(); });
      lifecycle.listen(port.document, 'yt-navigate-finish', finish);
      lifecycle.listen(port.document, 'yt-navigate-cancel', cancel);
      lifecycle.listen(port.document, 'yt-navigate-error', cancel);
      lifecycle.listen(port.window, 'popstate', () => { send({ type: 'POPSTATE', route: port.routeNow() }); port.renderMode(); });
    }
    return { start, prepareVideo, pageBack, execute, destroy: lifecycle.destroy };
  } };
})();
