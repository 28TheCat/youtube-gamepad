import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSettingsModel} from './helpers/settings-model.mjs';
const {createCommentOperations}=await importSettingsModel('src/ui/comment-operations.ts');
const {createPlaylistOperations}=await importSettingsModel('src/ui/playlist-operations.ts');
const {createWatchActionOperations}=await importSettingsModel('src/ui/watch-action-operations.ts');
const {interfaceIcon}=await importSettingsModel('src/ui/icon-shapes.ts');
const {playbackControlIds,defaultPlaybackControlIndex}=await importSettingsModel('src/ui/playback-control-config.ts');

test('playback controls derive layout visibility and the default target from shared definitions',()=>{
 const full=playbackControlIds(true).map(id=>({id})),windowed=playbackControlIds(false).map(id=>({id}));
 assert.equal(full[defaultPlaybackControlIndex(full)].id,'playPause');
 assert.equal(windowed[defaultPlaybackControlIndex(windowed)].id,'channel');
 assert.equal(full.some(item=>item.id==='fullscreen'),false);
 assert.equal(windowed.some(item=>item.id==='fullscreen'),false);
 assert.equal(windowed.some(item=>['seekBack','playPause','seekForward'].includes(item.id)),false);
 const reordered=[{id:'like'},{id:'native:playPause'}];
 assert.equal(defaultPlaybackControlIndex(reordered),1);
 assert.equal(defaultPlaybackControlIndex([{id:'native:playPause',available:false},{id:'like'}]),1);
});

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

test('shared playlists recover from read and write errors and update only the selected item',async()=>{
 let readFails=true,writeFails=true,calls=0;
 const items=[{key:'one',selected:false},{key:'two',selected:true}];
 const model=createPlaylistOperations({read:async()=>{if(readFails)throw Error('Read failed');return items;},toggle:async()=>{calls++;if(writeFails)throw Error('Write failed');return true;},active:()=>true,route:()=>'/watch?v=one',changed(){}});
 await model.load();assert.equal(model.state.failed,true);assert.equal(model.state.loading,false);
 readFails=false;await model.load();assert.equal(model.state.failed,false);assert.deepEqual(model.state.items,items);
 await model.toggle('one');assert.equal(calls,1);assert.equal(model.state.failed,true);assert.deepEqual(model.state.items,items);
 writeFails=false;await model.toggle('one');assert.equal(calls,2);assert.equal(model.state.failed,false);
 assert.deepEqual(model.state.items,[{key:'one',selected:true},{key:'two',selected:true}]);assert.equal(items[0].selected,false);
});

test('shared playlists ignore a rejected old request while a replacement is loading',async()=>{
 const pending=[];let changed=0;
 const model=createPlaylistOperations({read:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),toggle:async()=>true,active:()=>true,route:()=>'/shorts/one',changed(){changed++;}});
 const old=model.load();model.reset();const next=model.load(),before=changed;
 pending[0].reject(Error('Stale failure'));await old;
 assert.deepEqual(model.state,{items:[],loading:true,failed:false});assert.equal(changed,before);
 pending[1].resolve([{key:'new',selected:false}]);await next;
 assert.deepEqual(model.state,{items:[{key:'new',selected:false}],loading:false,failed:false});
});

test('shared playlists discard errors on close and release loading without notifying the inactive surface',async()=>{
 let active=true,reject,changed=0,calls=0;
 const model=createPlaylistOperations({read:()=>{calls++;return new Promise((_,fail)=>reject=fail);},toggle:async()=>true,active:()=>active,route:()=>'/shorts/one',changed(){changed++;}});
 const request=model.load();active=false;const before=changed;reject(Error('Closed'));await request;
 assert.deepEqual(model.state,{items:[],loading:false,failed:false});assert.equal(changed,before);
 await model.load();assert.equal(calls,1);
});

