// Pure navigation and verified return-chain rules. Browser effects are executed by route-controller.
(() => {
  if (window.YTGamepadRouteState) return;
  const events = new Set(["PREPARE_VIDEO", "NAV_START", "HISTORY", "NAV_FINISH", "NAV_CANCEL", "POPSTATE", "PAGE_BACK"]);
  const isWatch = route => route.split('?')[0] === '/watch';
  function transition(app, event) {
    const effects = [], effect = (type, value) => effects.push({ type, value });
    let disposition = 'handled';
    switch (event.type) {
      case 'PREPARE_VIDEO':
        if (!app.enabled || app.navigation || app.returning || event.target === event.route) { disposition = 'blocked'; break; }
        app = { ...app, route: event.route, navigation: { target: event.target, pushed: 0 }, openingVideo: true, mode: 'playback',
          ...(!isWatch(event.route) ? { returnRoute: event.route, watchDepth: 0, chainVerified: true } : {}) }; break;
      case 'NAV_START': app = { ...app, navigation: app.navigation || { target: null, pushed: 0 } }; break;
      case 'HISTORY':
        if (event.method === 'pushState' && app.navigation?.target === event.route && !app.navigation.traversal) {
          app = { ...app, navigation: { ...app.navigation, pushed: app.navigation.pushed + 1 } };
        } else if (event.method === 'pushState' || event.changed) app = { ...app, chainVerified: false, watchDepth: 0 };
        break;
      case 'NAV_FINISH': {
        const navigation = app.navigation, duplicate = event.route === app.settledRoute &&
          (!navigation || (!navigation.target && !navigation.pushed && !navigation.traversal));
        if (duplicate) { app = { ...app, navigation: null }; break; }
        const verified = navigation?.target === event.route && navigation.pushed === 1 &&
          !navigation.traversal && app.chainVerified && app.returnRoute;
        app = { ...app, ...(verified ? { watchDepth: app.watchDepth + 1 } :
          navigation?.pushed || event.route !== app.settledRoute ? { chainVerified: false, watchDepth: 0 } : {}),
          navigation: null, openingVideo: false, returning: false, route: event.route, settledRoute: event.route,
          mode: app.enabled && isWatch(event.route) ? 'playback' : 'browse' };
        if (!isWatch(event.route)) app = { ...app, returnRoute: null, watchDepth: 0, chainVerified: true };
        break;
      }
      case 'NAV_CANCEL':
        app = { ...app, ...(app.navigation?.pushed ? { chainVerified: false, watchDepth: 0 } : {}),
          navigation: null, openingVideo: false, returning: false, route: event.route, settledRoute: event.route,
          mode: app.enabled && isWatch(event.route) ? 'playback' : 'browse' };
        if (!isWatch(event.route)) app = { ...app, returnRoute: null, watchDepth: 0, chainVerified: true };
        break;
      case 'POPSTATE': app = { ...app, chainVerified: false, watchDepth: 0, openingVideo: false,
        navigation: { traversal: true }, mode: 'browse', route: event.route }; break;
      case 'PAGE_BACK':
        if (!app.enabled || app.navigation || app.returning || event.temporaryLayer) { disposition = 'blocked'; break; }
        app = { ...app, returning: true, navigation: { traversal: true } };
        if (isWatch(event.route)) {
          app = { ...app, mode: 'browse' }; effect('pause'); effect('closeMenu');
          if (app.returnRoute && app.chainVerified && app.watchDepth > 0) effect('historyGo', -app.watchDepth);
          else effect('assign', app.returnRoute || '/');
        } else effect('historyBack');
        break;
      default: disposition = 'pass';
    }
    return { app, effects, disposition };
  }
  window.YTGamepadRouteState = { handles: type => events.has(type), transition };
})();
