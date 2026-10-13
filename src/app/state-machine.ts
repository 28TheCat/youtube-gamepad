import type { Disposition, Effect, InteractionEvent, InteractionSnapshot, MenuSnapshot, RouteEvent, StateMachineModule, WatchSnapshot } from '../../types/ports';

import { YTGamepadRouteState } from './route-state.ts';
export let YTGamepadStateMachine!: StateMachineModule;
// Pure interaction rules. No DOM, clocks, media or browser history in this module.
(() => {
  if (YTGamepadStateMachine) return;
    const routeState = YTGamepadRouteState;
  const watchInitial: (playIndex?:number)=>WatchSnapshot = (playIndex = 4) => ({ row: 'controls', index: playIndex, controlIndex: playIndex,
    recommendationIndex: 0, adjusting: false, panel: '', panelIndex: 0, playIndex });
  const menuInitial: ()=>MenuSnapshot = () => ({ opened: false, view: 'main', openedFrom: null, menuSelection: 0,
    choosingLanguage: false, composing: '', candidatePage: 0, uppercase: true, frame: 'LETTER_LAYOUT', language: 'en' });
  const createState: (route?:string)=>InteractionSnapshot = (route = '/') => ({
    app: { mode: route.startsWith('/watch?') || route === '/watch' ? 'playback' : 'browse', enabled: true,
      route, settledRoute: route, returnRoute: null, openingVideo: false, watchDepth: 0,
      navigation: null, returning: false, chainVerified: true },
    watch: watchInitial(), menu: menuInitial()
  });
  const isWatch = (route: string) => route.split('?')[0] === '/watch';
  const clamp = (index: number, count: number) => Math.max(0, Math.min(Math.max(0, count - 1), index));
  function transition(state: InteractionSnapshot, event: InteractionEvent) {
    let app = state.app, watch = state.watch, menu = state.menu;
    const effects: Effect[] = [], effect = (type: string, value?: string | number | boolean) => effects.push({ type, value });
    let disposition: Disposition = 'handled';
    if (['WATCH_INPUT', 'MENU_INPUT', 'MENU_BACK', 'BASE_INPUT', 'NATIVE_CONTROLS_INPUT'].includes(event.type) &&
        (!app.enabled || app.navigation || app.returning)) {
      return { nextState: state, effects, disposition: 'blocked' as Disposition };
    }
    if (routeState.handles(event.type)) {
      const result = routeState.transition(app, event as RouteEvent);
      return { nextState: result.app === app ? state : { ...state, app: result.app },
        effects: result.effects, disposition: result.disposition };
    }
    switch (event.type) {
      case 'INPUT_OWNER': {
        // DOM visibility and generic owner availability are supplied as observations.
        if (!event.enabled || event.navigating || !app.enabled || app.navigation || app.returning) disposition = 'blocked';
        else if (event.menu) effect('owner', 'menu');
        else if (event.native) {
          if (['up', 'down', 'left', 'right', 'confirm', 'back'].includes(event.action)) effect('owner', 'native');
          else disposition = 'blocked';
        } else if (event.panel) effect('owner', 'panel');
        else if (event.help) effect('owner', 'help');
        else effect('owner', 'region');
        break;
      }
      case 'APP_INIT': app = createState(event.route).app; break;
      case 'ADAPTATION':
        app = { ...app, adaptation: { route: event.route, status: event.status, reason: event.reason || '' } };
        break;
      case 'MODE': app = { ...app, route: event.route,
        mode: app.enabled && ['playback', 'controls'].includes(event.value) &&
          (isWatch(event.route) || app.openingVideo) ? event.value : 'browse' }; break;
      case 'ENABLE':
        app = { ...app, enabled: event.enabled, route: event.route,
          mode: event.enabled ? (!app.enabled && isWatch(event.route) ? 'playback' : app.mode) : 'browse' };
        if (!event.enabled) {
          app = { ...app, returnRoute: null, watchDepth: 0, chainVerified: false, openingVideo: false };
          menu = { ...menuInitial(), language: menu.language }; watch = { ...watch, adjusting: false, panel: '' };
        }
        break;
      case 'AUTO_HIDE':
        if (app.enabled && app.mode === 'controls' && watch.row === 'controls' && !watch.panel && !menu.opened &&
          event.playing && !event.temporaryLayer && !app.navigation && !app.returning && event.idle > 5000) {
          app = { ...app, mode: 'playback' }; effect('renderMode');
        }
        break;
      case 'BASE_INPUT':
        if (!app.enabled || app.navigation || app.returning) { disposition = 'blocked'; break; }
        if (!isWatch(event.route) || app.mode !== 'playback') { disposition = 'pass'; break; }
        if (event.action === 'left' || event.action === 'right') effect('media', event.action === 'left' ? 'seekBack' : 'seekForward');
        else if (event.action === 'confirm') effect('showControls', 'controls');
        else if (event.action === 'back') effect('pageBack');
        else if (event.action === 'up' || event.action === 'down') effect('showControls', event.action === 'down' ? 'recommendations' : 'controls');
        else disposition = 'pass';
        break;
      case 'NATIVE_CONTROLS_INPUT':
        if (!isWatch(event.route) || app.mode !== 'controls') disposition = 'pass';
        else if (event.progress && event.action === 'confirm') watch = { ...watch, adjusting: !watch.adjusting };
        else if (event.progress && event.action === 'back' && watch.adjusting) watch = { ...watch, adjusting: false };
        else if (event.progress && event.action === 'back') effect('nativeControlFocus');
        else if (event.action === 'back') effect('mode', 'playback');
        else if (event.progress && ['left', 'right'].includes(event.action)) {
          if (watch.adjusting) effect('media', event.action === 'left' ? 'seekBack' : 'seekForward');
        } else if (event.progress && watch.adjusting) disposition = 'blocked';
        else { watch = { ...watch, adjusting: false }; disposition = 'pass'; }
        break;
      case 'WATCH_RESET': watch = watchInitial(event.playIndex ?? watch.playIndex); break;
      case 'WATCH_SHOW': {
        const row = event.target === 'recommendations' && event.count ? event.target : 'controls';
        watch = { ...watch, adjusting: false, row, index: row === 'controls' ? watch.controlIndex : clamp(watch.recommendationIndex, event.count) }; break;
      }
      case 'WATCH_FOCUS':
        if (event.region === 'panel') watch = { ...watch, panelIndex: event.index ?? watch.panelIndex };
        else watch = { ...watch, adjusting: event.region === 'progress' && watch.row === 'progress' ? watch.adjusting : false, row: event.region, ...(event.index === undefined ? {} : { index: event.index }),
          ...(event.region === 'controls' && event.index !== undefined ? { controlIndex: event.index } : {}),
          ...(event.region === 'recommendations' && event.index !== undefined ? { recommendationIndex: event.index } : {}) };
        break;
      case 'WATCH_PANEL': watch = { ...watch, panel: event.panel, panelIndex: 0 }; break;
      case 'WATCH_PANEL_COUNT': watch = { ...watch, panelIndex: Math.min(watch.panelIndex, event.count) }; break;
      case 'WATCH_EMPTY':
        if (watch.row === 'recommendations') watch = { ...watch, row: 'controls', index: watch.playIndex }; break;
      case 'WATCH_INPUT': {
        const action = event.action;
        if (watch.panel) {
          if (action === 'back') { watch = { ...watch, panel: '' }; effect('closePanel'); }
          else if (action === 'confirm') effect('panelClick');
          else if (action === 'up' || action === 'down') {
            if (watch.panel !== 'comments' || event.scrollDelta) effect('panelScroll', event.scrollDelta || (action === 'up' ? -180 : 180));
            else {
              watch = { ...watch, panelIndex: Math.max(0, Math.min(event.commentCount, watch.panelIndex + (action === 'up' ? -1 : 1))) };
              if (!event.commentCount && action === 'down') effect('loadComments'); effect('focus');
            }
          } else disposition = 'blocked';
          break;
        }
        if (watch.row === 'progress' && watch.adjusting) {
          if (action === 'confirm' || action === 'back') {
            watch = { ...watch, adjusting: false }; effect('focus');
          } else if (action === 'left' || action === 'right') effect('activate', action === 'left' ? 'seekBack' : 'seekForward');
          else disposition = 'blocked';
          break;
        }
        if (action === 'back') {
          if (watch.row === 'recommendations' || watch.row === 'progress') {
            watch = { ...watch, row: 'controls', index: watch.controlIndex }; effect('focus');
          } else effect('mode', 'playback');
        } else if (action === 'confirm') {
          if (watch.row === 'progress') { watch = { ...watch, adjusting: true }; effect('focus'); }
          else if (watch.row === 'recommendations') effect('recommendation', event.recommendationKey);
          else effect('activate', event.controlAction);
        } else if (action === 'left' || action === 'right') {
          if (watch.row === 'progress') disposition = 'blocked';
          else {
            const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
            let index = clamp(watch.index + (action === 'left' ? -1 : 1), watch.row === 'recommendations' ? event.cardCount : event.controlCount);
            if (watch.row === 'controls' && event.availableControls) {
              index = (action === 'left' ? [...event.availableControls].reverse().find(i => i < watch.index) : event.availableControls.find((i) => i > watch.index)) ?? watch.index;
            }
            watch = { ...watch, index, [watch.row === 'controls' ? 'controlIndex' : 'recommendationIndex']: index }; effect('focus');
          }
        } else if (action === 'up') {
          if (watch.row === 'controls' && event.canSeek === false) { disposition = 'blocked'; break; }
          if (watch.row === 'progress') { effect('mode', 'playback'); break; }
          const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
          if (watch.row === 'recommendations' && watch.index >= columns) {
            const index = watch.index - columns;
            watch = { ...watch, index, recommendationIndex: index };
          } else watch = { ...watch, row: watch.row === 'recommendations' ? 'controls' : 'progress', index: watch.controlIndex };
          effect('focus');
        } else if (action === 'down') {
          if (watch.row === 'progress') watch = { ...watch, row: 'controls', index: watch.controlIndex };
          else if (watch.row === 'controls' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          else if (watch.row === 'recommendations') {
            const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
            const nextRow = (Math.floor(watch.index / columns) + 1) * columns;
            if (nextRow < event.cardCount) {
              const index = clamp(watch.index + columns, event.cardCount);
              watch = { ...watch, index, recommendationIndex: index };
            } else effect('loadRecommendations');
          }
          effect('focus');
        } else disposition = 'pass';
        break;
      }
      case 'MENU_OPEN': menu = { ...menuInitial(), language: menu.language, opened: true }; break;
      case 'MENU_SEARCH': menu = { ...menuInitial(), language: menu.language, opened: true, view: 'search',
        openedFrom: menu.opened ? 'quickMenu' : 'pageSearch', menuSelection: menu.opened ? event.selected : 0 }; break;
      case 'MENU_CLOSE': menu = { ...menuInitial(), language: menu.language }; break;
      case 'MENU_SET_LANGUAGE': menu = { ...menu, language: event.value, composing: '', candidatePage: 0 }; break;
      case 'MENU_COMPOSE': menu = { ...menu, composing: event.value, candidatePage: 0 }; break;
      case 'MENU_PAGE': menu = { ...menu, candidatePage: Math.max(0, menu.candidatePage + event.delta) }; break;
      case 'MENU_SHIFT': menu = { ...menu, uppercase: !menu.uppercase }; break;
      case 'MENU_FRAME': menu = { ...menu, frame: event.value }; break;
      case 'MENU_LANGUAGE': menu = { ...menu, choosingLanguage: event.value }; break;
      case 'MENU_MAIN': menu = { ...menu, view: 'main' }; break;
      case 'MENU_INPUT':
        if (event.action === 'search') effect(menu.opened && menu.view === 'search' ? 'space' : 'openSearch');
        else if (event.action === 'help') effect(menu.opened ? 'closeMenu' : 'openMenu');
        else if (!menu.opened) disposition = 'pass';
        else if (event.action === 'back') return transition(state, { type: 'MENU_BACK' });
        else if (menu.view === 'search' && ['keyboardSymbols', 'keyboardCandidates'].includes(event.action)) effect(event.action);
        else if (menu.view === 'search' && ['playPause', 'mute', 'seekBack', 'seekForward', 'volumeDown', 'volumeUp'].includes(event.action)) {
          const commands: Partial<Record<import('../../types/ports').Action,string>> = { playPause: 'backspace', mute: 'space', seekBack: menu.composing ? 'pageBack' : 'cursorBack', seekForward: menu.composing ? 'pageForward' : 'cursorForward', volumeDown: 'shift', volumeUp: 'submit' };
          effect(commands[event.action]!);
        } else if (event.action === 'confirm') effect('click');
        else if (['up', 'down', 'left', 'right'].includes(event.action)) effect('navigate', event.action);
        else disposition = 'blocked';
        break;
      case 'MENU_BACK':
        if (!menu.opened) { disposition = 'pass'; break; }
        if (menu.view === 'search' && menu.choosingLanguage) {
          menu = { ...menu, choosingLanguage: false }; effect('languageFocus');
        } else if (menu.view === 'search' && menu.composing) {
          menu = { ...menu, composing: '', candidatePage: 0 }; effect('compositionFocus');
        } else if (menu.view !== 'main' && (menu.view !== 'search' || menu.openedFrom === 'quickMenu')) {
          menu = { ...menu, view: 'main' }; effect('mainFocus');
        } else { menu = { ...menuInitial(), language: menu.language }; effect('closeMenu'); }
        break;
      default: disposition = 'pass';
    }
    return { nextState: app === state.app && watch === state.watch && menu === state.menu ? state : { app, watch, menu }, effects, disposition };
  }
  function freeze(state: InteractionSnapshot) {
    if (state.app.navigation) Object.freeze(state.app.navigation);
    if (state.app.adaptation) Object.freeze(state.app.adaptation);
    Object.freeze(state.app); Object.freeze(state.watch); Object.freeze(state.menu); return Object.freeze(state);
  }
  YTGamepadStateMachine = { createState, transition, freezeSnapshot: freeze };
})();
