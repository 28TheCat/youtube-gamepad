import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSettingsModel} from './helpers/settings-model.mjs';
const {createCommentOperations}=await importSettingsModel('src/ui/comment-operations.ts');
const {createPlaylistOperations}=await importSettingsModel('src/ui/playlist-operations.ts');
const {interfaceIcon}=await importSettingsModel('src/ui/icon-shapes.ts');

test('shared comments paginate cached replies before requesting more and retry failed replies',()=>{
 const requests=[]; let status={};
 const record={key:'parent',hasReplies:true,replies:Array.from({length:8},(_,i)=>({key:'reply'+i,translationTarget:'zh'}))};
 const model=createCommentOperations({records:()=>[record],status:()=>status,replies:key=>requests.push(key)});
 assert.equal(model.open('parent'),true); model.more(); assert.equal(model.state.limit,10); assert.deepEqual(requests,[]);
 model.more(); assert.deepEqual(requests,['parent']);
 status={loading:true}; assert.equal(model.more(),false);
 status={failed:true}; record.hasReplies=false; model.more(); assert.equal(requests.length,2);
 model.translate('reply0',(key,target)=>requests.push([key,target])); assert.deepEqual(requests.at(-1),['reply0','zh']);
 model.reset(); assert.equal(model.state.thread,''); assert.equal(model.state.limit,5);
});

test('shared playlists preserve selection on failure and discard responses from a closed panel',async()=>{
 let complete, pending=false, active=true; let notifications=0;
 const model=createPlaylistOperations({read:async()=>pending?await new Promise(resolve=>{complete=resolve}):[{key:'one',title:'One',selected:false}],toggle:async()=>false,active:()=>active,route:()=>'/shorts/one',changed:()=>notifications++});
 await model.load(); await model.toggle('one'); assert.equal(model.state.failed,true); assert.equal(model.state.items[0].selected,false);
 pending=true; const loading=model.load(); active=false; model.reset(); const before=notifications;
 complete([{key:'stale'}]); await loading; assert.deepEqual(model.state.items,[]); assert.equal(notifications,before);
});

test('shared playlists prevent duplicate writes and discard responses after a route change',async()=>{
 let route='one', complete, calls=0;
 const model=createPlaylistOperations({read:async()=>[{key:'one',selected:false}],toggle:async()=>{calls++;return await new Promise(resolve=>{complete=resolve})},active:()=>true,route:()=>route,changed(){}});
 await model.load(); const saving=model.toggle('one'); await model.toggle('one'); assert.equal(calls,1);
 route='two'; complete(true); await saving; assert.equal(model.state.items[0].selected,false);
});

test('shared icon definitions cover Shorts actions and keep directional icons distinct',()=>{
 for(const name of ['like','comments','left','right','up','down','play','pause','save','more','close','volume','muted']) assert.ok(interfaceIcon(name).shapes.length,name);
 for (const name of ['thumb-up', 'chat', 'arrow-left']) assert.equal(interfaceIcon(name).shapes.length,0);
 for (const name of ['more','close','volume','muted']) assert.ok(interfaceIcon(name,true).shapes.length,name + ' filled');
 assert.notDeepEqual(interfaceIcon('left').shapes,interfaceIcon('right').shapes);
 assert.notDeepEqual(interfaceIcon('up'),interfaceIcon('down'));
});
