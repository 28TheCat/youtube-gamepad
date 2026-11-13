import { defineStore } from 'pinia';
import { readonly, shallowRef } from 'vue';
import { YTGamepadStateMachine } from './state-machine.ts';
import { createInteractionTrace } from '../diagnostics/interaction-trace.ts';
import type { InteractionEvent, TransitionResult } from '../../types/ports';

// One page-scoped authority. Views can read state; commands commit through dispatch.
export const useInteractionStore = defineStore('interaction', () => {
  const state = shallowRef(YTGamepadStateMachine.freezeSnapshot(YTGamepadStateMachine.createState()));
  const trace = createInteractionTrace();
  function dispatch<Event extends InteractionEvent>(event: Event): TransitionResult<Event> {
    const before = state.value;
    const result = YTGamepadStateMachine.transition(before, event);
    trace.record(before, event, result);
    state.value = YTGamepadStateMachine.freezeSnapshot(result.nextState);
    return result;
  }
  return { state: readonly(state), dispatch, snapshotTrace: trace.snapshot, clearTrace: trace.clear };
});
