import { moduleSource } from './test-source.mjs';
// Deterministic workload counts; timings are Node VM timings, not browser layout.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export function coreFixture(size = 1000) {
  const counts = { rects: 0, styles: 0, queries: 0, frames: 0 };
  const events = {}, frames = [], observers = [];
  const node = (index = -1) => ({
    isConnected: true, style: {}, dataset: {}, attributes: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    append() {}, replaceChildren(...children) { this.children = children; }, attachShadow() { return node(); }, contains(el) { return el === this; },
    closest() { return null; }, getAttribute(name) { return this.attributes[name] ?? null; }, setAttribute(name, value) { this.attributes[name] = value; },
    focus() { document.activeElement = this; events.focusin?.({ target: this }); },
    scrollIntoView() {},
    getBoundingClientRect() {
      counts.rects++;
      const left = (index % 5) * 200, top = Math.floor(index / 5) * 100;
      return { left, top, right: left + 180, bottom: top + 80, width: 180, height: 80 };
    }
  });
  const nodes = Array.from({ length: size }, (_, i) => node(i));
  const document = { body: node(), documentElement: node(), createElement: () => node(),
    addEventListener(name, fn) { events[name] = fn; }, contains: () => true,
    querySelectorAll(selector) { counts.queries++; return selector === '[role="dialog"]' ? [] : nodes; }
  };
  const window = { addEventListener(name, fn) { events[name] = fn; }, scrollTo() {} };
  const context = { window, document, location: { pathname: '/', search: '' }, innerWidth: 1200, innerHeight: 800,
    scrollX: 0, scrollY: 0, getComputedStyle() { counts.styles++; return { display: 'block', visibility: 'visible', opacity: '1' }; },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} }
  };
  for (const file of ['src/navigation/navigation.js', 'src/navigation/core.js']) runInNewContext(moduleSource(file), context);
  runInNewContext(moduleSource('src/sites/youtube.js'), { window });
  window.YTGamepad.registerSite({ selectors: 'cards', getSection: () => 'content',
    sections: { content: { layout: 'grid' } }, getKey: el => String(nodes.indexOf(el)),
    ignoreMutation: window.YTGamepadSite.createNavigationConfig({}).ignoreMutation,
    shouldShowSelection: () => !playing });
  let playing = false;
  const player = node();
  const progress = {};
  player.closest = selector => selector === '#movie_player' ? player : selector === '.ytp-progress-bar' ? progress : null;
  const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  const flush = () => { while (frames.length) { counts.frames++; frames.shift()(); } };
  return { window, context, document, nodes, counts, reset, flush, events,
    playbackFrame() { playing = true; observers[0]([{ type: 'attributes', attributeName: 'style', target: player }]); flush(); },
    mutate(records) { observers[0](records); }, setPlaying(value) { playing = value; }
  };
}

export function measure() {
  const scenarios = [];
  for (const size of [100, 1000, 5000]) {
    const s = coreFixture(size); s.window.YTGamepad.navigate('down'); s.reset();
    const start = performance.now();
    for (let i = 0; i < 200; i++) s.window.YTGamepad.navigate(i % 2 ? 'left' : 'right');
    scenarios.push({ scenario: `${size} cards, 200 moves`, ms: +(performance.now() - start).toFixed(2), ...s.counts });
  }
  const s = coreFixture(); s.window.YTGamepad.navigate('down'); s.reset();
  const start = performance.now();
  // Accelerate one hour at 60 player mutations/sec; no real video decoding.
  for (let i = 0; i < 216000; i++) s.playbackFrame();
  scenarios.push({ scenario: '1h player mutation simulation', ms: +(performance.now() - start).toFixed(2), ...s.counts });
  const routes = coreFixture(100); routes.window.YTGamepad.navigate('down'); routes.reset();
  const routeStart = performance.now();
  for (let i = 0; i < 200; i++) {
    routes.context.location.search = '?route=' + (i % 40);
    routes.events['yt-navigate-finish'](); routes.window.YTGamepad.navigate('right');
  }
  scenarios.push({ scenario: '200 SPA transitions, 40 routes', ms: +(performance.now() - routeStart).toFixed(2), ...routes.counts });
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const context = { window: {} }, start = performance.now();
    for (const file of ['src/search/pinyin-data.js', 'src/search/pinyin.js']) runInNewContext(moduleSource(file), context);
    const loaded = performance.now(); context.window.YTGamepadPinyin.lookup('nihao');
    const first = performance.now();
    for (let j = 0; j < 200; j++) context.window.YTGamepadPinyin.lookup('zhong');
    samples.push({ startup: loaded - start, firstLookup: first - loaded, repeat200: performance.now() - first });
  }
  const median = key => +samples.map(s => s[key]).sort((a, b) => a - b)[3].toFixed(2);
  scenarios.push({ scenario: 'pinyin median of 7, ms', startup: median('startup'), firstLookup: median('firstLookup'), repeat200: median('repeat200') });
  return scenarios;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(measure(), null, 2));
