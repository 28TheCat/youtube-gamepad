import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../output/performance/', import.meta.url);
mkdirSync(dir, { recursive: true });
const sources = ['src/shared/actions.js', 'src/input/bindings.js', 'src/shared/runtime.js', 'src/ui/styles.js', 'src/input/controller-style.js', 'src/navigation/navigation.js', 'src/navigation/core.js', 'src/sites/youtube.js', 'src/search/pinyin-data.js', 'src/search/pinyin.js']
  .map(file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/<\/script/gi, '<\\/script'));
writeFileSync(new URL('fixture.html', dir), `<!doctype html><meta charset="utf-8"><title>Gamepad performance fixture</title>
<style>body{margin:0}#cards{display:grid;grid-template-columns:repeat(5,180px);gap:20px;padding:20px}#cards button{height:80px}</style>
<div id="cards"></div><div id="movie_player"><div class="ytp-progress-bar"><i></i></div></div>
<script>
window.perfCounts = {rects:0,styles:0,queries:0};
const originalRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function() { perfCounts.rects++; return originalRect.call(this); };
const originalStyle = window.getComputedStyle;
window.getComputedStyle = function(...args) { perfCounts.styles++; return originalStyle(...args); };
const originalQuery = Document.prototype.querySelectorAll;
Document.prototype.querySelectorAll = function(...args) { perfCounts.queries++; return originalQuery.apply(this,args); };
</script>${sources.map(source => '<script>' + source + '</script>').join('\n')}
<script>
const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
window.runPerformance = async () => {
  const results = [], container = document.querySelector('#cards');
  const heap = () => performance.memory ? {
    usedHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2),
    totalHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(2)
  } : null;
  const environment = { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency || null,
    deviceMemoryGB: navigator.deviceMemory || null, heapMeasurement: performance.memory ? 'chromium-only, approximate' : 'unavailable' };
  const reset = () => { for (const key of Object.keys(perfCounts)) perfCounts[key] = 0; };
  YTGamepad.registerSite({selectors:'#cards button',getSection:()=>'content',getKey:el=>el.textContent,
    sections:{content:{layout:'grid'}}, ignoreMutation:YTGamepadSite.createNavigationConfig({}).ignoreMutation});
  for (const size of [100,1000,5000]) {
    container.replaceChildren(...Array.from({length:size},(_,i)=>{const el=document.createElement('button');el.textContent=String(i);return el;}));
    scrollTo(0,0); YTGamepad.focus(container.firstChild); await waitFrame(); reset();
    const times=[];
    for(let i=0;i<200;i++){const start=performance.now();YTGamepad.navigate(i%2?'left':'right');times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);
    results.push({scenario:size+' cards, 200 moves',totalMs:+times.reduce((a,b)=>a+b,0).toFixed(2),p95Ms:+times[189].toFixed(2),...perfCounts});
  }
  const selected=container.children[60]; YTGamepad.focus(container.firstChild);
  for(let i=0;i<12;i++) YTGamepad.navigate('down');
  await waitFrame();
  const actual=originalRect.call(YTGamepad.current), ring=document.querySelector('#yt-gamepad-overlay').shadowRoot.querySelector('#ring');
  results.push({scenario:'scroll geometry',selected:YTGamepad.current.textContent,expected:'60',top:actual.top,ringTransform:ring.style.transform,
    aligned:YTGamepad.current===selected && ring.style.transform==='translate3d('+ (actual.left-3)+'px, '+(actual.top-3)+'px, 0px)'});
  await waitFrame();reset();
  const heapBeforeHour = heap();
  const animated=document.querySelector('.ytp-progress-bar i');
  for(let batch=0;batch<3600;batch++) {
    for(let i=0;i<60;i++) animated.style.width=(i%100)+'%';
    if(batch%60===59) await waitFrame();
  }
  const forcedGC = typeof globalThis.gc === 'function';
  if (forcedGC) { globalThis.gc(); await waitFrame(); }
  const heapAfterHour = heap();
  results.push({scenario:'216000 player style changes, 1h event-rate simulation',...perfCounts,
    heapBefore:heapBeforeHour,heapAfter:heapAfterHour,
    retainedHeapDeltaMB:heapBeforeHour && heapAfterHour ? +(heapAfterHour.usedHeapMB-heapBeforeHour.usedHeapMB).toFixed(2) : null,
    forcedGC,
    note:'accelerated local fixture; this does not represent one wall-clock hour or YouTube video decoding'});
  const start=performance.now();const candidate=YTGamepadPinyin.lookup('nihao')[0];
  results.push({scenario:'cold pinyin nihao',ms:+(performance.now()-start).toFixed(2),text:candidate.text});
  return {environment,results};
};
</script>`);
console.log('Browser fixture: http://127.0.0.1:8765/output/performance/fixture.html');
