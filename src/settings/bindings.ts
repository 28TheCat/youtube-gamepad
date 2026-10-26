import { YTGamepadBindings } from '../input/bindings.ts';
export type Layout = 'watch' | 'browse';
export type BindingAction = 'confirm' | 'back' | 'playPause' | 'search' | 'seekBack' | 'seekForward'
  | 'volumeDown' | 'volumeUp' | 'help' | 'keyboardSymbols' | 'keyboardCandidates';
export type Bindings = Record<BindingAction, number>;
export type BindingLayouts = Record<Layout, Bindings>;
export const schema = YTGamepadBindings as unknown as {
  defaults: Bindings; rightHand: Bindings; keys: Record<number, string>; labels: Record<BindingAction, string>;
  layouts: Record<Layout, string>;
  normalizeLayouts(raw?: unknown, legacy?: unknown): BindingLayouts;
  contextLabel(action: BindingAction, layout: Layout): string;
};
export const actions = Object.keys(schema.labels) as BindingAction[];
export const physicalLabels: Record<string, string> = {
  A: 'A / × · Bottom', B: 'B / ○ · Right', X: 'X / □ · Left', Y: 'Y / △ · Top', LB: 'LB / L1', RB: 'RB / R1',
  LT: 'LT / L2', RT: 'RT / R2', Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'L3 · Left stick press', R3: 'R3 · Right stick press'
};
export const physicalIcons: Record<string, string[]> = {
  A: ['xbox_button_color_a', 'playstation_button_color_cross'], B: ['xbox_button_color_b', 'playstation_button_color_circle'],
  X: ['xbox_button_color_x', 'playstation_button_color_square'], Y: ['xbox_button_color_y', 'playstation_button_color_triangle'],
  LB: ['xbox_lb', 'playstation_trigger_l1'], RB: ['xbox_rb', 'playstation_trigger_r1'],
  LT: ['xbox_lt', 'playstation_trigger_l2'], RT: ['xbox_rt', 'playstation_trigger_r2'],
  Start: ['xbox_button_menu', 'playstation4_button_options'], Select: ['xbox_button_view', 'playstation4_button_share'],
  L3: ['xbox_stick_l_press', 'playstation_stick_l_press'], R3: ['xbox_stick_r_press', 'playstation_stick_r_press']
};
export const positions: Record<string, string> = {
  A: 'Bottom', B: 'Right', X: 'Left', Y: 'Top', LB: 'Left bumper', RB: 'Right bumper', LT: 'Left trigger', RT: 'Right trigger',
  Select: 'View / Share / −', Start: 'Menu / Options / +', L3: 'Left stick press', R3: 'Right stick press'
};
export const positionsOnPad: Record<string, [number, number]> = {
  A: [71.932, 46.144], B: [79.198, 36.623], X: [64.566, 36.623], Y: [71.882, 25.743],
  LB: [31.9, 10.5], RB: [68.1, 10.5], LT: [23.5, 7], RT: [76.5, 7],
  Select: [45.769, 32.601], Start: [54.271, 32.533], L3: [35.636, 62.546], R3: [64.475, 62.407]
};
export function swapBinding(values: Bindings, action: BindingAction, button: number) {
  if (!Number.isInteger(button) || !Object.hasOwn(schema.keys, button)) throw new Error('Invalid physical button');
  const conflict = actions.find(other => other !== action && values[other] === button);
  const next = { ...values, [action]: button };
  if (conflict) next[conflict] = values[action];
  return { next, conflict };
}
