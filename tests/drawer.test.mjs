import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSettingsModel} from './helpers/settings-model.mjs';
const {createDrawer}=await importSettingsModel('src/ui/drawer.ts');
function fixture(){
 let route='one', focused, choices=[], clears=0;
 const node=(id,disabled=false)=>({dataset:{focusId:id},isConnected:true,closest:()=>null,hasAttribute:name=>name==='disabled'&&disabled,getAttribute:()=>null,focus(){focused=this}});
 const opener=node('opener'), element={hidden:true},content={scrollTop:0}; focused=opener;
 const drawer=createDrawer({element:()=>element,content:()=>content,activeElement:()=>focused,route:()=>route,items:()=>choices,cleared(){clears++}});
 return {drawer,node,opener,element,content,get focused(){return focused},set focused(value){focused=value},set choices(value){choices=value},set route(value){route=value},get clears(){return clears}};
}
test('drawer switches panels while retaining the original opener and closes after nested back',()=>{
 const s=fixture();s.drawer.open();const reply=s.node('replies:one');s.choices=[reply];s.focused=reply;s.drawer.open();
 s.content.scrollTop=123;s.drawer.enterDetail(()=>{s.choices=[s.node('replies:one')]});s.choices=[s.node('detail')];s.content.scrollTop=0;
 s.drawer.back();assert.equal(s.element.hidden,false);assert.equal(s.focused.dataset.focusId,'replies:one');assert.equal(s.content.scrollTop,123);
 s.drawer.back();assert.equal(s.element.hidden,true);assert.equal(s.focused,s.opener);assert.equal(s.clears,1);
});
test('drawer drops detail history and return focus during navigation or silent cleanup',()=>{
 const s=fixture();s.drawer.open();let backs=0;s.drawer.enterDetail(()=>backs++);s.route='two';
 assert.equal(s.drawer.backDetail(),false);s.focused=s.node('new-route');const current=s.focused;s.drawer.close();assert.equal(s.focused,current);assert.equal(backs,0);
 s.drawer.open();s.drawer.enterDetail(()=>backs++);s.drawer.close(false);assert.equal(s.drawer.backDetail(),false);assert.equal(backs,0);
});
test('drawer excludes unavailable controls and restores a nearby item if the original was removed',()=>{
 const s=fixture();s.drawer.open();const first=s.node('first'),disabled=s.node('disabled',true),last=s.node('last');
 s.choices=[first,disabled,last];s.drawer.focus(1);assert.equal(s.focused,last);
 s.drawer.enterDetail(()=>{s.choices=[first]});s.choices=[];s.drawer.backDetail();assert.equal(s.focused,first);
});
test('drawer delegates managed focus restoration after cleanup and suppresses it across routes',()=>{
 const order=[];let route='one';const element={hidden:true};
 const drawer=createDrawer({element:()=>element,content:()=>undefined,activeElement:()=>null,route:()=>route,items:()=>[],opened:modal=>order.push(['open',modal]),cleared:()=>order.push('clear'),restoreReturn:(_,apply)=>order.push(['restore',apply,element.hidden])});
 drawer.open(false);drawer.close();assert.deepEqual(order,[['open',false],'clear',['restore',true,true]]);
 drawer.open();route='two';drawer.close();assert.deepEqual(order.at(-1),['restore',false,true]);
});
