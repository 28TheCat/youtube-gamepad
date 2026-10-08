import type { ModuleFactory, WatchView, WatchViewDependencies } from '../../types/ports';
import { YTGamepadActions } from '../shared/actions.ts';
export let YTGamepadWatchView!: ModuleFactory<WatchViewDependencies,WatchView>;
// Safe DOM construction and styling. No site operations or interaction state.
(() => {
  if (YTGamepadWatchView) return;
    YTGamepadWatchView = {
    /** @param {import('../../types/ports.js').WatchViewDependencies} dependencies */
    create({ activate, seek, closePanel, controllerStyle, styles }: import('../../types/ports.js').WatchViewDependencies) {
  const host = document.createElement('div');
  host.id = 'ytg-watch'; host.hidden = true; host.setAttribute('lang', 'en');
  const root = host.attachShadow({ mode: 'open' });
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const style = make('style');
  style.textContent = styles.watch;
  const surface = make('div', 'surface'), heading = make('header', 'heading');
  const title = make('h1', 'title', 'Loading video…'), meta = make('p', 'meta', '');
  heading.append(title, meta);
  const bottom = make('section', 'bottom'), times = make('div', 'times');
  const elapsed = make('span', '', '0:00'), duration = make('span', '', '0:00');
  times.append(elapsed, duration);
  const progress = make('button', 'progress');
  progress.setAttribute('role', 'slider'); progress.setAttribute('aria-label', 'Playback position');
  progress.setAttribute('aria-valuemin', '0');
  const track = make('span', 'track'), fill = make('span', 'fill'); track.append(fill); progress.append(track);
  const toolbar = make('nav', 'toolbar'); toolbar.setAttribute('aria-label', 'Video controls');
  const left = make('div', 'group'), center = make('div', 'group'), right = make('div', 'group');
  // Unmodified Google Material Icons filled paths (Apache-2.0).
  // Upstream revision 737e3324305806514d7909874fa1818ae1808232; see THIRD_PARTY_NOTICES.md.
  const icons: Record<string,{tag:string;value:string}[]> = {
    "previous": [
      {
        "tag": "path",
        "value": "M11.99,5V1l-5,5l5,5V7c3.31,0,6,2.69,6,6s-2.69,6-6,6s-6-2.69-6-6h-2c0,4.42,3.58,8,8,8s8-3.58,8-8S16.41,5,11.99,5z"
      },
      {
        "tag": "path",
        "value": "M10.89,16h-0.85v-3.26l-1.01,0.31v-0.69l1.77-0.63h0.09V16z"
      },
      {
        "tag": "path",
        "value": "M15.17,14.24c0,0.32-0.03,0.6-0.1,0.82s-0.17,0.42-0.29,0.57s-0.28,0.26-0.45,0.33s-0.37,0.1-0.59,0.1 s-0.41-0.03-0.59-0.1s-0.33-0.18-0.46-0.33s-0.23-0.34-0.3-0.57s-0.11-0.5-0.11-0.82V13.5c0-0.32,0.03-0.6,0.1-0.82 s0.17-0.42,0.29-0.57s0.28-0.26,0.45-0.33s0.37-0.1,0.59-0.1s0.41,0.03,0.59,0.1c0.18,0.07,0.33,0.18,0.46,0.33 s0.23,0.34,0.3,0.57s0.11,0.5,0.11,0.82V14.24z M14.32,13.38c0-0.19-0.01-0.35-0.04-0.48s-0.07-0.23-0.12-0.31 s-0.11-0.14-0.19-0.17s-0.16-0.05-0.25-0.05s-0.18,0.02-0.25,0.05s-0.14,0.09-0.19,0.17s-0.09,0.18-0.12,0.31 s-0.04,0.29-0.04,0.48v0.97c0,0.19,0.01,0.35,0.04,0.48s0.07,0.24,0.12,0.32s0.11,0.14,0.19,0.17s0.16,0.05,0.25,0.05 s0.18-0.02,0.25-0.05s0.14-0.09,0.19-0.17s0.09-0.19,0.11-0.32s0.04-0.29,0.04-0.48V13.38z"
      }
    ],
    "next": [
      {
        "tag": "path",
        "value": "M18,13c0,3.31-2.69,6-6,6s-6-2.69-6-6s2.69-6,6-6v4l5-5l-5-5v4c-4.42,0-8,3.58-8,8c0,4.42,3.58,8,8,8s8-3.58,8-8H18z"
      },
      {
        "tag": "polygon",
        "value": "10.86,15.94 10.86,11.67 10.77,11.67 9,12.3 9,12.99 10.01,12.68 10.01,15.94"
      },
      {
        "tag": "path",
        "value": "M12.25,13.44v0.74c0,1.9,1.31,1.82,1.44,1.82c0.14,0,1.44,0.09,1.44-1.82v-0.74c0-1.9-1.31-1.82-1.44-1.82 C13.55,11.62,12.25,11.53,12.25,13.44z M14.29,13.32v0.97c0,0.77-0.21,1.03-0.59,1.03c-0.38,0-0.6-0.26-0.6-1.03v-0.97 c0-0.75,0.22-1.01,0.59-1.01C14.07,12.3,14.29,12.57,14.29,13.32z"
      }
    ],
    "pause": [
      {
        "tag": "path",
        "value": "M6 19h4V5H6v14zm8-14v14h4V5h-4z"
      }
    ],
    "play": [
      {
        "tag": "path",
        "value": "M8 5v14l11-7z"
      }
    ],
    "captions": [
      {
        "tag": "path",
        "value": "M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"
      }
    ],
    "settings": [
      {
        "tag": "path",
        "value": "M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"
      }
    ],
    "like": [
      {
        "tag": "path",
        "value": "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
      }
    ],
    "dislike": [
      {
        "tag": "path",
        "value": "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"
      }
    ],
    "comments": [
      {
        "tag": "path",
        "value": "M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"
      }
    ],
    "save": [
      {
        "tag": "path",
        "value": "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm0 15l-5-2.18L7 18V5h10v13z"
      }
    ]
  };
  function icon(name: string|number) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const shape of icons[name]) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', shape.tag);
      node.setAttribute(shape.tag === 'path' ? 'd' : 'points', shape.value);
      svg.append(node);
    }
    return svg;
  }
  const controls = [];
  function button(group: HTMLElement, action: string, symbol?: string|undefined) {
    const definition = YTGamepadActions.get(action)!;
    const label = definition.controlLabel || definition.label;
    const node = make('button', 'control' + (action === 'playPause' ? ' play' : ''));
    node.setAttribute('aria-label', label); node.dataset.action = action;
    node.title = label;
    node.append(symbol ? icon(symbol) : make('span', '', label));
    node.addEventListener('click', () => activate(action));
    group.append(node); controls.push(node); return node;
  }
  const avatarButton = button(left, 'channel'); avatarButton.classList.add('avatar');
  const avatarImage = make('img'); avatarImage.alt = ''; avatarImage.hidden = true;
  const avatarFallback = make('span', '', '●');
  avatarImage.addEventListener('error', () => { avatarImage.hidden = true; avatarFallback.hidden = false; });
  avatarButton.replaceChildren(avatarImage, avatarFallback);
  button(left, 'description');
  const subscribeButton = button(left, 'subscribe');
  button(center, 'seekBack', 'previous');
  const playButton = button(center, 'playPause', 'pause');
  button(center, 'seekForward', 'next');
  const social = make('div', 'cluster'), preferences = make('div', 'cluster');
  const likeButton = button(social, 'like', 'like');
  const dislikeButton = button(social, 'dislike', 'dislike');
  button(social, 'comments', 'comments');
  button(social, 'save', 'save');
  const captionsButton = button(preferences, 'captions', 'captions');
  button(preferences, 'settings', 'settings');
  const liveButton = make('button', 'control', 'Go live');
  liveButton.dataset.action = 'goLive'; liveButton.hidden = true;
  liveButton.setAttribute('aria-label', 'Go live');
  liveButton.addEventListener('click', () => activate('goLive'));
  preferences.append(liveButton); controls.push(liveButton);
  right.append(social, preferences);
  toolbar.append(left, center, right);
  const recommendations = make('div', 'recommendations'); recommendations.setAttribute('aria-label', 'Recommended videos');
  const empty = make('p', 'empty', 'Loading recommendations…');
  progress.addEventListener('click', () => activate('adjustProgress'));
  const hint = make('div', 'hint');
  let hintMode: string;
  function updateHint(row: string, adjusting: boolean, canSeek = true) {
    const mode = row === 'progress' ? (adjusting ? 'adjusting' : 'progress') : row === 'recommendations' ? 'recommendations' : 'controls';
    const key = mode + canSeek;
    if (key === hintMode) return;
    hintMode = key;
    const entries = mode === 'adjusting' ? [['← / →', 'Seek'], ['A', 'Finish adjusting'], ['B', 'Back to timeline']]
      : mode === 'progress' ? [['A', 'Adjust position'], ['↑', 'Hide controls'], ['↓ / B', 'Back to controls']]
      : mode === 'recommendations' ? [['↑ / ↓', 'Change group'], ['← / →', 'Select video'], ['A', 'Play'], ['B', 'Back to controls'], ['Start', 'Menu']]
      : [['A', 'Confirm'], ['B', 'Back'], ...(canSeek ? [['↑', 'Timeline · A Adjust']] : []), ['↓', 'Recommendations'], ...(canSeek ? [['LB / RB', 'Rewind / forward']] : []), ['Start', 'Menu']];
    hint.replaceChildren();
    for (const [key, label] of entries) {
      const item = make('span', 'hint-item');
      item.append(controllerStyle.badge(make('kbd'), key), controllerStyle.hint(make('span'), label));
      hint.append(item);
    }
  }
  updateHint('controls', false);
  bottom.append(times, progress, toolbar, recommendations, empty, hint);
  surface.append(heading, bottom);
  const dialog = make('div', 'dialog'); dialog.hidden = true; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Video description');
  const sheet = make('section', 'sheet'), panelTitle = make('h2', '', 'Video description'), description = make('div', 'description');
  const close = make('button', 'control', 'Back'); close.addEventListener('click', closePanel);
  sheet.append(panelTitle, description, close); dialog.append(sheet);
  const status = make('div', 'status', ''); status.setAttribute('role', 'status');
  root.append(style, surface, dialog, status); document.body.append(host);
  // Test-only presenter for minimal VM DOM doubles. Real rendering is tested
  // through the bundled Vue entry in playback-vue.test.mjs.
  let cards: HTMLButtonElement[] = [];
  const time = (value: number) => {
    if (!Number.isFinite(value)) return 'Live';
    const seconds = Math.max(0, Math.floor(value)), hours = Math.floor(seconds / 3600);
    return (hours ? hours + ':' : '') + (hours ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0');
  };
  const presentation = {
    visible() {},
    playback(value: import('../../types/ports').PlaybackSnapshot) {
      const video = value.video, timeline = video?.timeline;
      const canSeek = !!timeline?.canSeek, start = timeline?.start || 0, end = timeline?.end || 0;
      const current = Number.isFinite(video?.currentTime) ? video!.currentTime : start;
      progress.disabled = !canSeek;
      progress.setAttribute('aria-disabled', String(!canSeek));
      progress.setAttribute('aria-valuemin', String(start)); progress.setAttribute('aria-valuemax', String(end));
      progress.setAttribute('aria-valuenow', String(Math.min(end, Math.max(start, current))));
      elapsed.textContent = timeline?.isLive ? (timeline.atLiveEdge ? 'Live' : 'Behind live by ' + time(end - current)) : time(current);
      duration.textContent = timeline?.isLive ? 'Live' : time(video?.duration || 0);
      fill.style.width = (canSeek && end > start ? Math.min(100, Math.max(0, (current - start) / (end - start) * 100)) : 0) + '%';
      liveButton.hidden = !timeline?.isLive; liveButton.disabled = !canSeek || !!timeline?.atLiveEdge;
      for (const button of controls) if (['seekBack', 'seekForward'].includes(button.dataset.action || '')) button.disabled = !canSeek;
      playButton.replaceChildren(icon(video?.paused ? 'play' : 'pause'));
      playButton.setAttribute('aria-label', video?.paused ? 'Play' : 'Pause');
      captionsButton.setAttribute('aria-pressed', String(value.captionsEnabled));
    },
    page(page: import('../../types/ports').WatchPageSnapshot, features: import('../../types/ports').WatchFeatures) {
      title.textContent = page.title || 'Loading video…'; meta.textContent = page.channel;
      cards = page.recommendations.map(item => {
        const card = make('button', 'card'); card.dataset.videoId = item.key;
        card.setAttribute('aria-label', item.label);
        const thumbnail = make('div', 'card-thumbnail'), image = make('img'); image.alt = ''; image.loading = 'lazy';
        let usedFallback = !item.thumbnail || item.thumbnail === item.thumbnailFallback;
        image.addEventListener('error', () => {
          if (!usedFallback && item.thumbnailFallback) { usedFallback = true; image.src = item.thumbnailFallback; }
          else image.style.visibility = 'hidden';
        });
        if (item.thumbnail || item.thumbnailFallback) image.src = item.thumbnail || item.thumbnailFallback;
        else image.style.visibility = 'hidden';
        thumbnail.append(image);
        if (item.duration) thumbnail.append(make('span', 'card-duration', item.duration));
        card.append(thumbnail, make('div', 'card-title', item.label), make('div', 'card-meta', item.channel));
        if (item.metadata) card.append(make('div', 'card-meta', item.metadata));
        card.addEventListener('click', () => activate('recommendation:' + item.key)); return card;
      });
      recommendations.replaceChildren(...cards); empty.hidden = cards.length > 0;
    },
    selection(row: string, selected: string, adjusting: boolean) {
      progress.classList.toggle('adjusting', adjusting);
      [...controls, progress, ...cards].forEach(node => node.classList.toggle('selected',
        node === progress ? selected === 'progress' : cards.includes(node) ? selected === 'recommendation:' + cards.indexOf(node) : selected === node.dataset.action));
    },
    recommendationPage(start: number) { cards.forEach((card, index) => { card.hidden = index < start || index >= start + 4; }); },
    feedback(value: { label: string; icon?: string; level?: number } | null) {
      status.replaceChildren(); status.textContent = value?.label || '';
      if (value?.icon) status.append(icon(value.icon));
      if (value?.level !== undefined) { const track = make('span', 'feedback-track'), level = make('span', 'feedback-level'); level.style.width = value.level + '%'; track.append(level); status.append(track); }
    },
    reset() { cards = []; recommendations.replaceChildren(); }, cards() { return cards; }, destroy() {}
  };
  progress.addEventListener('click', (event: MouseEvent) => {
    if (progress.disabled) return;
    const rect = progress.getBoundingClientRect();
    if (event.detail > 0 && rect.width) seek?.(Number(progress.getAttribute('aria-valuemin')) + (event.clientX - rect.left) / rect.width * (Number(progress.getAttribute('aria-valuemax')) - Number(progress.getAttribute('aria-valuemin'))));
    else activate('adjustProgress');
  });
  return { host, root, make, surface, title, meta, progress, fill, elapsed, duration, icon, controls, avatarButton, avatarImage, avatarFallback, subscribeButton, playButton, likeButton, dislikeButton, captionsButton, recommendations, empty, dialog, sheet, panelTitle, description, close, status, hint, updateHint, liveButton, presentation };

  } };
})();
