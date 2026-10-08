import { h, render } from 'vue';
import PlaybackControls from './PlaybackControls.vue';
import PlaybackFeedback from './PlaybackFeedback.vue';
import type { WatchView, WatchViewDependencies } from '../../types/ports';
import type { PlaybackPresentation, PlaybackPresenter } from './playback-presentation';
import { createPlaybackModel } from '../playback/playback-model';

export function createVueWatchView({ activate, seek, closePanel, controllerStyle, styles }: WatchViewDependencies): WatchView {
  const host = document.createElement('div'); host.id = 'ytg-watch'; host.hidden = true; host.lang = 'en';
  const root = host.attachShadow({ mode: 'open' });
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = make('style'); style.textContent = styles.watch;
  // Shell/panels retain their lifecycle; Vue exclusively owns controls and feedback.
  const surface = make('div', 'surface'), container = make('div'); container.style.display = 'contents'; surface.append(container);
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Video description');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', 'Video description'), description = make('div', 'description'), close = make('button', 'control', 'Back');
  close.addEventListener('click', closePanel); sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status'); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status); document.body.append(host);
  let destroyed = false;
  const model = createPlaybackModel({ activate, seek: seconds => seek ? seek(seconds) : false });
  let view: PlaybackPresentation = {
    page: { key: '', isWatch: true, title: '', channel: '', description: '', recommendations: [] },
    features: {}, selected: '', adjusting: false, row: 'controls', start: 0
  };
  const paint = () => {
    if (!destroyed) render(h(PlaybackControls, { view, model, controllerStyle, activate: model.request, openVideo: (key: string) => model.request('recommendation:' + key) }), container);
  };
  const patch = (values: Partial<PlaybackPresentation>) => { view = { ...view, ...values }; paint(); };
  const presentation: PlaybackPresenter = {
    playback(value) { model.update(value); patch({}); },
    visible(value) { model.visible(value); },
    page(value, features) { patch({ page: value, features }); },
    selection(row, selected, adjusting) { if (row !== 'progress' || !selected) model.cancelPreview(); patch({ row, selected, adjusting }); },
    recommendationPage(start) { if (start !== view.start) patch({ start }); },
    feedback(value) { if (!destroyed) render(h(PlaybackFeedback, { value }), status); },
    cards() { return Array.from(container.querySelectorAll<HTMLButtonElement>('.card')); },
    reset() { model.reset(); patch({ page: { ...view.page, recommendations: [] }, selected: '', start: 0 }); },
    destroy() { if (destroyed) return; destroyed = true; model.destroy(); render(null, container); render(null, status); }
  };
  paint();
  const node = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = container.querySelector<T>(selector);
    if (!found) throw new Error('Missing playback view element: ' + selector);
    return found;
  };
  return {
    host, root, surface, dialog, sheet, panelTitle, description, close, status, make,
    progress: node<HTMLButtonElement>('.progress'),
    controls: Array.from(container.querySelectorAll<HTMLButtonElement>('[data-action]')), recommendations: node('.recommendations'),
    updateHint(row, adjusting) { if (row !== view.row || adjusting !== view.adjusting) patch({ row, adjusting }); },
    presentation
  };
}
