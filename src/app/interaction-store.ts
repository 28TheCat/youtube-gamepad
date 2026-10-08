import { defineStore } from 'pinia';
import { readonly, shallowRef } from 'vue';
import { YTGamepadStateMachine } from './state-machine.ts';
import type { InteractionEvent, InteractionSnapshot, TransitionResult } from '../../types/ports';

const rules = YTGamepadStateMachine as {
  createState(): InteractionSnapshot;
  transition(state: InteractionSnapshot, event: InteractionEvent): TransitionResult;
  freezeSnapshot(state: InteractionSnapshot): InteractionSnapshot;
};

// One page-scoped authority. Views can read state; commands commit through dispatch.
export const useInteractionStore = defineStore('interaction', () => {
  const state = shallowRef(rules.freezeSnapshot(rules.createState()));
  function dispatch(event: InteractionEvent): TransitionResult {
    const result = rules.transition(state.value, event);
    state.value = rules.freezeSnapshot(result.nextState);
    return result;
  }
  return { state: readonly(state), dispatch };
});
