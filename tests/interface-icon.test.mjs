import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { browserPage } from './helpers/bundles.mjs';
const result=await build({configFile:false,publicDir:false,logLevel:'silent',plugins:[vue()],define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('./helpers/interface-icon-fixture.ts',import.meta.url)),formats:['iife'],name:'IconFixture'}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
for(const trustedTypes of [false,true])test(`Vue and Shorts use identical SVG rendering and update states (Trusted Types: ${trustedTypes})`,async t=>{
 const page=await browserPage(t);
 await page.setContent(`<!doctype html>${trustedTypes?'<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for \'script\'">':''}<div id="fixture"></div>`);
 await page.evaluate(code);
 const report=await page.evaluate(()=>{
  const {h,render,InterfaceIcon,createInterfaceIcon,renderInterfaceIcon}=IconFixture,host=document.querySelector('#fixture');
  const mismatches=[],empty=[];
  for(const name of ['left','right','up','down','like','comments','save','play','pause','more','close','volume','muted','bell'])for(const filled of [false,true]){
   render(h(InterfaceIcon,{name,filled,class:'icon-fixture'}),host);
   const vue=host.querySelector('svg'),dom=createInterfaceIcon(name,filled);
   if(vue.innerHTML!==dom.innerHTML||vue.dataset.icon!==dom.dataset.icon||vue.getAttribute('style')!==dom.getAttribute('style'))mismatches.push([name,filled]);
   if(!vue.children.length)empty.push([name,filled]);
  }
  render(h(InterfaceIcon,{name:'like',filled:false}),host);const same=host.firstElementChild,line=same.innerHTML;
  render(h(InterfaceIcon,{name:'like',filled:true}),host);const filledChanged=line!==same.innerHTML;
  render(h(InterfaceIcon,{name:'muted'}),host);const muted=same.dataset.icon;
  render(h(InterfaceIcon,{name:'volume'}),host);const volume=same.dataset.icon;
  const dom=createInterfaceIcon('play');renderInterfaceIcon(dom,'unknown');
  const unknownChildren=dom.children.length,stable=same===host.firstElementChild;
  render(null,host);
  return {mismatches,empty,filledChanged,muted,volume,unknownChildren,stable,clean:host.childElementCount===0};
 });
 assert.deepEqual(report,{mismatches:[],empty:[],filledChanged:true,muted:'material:muted-line',volume:'material:volume-line',unknownChildren:0,stable:true,clean:true});
});