test('shared watch writes lock duplicate requests and recover from failures without retrying',async()=>{
 let finish,calls=0,fail=false;
 const model=createWatchActionOperations({request:async()=>{calls++;if(fail)throw Error('Rejected');return await new Promise(resolve=>finish=resolve);},active:()=>true,route:()=>'/watch?v=one',changed(){}});
 const first=model.run('notificationsAll');
 assert.equal(model.state.loading,true);
 assert.equal(await model.run('unsubscribe'),undefined);assert.equal(calls,1);
 finish(false);assert.equal(await first,false);assert.deepEqual(model.state,{loading:false,failed:true});
 fail=true;assert.equal(await model.run('like'),false);assert.equal(calls,2);
 fail=false;const retry=model.run('notificationsNone');assert.equal(model.state.failed,false);
 finish(true);assert.equal(await retry,true);assert.deepEqual(model.state,{loading:false,failed:false});
});

test('shared watch writes discard old results after reset, navigation or closing the surface',async()=>{
 let route='one',active=true,changed=0;const pending=[];
 const model=createWatchActionOperations({request:()=>new Promise(resolve=>pending.push(resolve)),active:()=>active,route:()=>route,changed(){changed++;}});
 const old=model.run('notificationsAll');model.reset();route='two';const next=model.run('unsubscribe');
 pending[0](false);assert.equal(await old,undefined);assert.deepEqual(model.state,{loading:true,failed:false});
 pending[1](true);assert.equal(await next,true);assert.deepEqual(model.state,{loading:false,failed:false});
 const closing=model.run('like');active=false;const before=changed;
 pending[2](true);assert.equal(await closing,undefined);assert.equal(changed,before);assert.equal(model.state.loading,false);
 active=true;const navigating=model.run('subscribe');route='three';pending[3](false);
 assert.equal(await navigating,undefined);assert.equal(model.state.failed,false);model.reset();
});

test('shared icon definitions cover Shorts actions and keep directional icons distinct',()=>{
 for(const name of ['like','comments','left','right','up','down','play','pause','save','more','close','volume','muted']) assert.ok(interfaceIcon(name).shapes.length,name);
 for (const name of ['thumb-up', 'chat', 'arrow-left']) assert.equal(interfaceIcon(name).shapes.length,0);
 for (const name of ['more','close','volume','muted']) assert.ok(interfaceIcon(name,true).shapes.length,name + ' filled');
 assert.notDeepEqual(interfaceIcon('left').shapes,interfaceIcon('right').shapes);
 assert.notDeepEqual(interfaceIcon('up'),interfaceIcon('down'));
});


test('shared comment callbacks validate threads, forward requests and stop refreshing closed panels', async()=>{
 let active=true, changed=0, finish; const calls=[];
 const model=createCommentOperations({records:()=>[{key:'parent',hasReplies:true,replies:[],translationTarget:'zh'}],status:()=>({}),replies:key=>calls.push(['replies',key])});
 const actions=model.callbacks({active:()=>active,changed(){changed++;},openThread:key=>{calls.push(['open',key]);model.open(key);},
  load:()=>calls.push(['load']),post:(text,key)=>{calls.push(['post',text,key]);return new Promise(resolve=>finish=resolve);},
  sort:value=>{calls.push(['sort',value]);return true;},translate:(key,target)=>calls.push(['translate',key,target])});
 actions.openThread('missing');assert.deepEqual(calls,[]);
 actions.openThread('parent');assert.deepEqual(calls,[['open','parent'],['replies','parent']]);
 actions.replies();actions.load();actions.translate('parent');assert.equal(actions.sortComments('NEWEST_FIRST'),true);
 assert.deepEqual(calls.slice(2),[['replies','parent'],['load'],['translate','parent','zh'],['sort','NEWEST_FIRST']]);
 const pending=actions.postComment('hello','parent');const before=changed;active=false;finish(true);
 assert.equal(await pending,true);assert.equal(changed,before);
 const count=calls.length;actions.load();actions.replies();actions.translate('parent');actions.openThread('parent');
 assert.equal(actions.sortComments('TOP_COMMENTS'),false);assert.equal(await actions.postComment('ignored'),false);
 assert.equal(calls.length,count);
});
