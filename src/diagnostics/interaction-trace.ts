import type { Effect, InteractionEvent, InteractionSnapshot, TransitionResult } from '../../types/ports';
import { YTGamepadActions } from '../shared/actions.ts';

interface TraceStep {
  event: InteractionEvent;
  disposition: TransitionResult['disposition'];
  effects: readonly Effect[];
  changes: Partial<InteractionSnapshot>;
}

export interface InteractionReplay {
  version: 1;
  initial: InteractionSnapshot;
  steps: TraceStep[];
}

export interface InteractionTrace {
  snapshot(): InteractionReplay | undefined;
  clear(): void;
  playbackSwitchSnapshot?(): unknown;
}

const maxSteps = 48;
const maxCharacters = 32768;
const composition = (value: string) => value ? '[composing]' : '';
const recommendation = (value: string | undefined) => value === undefined ? undefined : '[item]';
const playerControls = new Set(['fullscreen', 'collection', 'goLive', 'native:progress', 'native:playPause',
  'native:mute', 'native:autoplay', 'native:captions', 'native:settings', 'native:miniplayer', 'native:theater', 'native:fullscreen']);
function control(value: string | undefined) {
  if (value === undefined || playerControls.has(value) || YTGamepadActions.get(value)) return value;
  return '[control]';
}

export function createInteractionTrace() {
  const recent: { before: InteractionSnapshot; event: InteractionEvent; result: TransitionResult }[] = [];
  return {
    record(before: InteractionSnapshot, event: InteractionEvent, result: TransitionResult) {
      // Keep semantic inputs and effects even when they leave the snapshot unchanged.
      if (result.nextState === before && !('action' in event) && !result.effects.length && result.disposition === 'handled') return;
      const copy = event.type === 'WATCH_INPUT' ? { ...event,
        availableControls: event.availableControls?.slice(), playerControls: event.playerControls?.slice() } : { ...event };
      recent.push({ before, event: copy, result });
      if (recent.length > maxSteps) recent.shift();
    },
    clear() { recent.length = 0; },
    snapshot(): InteractionReplay | undefined {
      if (!recent.length) return;
      const aliases = new Map<string, string>();
      function route(value: string) {
        if (value === '/' || value === '/watch' || value === '') return value;
        let alias = aliases.get(value);
        if (!alias) {
          alias = value.startsWith('/watch?') ? '/watch?v=route-' + aliases.size : '/route-' + aliases.size;
          aliases.set(value, alias);
        }
        return alias;
      }
      function app(state: InteractionSnapshot['app']): InteractionSnapshot['app'] {
        const { navigation, adaptation, returnRoute } = state;
        return { ...state, route: route(state.route), settledRoute: route(state.settledRoute),
          returnRoute: returnRoute === null ? null : route(returnRoute),
          navigation: navigation?.target ? { ...navigation, target: route(navigation.target) } : navigation,
          ...(adaptation ? { adaptation: { ...adaptation,
            route: adaptation.route === undefined ? undefined : route(adaptation.route), reason: '' } } : {}) };
      }
      const menu = (state: InteractionSnapshot['menu']) => ({ ...state, composing: composition(state.composing) });
      function redactEvent(event: InteractionEvent): InteractionEvent {
        const clean = { ...event };
        if ('route' in clean) clean.route = route(clean.route);
        if ('action' in clean && clean.action !== 'goLive' && !YTGamepadActions.get(clean.action)) {
          clean.action = '[unknown]' as typeof clean.action;
        }
        if (clean.type === 'PREPARE_VIDEO') clean.target = route(clean.target);
        if (clean.type === 'MENU_COMPOSE') clean.value = composition(clean.value);
        if (clean.type === 'ADAPTATION') clean.reason = '';
        if (clean.type === 'HISTORY' && clean.method !== 'pushState' && clean.method !== 'replaceState') clean.method = '[other]';
        if (clean.type === 'WATCH_INPUT') {
          clean.recommendationKey = recommendation(clean.recommendationKey);
          clean.controlAction = control(clean.controlAction);
        }
        return clean;
      }
      function redactEffect(effect: Effect): Effect {
        if (effect.type === 'assign') return { ...effect, value: route(effect.value) };
        if (effect.type === 'recommendation' && typeof effect.value === 'string') return { ...effect, value: recommendation(effect.value) };
        if (effect.type === 'activate') return { ...effect, value: control(effect.value) };
        return effect;
      }
      const steps = recent.map(({ before, event, result }): TraceStep => {
        const next = result.nextState;
        return { event: redactEvent(event), disposition: result.disposition, effects: result.effects.map(redactEffect),
          changes: {
            ...(next.app !== before.app ? { app: app(next.app) } : {}),
            ...(next.watch !== before.watch ? { watch: next.watch } : {}),
            ...(next.menu !== before.menu ? { menu: menu(next.menu) } : {})
          } };
      });
      for (let index = 0; index < steps.length; index++) {
        const before = recent[index].before;
        const replay: InteractionReplay = { version: 1,
          initial: { app: app(before.app), watch: before.watch, menu: menu(before.menu) }, steps: steps.slice(index) };
        if (JSON.stringify(replay).length <= maxCharacters) return replay;
      }
    }
  };
}
