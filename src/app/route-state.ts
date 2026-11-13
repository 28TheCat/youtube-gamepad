import type { AppSnapshot, Disposition, RouteEffect, RouteEvent, RouteStateModule } from '../../types/ports';
import { sameWatchDestination } from '../shared/watch-destination';

export let YTGamepadRouteState!: RouteStateModule;
// Pure navigation and verified return-chain rules. Browser effects are executed by route-controller.
(() => {
  if (YTGamepadRouteState) return;
  const events = new Set(['PREPARE_VIDEO', 'REQUEST_WAIT', 'REQUEST_FINISH', 'REQUEST_CANCEL',
    'NAV_START', 'HISTORY', 'NAV_FINISH', 'NAV_CANCEL', 'POPSTATE', 'PAGE_BACK']);
  const isWatch = (route: string) => route.split('?')[0] === '/watch';
  function settle(app: AppSnapshot, route: string, verified = false): AppSnapshot {
    const changed = route !== app.settledRoute;
    return { ...app, navigation: null, openingVideo: false, returning: false, route, settledRoute: route,
      mode: app.enabled && isWatch(route) ? 'playback' : 'browse',
      ...(!isWatch(route) ? { returnRoute: null, watchDepth: 0, chainVerified: true }
        : verified ? { watchDepth: app.watchDepth + 1 }
          : changed ? { watchDepth: 0, chainVerified: false } : {}) };
  }
  function transition(app: AppSnapshot, event: RouteEvent) {
    const effects: RouteEffect[] = [];
    let disposition: Disposition = 'handled';
    const request = app.navigation?.source === 'extension' ? app.navigation : null;
    switch (event.type) {
      case 'PREPARE_VIDEO':
        if (!app.enabled || app.navigation || app.returning || event.target === event.route) { disposition = 'blocked'; break; }
        app = { ...app, route: event.route,
          navigation: { source: 'extension', id: event.id, phase: 'requested', target: event.target, traversal: false },
          openingVideo: true, mode: 'playback',
          ...(!isWatch(event.route) ? { returnRoute: event.route, watchDepth: 0, chainVerified: true } : {}) }; break;
      case 'REQUEST_WAIT':
        if (request?.id !== event.id || request.phase !== 'requested') { disposition = 'pass'; break; }
        app = { ...app, navigation: { ...request, phase: 'waiting' } }; break;
      case 'REQUEST_FINISH':
        if (request?.id !== event.id || request.phase !== 'waiting' ||
          (request.traversal ? event.evidence !== 'popstate' : !sameWatchDestination(request.target, event.route) || event.evidence === 'popstate')) {
          disposition = 'pass'; break;
        }
        app = { ...settle(app, event.route, !request.traversal && event.evidence === 'pushState' &&
          app.chainVerified && !!app.returnRoute), lastNavigation: { id: request.id, phase: 'completed' } };
        if (request.traversal) {
          app = { ...app, returning: true, navigation: { source: 'site', phase: 'waiting', traversal: true } };
        }
        break;
      case 'REQUEST_CANCEL':
        if (request?.id !== event.id) { disposition = 'pass'; break; }
        app = { ...settle(app, event.route), lastNavigation: { id: request.id, phase: 'cancelled' } }; break;
      case 'NAV_START':
        if (!app.navigation) app = { ...app, navigation: { source: 'site', phase: 'waiting', traversal: false } };
        break;
      case 'HISTORY':
        if (event.method === 'pushState' || event.changed) app = { ...app, chainVerified: false, watchDepth: 0 };
        break;
      case 'NAV_FINISH':
      case 'NAV_CANCEL':
        if (request) { disposition = 'pass'; break; }
        if (event.route === app.settledRoute && !app.navigation?.traversal) {
          if (app.navigation) app = { ...app, navigation: null };
        } else app = settle(app, event.route);
        break;
      case 'POPSTATE':
        if (request) { disposition = 'pass'; break; }
        app = { ...app, chainVerified: false, watchDepth: 0, openingVideo: false,
          navigation: { source: 'site', phase: 'waiting', traversal: true }, mode: 'browse', route: event.route }; break;
      case 'PAGE_BACK':
        if (!app.enabled || app.navigation || app.returning || event.temporaryLayer) { disposition = 'blocked'; break; }
        app = { ...app, returning: true,
          navigation: { source: 'extension', id: event.id, phase: 'requested', target: null, traversal: true } };
        if (isWatch(event.route)) {
          app = { ...app, mode: 'browse' }; effects.push({ type: 'pause' }); effects.push({ type: 'closeMenu' });
          if (app.returnRoute && app.chainVerified && app.watchDepth > 0) effects.push({ type: 'historyGo', value: -app.watchDepth });
          else effects.push({ type: 'assign', value: app.returnRoute || '/' });
        } else effects.push({ type: 'historyBack' });
        break;
      default: disposition = 'pass';
    }
    return { app, effects, disposition };
  }
  YTGamepadRouteState = { handles: type => events.has(type), transition };
})();
