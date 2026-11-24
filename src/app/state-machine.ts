import type { Disposition, Effect, EffectFor, InteractionEvent, InteractionSnapshot, MenuSnapshot, RouteEvent, StateMachineModule, TransitionResult, WatchSnapshot } from '../../types/ports';

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
  function transition<Event extends InteractionEvent>(state: InteractionSnapshot, event: Event): TransitionResult<Event>;
  function transition(state: InteractionSnapshot, event: InteractionEvent): TransitionResult {
    let app = state.app, watch = state.watch, menu = state.menu;
    const effects: Effect[] = [];
    // Each branch can emit only the commands declared for its event.
    function emit<Type extends InteractionEvent['type']>(_type: Type, command: EffectFor<NoInfer<Type>>) {
      effects.push(command);
    }
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
        else if (event.menu) emit(event.type, { type: 'owner', value: 'menu' });
        else if (event.native) {
          if (['up', 'down', 'left', 'right', 'confirm', 'back'].includes(event.action)) emit(event.type, { type: 'owner', value: 'native' });
          else disposition = 'blocked';
        } else if (event.panel) emit(event.type, { type: 'owner', value: 'panel' });
        else if (event.help) emit(event.type, { type: 'owner', value: 'help' });
        else emit(event.type, { type: 'owner', value: 'region' });
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
          if (app.navigation?.source === 'extension' && !app.navigation.traversal) {
            const result = routeState.transition(app, { type: 'REQUEST_CANCEL', id: app.navigation.id, route: event.route });
            app = { ...result.app, returnRoute: null, chainVerified: false };
          }
          menu = { ...menuInitial(), language: menu.language }; watch = { ...watch, adjusting: false, panel: '' };
        }
        break;
      case 'AUTO_HIDE':
        if (app.enabled && app.mode === 'controls' && watch.row === 'controls' && !watch.panel && !menu.opened &&
          event.playing && !event.temporaryLayer && !app.navigation && !app.returning && event.idle > 5000) {
          app = { ...app, mode: 'playback' }; emit(event.type, { type: 'renderMode' });
        }
        break;
      case 'BASE_INPUT':
        if (!app.enabled || app.navigation || app.returning) { disposition = 'blocked'; break; }
        if (!isWatch(event.route) || app.mode !== 'playback') { disposition = 'pass'; break; }
        if (event.action === 'left' || event.action === 'right') emit(event.type, { type: 'media', value: event.action === 'left' ? 'seekBack' : 'seekForward' });
        else if (event.action === 'confirm') emit(event.type, { type: 'showControls', value: 'controls' });
        else if (event.action === 'back') emit(event.type, { type: 'pageBack' });
        else if (event.action === 'up' || event.action === 'down') emit(event.type, { type: 'showControls', value: event.action === 'down' ? 'recommendations' : 'controls' });
        else disposition = 'pass';
        break;
      case 'NATIVE_CONTROLS_INPUT':
        if (!isWatch(event.route) || app.mode !== 'controls') disposition = 'pass';
        else if (event.progress && event.action === 'confirm') watch = { ...watch, adjusting: !watch.adjusting };
        else if (event.progress && event.action === 'back' && watch.adjusting) watch = { ...watch, adjusting: false };
        else if (event.progress && event.action === 'back') emit(event.type, { type: 'nativeControlFocus' });
        else if (event.action === 'back') emit(event.type, { type: 'mode', value: 'playback' });
        else if (event.progress && ['left', 'right'].includes(event.action)) {
          if (watch.adjusting) emit(event.type, { type: 'media', value: event.action === 'left' ? 'seekBack' : 'seekForward' });
        } else if (event.progress && watch.adjusting) disposition = 'blocked';
        else { watch = { ...watch, adjusting: false }; disposition = 'pass'; }
        break;
      case 'WATCH_RESET': watch = watchInitial(event.playIndex ?? watch.playIndex); break;
      case 'WATCH_CONTROL_LAYOUT':
        watch = { ...watch, playIndex: event.playIndex, controlIndex: event.index,
          ...(watch.row === 'controls' ? { index: event.index } : {}) }; break;
      case 'WATCH_SHOW': {
        const row = event.target === 'recommendations' && event.count ? event.target : 'controls';
        watch = { ...watch, adjusting: false, row, index: row === 'controls' ? watch.controlIndex : clamp(watch.recommendationIndex, event.count) }; break;
      }
      case 'WATCH_FOCUS':
        if (event.region === 'panel') watch = { ...watch, commentsParked: false, panelIndex: event.index ?? watch.panelIndex };
        else watch = { ...watch, commentsParked: watch.panel === 'comments', adjusting: event.region === 'progress' && watch.row === 'progress' ? watch.adjusting : false, row: event.region, ...(event.index === undefined ? {} : { index: event.index }),
          ...(event.region === 'controls' && event.index !== undefined ? { controlIndex: event.index } : {}),
          ...(event.region === 'recommendations' && event.index !== undefined ? { recommendationIndex: event.index } : {}) };
        break;
      case 'WATCH_PANEL': watch = { ...watch, panel: event.panel, adjusting: false, commentsParked: false, panelIndex: 0 }; break;
      case 'WATCH_PANEL_COUNT': watch = { ...watch, panelIndex: Math.min(watch.panelIndex, event.count) }; break;
      case 'WATCH_EMPTY':
        if (watch.row === 'recommendations') watch = { ...watch, row: 'controls', index: watch.playIndex }; break;
      case 'WATCH_INPUT': {
        const action = event.action;
        if (watch.panel && !watch.commentsParked) {
          if (action === 'back') { watch = { ...watch, panel: '' }; emit(event.type, { type: 'closePanel' }); }
          else if (action === 'confirm') emit(event.type, { type: 'panelClick' });
          else if (watch.panel === 'description' && (action === 'left' || action === 'right')) {
            watch = { ...watch, panelIndex: Math.max(0, Math.min(event.commentCount, watch.panelIndex + (action === 'left' ? -1 : 1))) };
            emit(event.type, { type: 'focus' });
          }
          else if (action === 'up' || action === 'down') {
            if (watch.panel === 'description' || event.scrollDelta) emit(event.type, { type: 'panelScroll', value: event.scrollDelta || (action === 'up' ? -180 : 180) });
            else {
              watch = { ...watch, panelIndex: Math.max(0, Math.min(event.commentCount, watch.panelIndex + (action === 'up' ? -1 : 1))) };
              if (!event.commentCount && action === 'down' && watch.panel === 'comments') emit(event.type, { type: 'loadComments' }); emit(event.type, { type: 'focus' });
            }
          } else disposition = 'blocked';
          break;
        }
        if (watch.row === 'progress' && watch.adjusting) {
          if (action === 'confirm' || action === 'back') {
            watch = { ...watch, adjusting: false }; emit(event.type, { type: 'focus' });
          } else if (action === 'left' || action === 'right') emit(event.type, { type: 'activate', value: action === 'left' ? 'seekBack' : 'seekForward' });
          else disposition = 'blocked';
          break;
        }
        if (event.windowed && ['up', 'down', 'left', 'right'].includes(action)) {
          const playerControls = event.playerControls || [];
          const inPlayerControls = playerControls.includes(watch.index);
          const detailControls = (event.availableControls || []).filter(index => !playerControls.includes(index));
          if (watch.row === 'player') {
            if (action === 'down') watch = event.canSeek ? { ...watch, row: 'progress', index: 0 }
              : { ...watch, row: 'controls', index: watch.playIndex, controlIndex: watch.playIndex };
            else if (action === 'right' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          } else if (watch.row === 'metadata') {
            if (action === 'up') watch = { ...watch, row: 'controls', index: watch.playIndex, controlIndex: watch.playIndex };
            else if (action === 'down') watch = { ...watch, row: 'controls', index: detailControls[0] ?? 0, controlIndex: detailControls[0] ?? 0 };
            else if (action === 'right' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          } else if (watch.row === 'recommendations') {
            if (action === 'left') watch = { ...watch, row: 'player', index: 0 };
            else if (action === 'up' && watch.index > 0) watch = { ...watch, index: watch.index - 1, recommendationIndex: watch.index - 1 };
            else if (action === 'down' && watch.index + 1 < event.cardCount) watch = { ...watch, index: watch.index + 1, recommendationIndex: watch.index + 1 };
            else if (action === 'down') emit(event.type, { type: 'loadRecommendations' });
          } else if (watch.row === 'progress') {
            if (action === 'up') watch = { ...watch, row: 'player', index: 0 };
            else if (action === 'down') watch = { ...watch, row: 'controls', index: playerControls.includes(watch.controlIndex) ? watch.controlIndex : watch.playIndex };
            else if (action === 'right' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          } else if (action === 'up') watch = event.canSeek && inPlayerControls
            ? { ...watch, row: 'progress', index: 0 }
            : inPlayerControls ? { ...watch, row: 'player', index: 0 } : { ...watch, row: 'metadata', index: 0 };
          else if (action === 'down' && inPlayerControls) watch = { ...watch, row: 'metadata', index: 0 };
          else if (action === 'right' || action === 'left') {
            const controls = inPlayerControls ? playerControls : detailControls;
            const position = controls.indexOf(watch.index);
            const next = controls[position + (action === 'left' ? -1 : 1)];
            if (next !== undefined) watch = { ...watch, index: next, controlIndex: next };
            else if (action === 'right' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          }
          emit(event.type, { type: 'focus' }); break;
        }
        if (action === 'back') {
          if (event.windowed && watch.row === 'metadata') { watch = { ...watch, row: 'player', index: 0 }; emit(event.type, { type: 'focus' }); }
          else if (watch.row === 'recommendations' || watch.row === 'progress') {
            watch = { ...watch, row: event.windowed ? 'player' : 'controls', index: event.windowed ? 0 : watch.controlIndex }; emit(event.type, { type: 'focus' });
          } else if (event.windowed && watch.row === 'controls') { watch = { ...watch, row: 'player', index: 0 }; emit(event.type, { type: 'focus' }); }
          else emit(event.type, { type: 'mode', value: 'playback' });
        } else if (action === 'confirm') {
          if (watch.row === 'player') emit(event.type, { type: 'activate', value: 'fullscreen' });
          else if (watch.row === 'metadata') emit(event.type, { type: 'activate', value: 'description' });
          else if (watch.row === 'progress') { watch = { ...watch, adjusting: true }; emit(event.type, { type: 'focus' }); }
          else if (watch.row === 'recommendations') emit(event.type, { type: 'recommendation', value: event.recommendationKey });
          else emit(event.type, { type: 'activate', value: event.controlAction });
        } else if (action === 'left' || action === 'right') {
          if (watch.row === 'progress') disposition = 'blocked';
          else {
            let index = clamp(watch.index + (action === 'left' ? -1 : 1), watch.row === 'recommendations' ? event.cardCount : event.controlCount);
            if (watch.row === 'recommendations') {
              const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
              const rowStart = Math.floor(watch.index / columns) * columns;
              index = Math.max(rowStart, Math.min(index, rowStart + columns - 1));
            }
            if (watch.row === 'controls' && event.availableControls) {
              index = (action === 'left' ? [...event.availableControls].reverse().find(i => i < watch.index) : event.availableControls.find((i) => i > watch.index)) ?? watch.index;
            }
            watch = { ...watch, index, [watch.row === 'controls' ? 'controlIndex' : 'recommendationIndex']: index }; emit(event.type, { type: 'focus' });
          }
        } else if (action === 'up') {
          if (watch.row === 'controls' && event.canSeek === false) { disposition = 'blocked'; break; }
          if (watch.row === 'progress') { emit(event.type, { type: 'mode', value: 'playback' }); break; }
          const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
          if (watch.row === 'recommendations' && watch.index >= columns) {
            const index = watch.index - columns;
            watch = { ...watch, index, recommendationIndex: index };
          } else watch = { ...watch, row: watch.row === 'recommendations' ? 'controls' : 'progress', index: watch.controlIndex };
          emit(event.type, { type: 'focus' });
        } else if (action === 'down') {
          if (watch.row === 'progress') watch = { ...watch, row: 'controls', index: watch.controlIndex };
          else if (watch.row === 'controls' && event.cardCount) watch = { ...watch, row: 'recommendations', index: clamp(watch.recommendationIndex, event.cardCount) };
          else if (watch.row === 'recommendations') {
            const columns = Math.max(1, event.cardColumns || event.cardCount || 1);
            const nextRow = (Math.floor(watch.index / columns) + 1) * columns;
            if (nextRow < event.cardCount) {
              const index = clamp(watch.index + columns, event.cardCount);
              watch = { ...watch, index, recommendationIndex: index };
            } else emit(event.type, { type: 'loadRecommendations' });
          }
          emit(event.type, { type: 'focus' });
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
        if (event.action === 'search') emit(event.type, { type: menu.opened && menu.view === 'search' ? 'space' : 'openSearch' });
        else if (event.action === 'help') emit(event.type, { type: menu.opened ? 'closeMenu' : 'openMenu' });
        else if (!menu.opened) disposition = 'pass';
        else if (event.action === 'back') return transition(state, { type: 'MENU_BACK' });
        else if (menu.view === 'search' && (event.action === 'keyboardSymbols' || event.action === 'keyboardCandidates')) emit(event.type, { type: event.action });
        else if (menu.view === 'search' && (event.action === 'playPause' || event.action === 'mute' ||
          event.action === 'seekBack' || event.action === 'seekForward' || event.action === 'volumeDown' || event.action === 'volumeUp')) {
          const commands = { playPause: 'backspace', mute: 'space', seekBack: menu.composing ? 'pageBack' : 'cursorBack',
            seekForward: menu.composing ? 'pageForward' : 'cursorForward', volumeDown: 'shift', volumeUp: 'submit' } as const;
          emit(event.type, { type: commands[event.action] });
        } else if (event.action === 'confirm') emit(event.type, { type: 'click' });
        else if (event.action === 'up' || event.action === 'down' || event.action === 'left' || event.action === 'right') {
          emit(event.type, { type: 'navigate', value: event.action });
        }
        else disposition = 'blocked';
        break;
      case 'MENU_BACK':
        if (!menu.opened) { disposition = 'pass'; break; }
        if (menu.view === 'search' && menu.choosingLanguage) {
          menu = { ...menu, choosingLanguage: false }; emit(event.type, { type: 'languageFocus' });
        } else if (menu.view === 'search' && menu.composing) {
          menu = { ...menu, composing: '', candidatePage: 0 }; emit(event.type, { type: 'compositionFocus' });
        } else if (menu.view !== 'main' && (menu.view !== 'search' || menu.openedFrom === 'quickMenu')) {
          menu = { ...menu, view: 'main' }; emit(event.type, { type: 'mainFocus' });
        } else { menu = { ...menuInitial(), language: menu.language }; emit(event.type, { type: 'closeMenu' }); }
        break;
      default: disposition = 'pass';
    }
    return { nextState: app === state.app && watch === state.watch && menu === state.menu ? state : { app, watch, menu }, effects, disposition };
  }
  function freeze(state: InteractionSnapshot) {
    if (state.app.navigation) Object.freeze(state.app.navigation);
    if (state.app.lastNavigation) Object.freeze(state.app.lastNavigation);
    if (state.app.adaptation) Object.freeze(state.app.adaptation);
    Object.freeze(state.app); Object.freeze(state.watch); Object.freeze(state.menu); return Object.freeze(state);
  }
  YTGamepadStateMachine = { createState, transition, freezeSnapshot: freeze };
})();
