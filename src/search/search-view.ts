import type { ControllerStyle, KeyboardKey, PinyinCandidate } from '../../types/ports.js';

export interface SearchView {
  query: string;
  composing: string;
  chinese: boolean;
  choosingLanguage: boolean;
  rows: KeyboardKey[][];
  recent: readonly string[];
  candidates: readonly PinyinCandidate[];
  previous: boolean;
  next: boolean;
}
export interface SearchViewActions {
  input(input: HTMLInputElement): void;
  focus(button: HTMLButtonElement): void;
  key(key: KeyboardKey): void;
  candidate(candidate: PinyinCandidate): void;
  page(delta: number): void;
  raw(): void;
  recent(query: string): void;
  submit(): void;
}
export interface SearchRenderer {
  update(view: SearchView): void;
  dispose(): void;
}
export type MountSearch = (container: HTMLElement, view: SearchView,
  actions: SearchViewActions, controllerStyle: ControllerStyle) => SearchRenderer;
