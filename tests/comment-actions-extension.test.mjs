import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchExtension} from './helpers/extension.mjs';
import {interactiveComments} from './helpers/comment-interaction-data.mjs';

test('real extension bridge publishes comments and replies only on request and changes server sort', {timeout:45000},async t=>{
 const {context,worker}=await launchExtension(t);await worker.evaluate(()=>chrome.storage.local.set({enabled:false}));
 await context.addCookies([{name:'SAPISID',value:'comment-actions-fixture',domain:'.youtube.com',path:'/',secure:true}]);
 await context.addInitScript(()=>{window.commentSignedIn=true;window.ytcfg={get:key=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'comment-actions-fixture'},user:{}},LOGGED_IN:window.commentSignedIn,INNERTUBE_CONTEXT_CLIENT_NAME:1})[key]};});
 const calls=[];
 await context.route('https://www.youtube.com/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/youtubei/v1/')){const body=route.request().postDataJSON();calls.push({path,body,headers:await route.request().allHeaders()});await route.fulfill({json:path.endsWith('/next')?interactiveComments():{success:true}});}
  else await route.fulfill({contentType:'text/html',body:'<html><body><ytd-app></ytd-app></body></html>'});
 });
 const page=await context.newPage();await page.goto('https://www.youtube.com/watch?v=comments');
 const ask=(operation,fields={})=>page.evaluate(({operation,fields})=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),timer=setTimeout(()=>{document.removeEventListener('ytg-page-response-v1',receive);reject(Error('Bridge timeout'));},10000);
  function receive(event){const data=JSON.parse(event.detail);if(data.id===id){clearTimeout(timer);document.removeEventListener('ytg-page-response-v1',receive);resolve(data);}}
  document.addEventListener('ytg-page-response-v1',receive);document.dispatchEvent(new CustomEvent('ytg-page-request-v1',{detail:JSON.stringify({version:1,id,operation,...fields})}));
 }),{operation,fields});
 async function idle(){for(let i=0;i<100;i++){const value=(await ask('readComments')).value;if(!value.loading)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Comments did not settle');}
 await ask('moreComments',{start:true});let snapshot=await idle();
 assert.equal(snapshot.interaction.canPost,true);assert.equal(snapshot.items[0].canReply,true);
 assert.equal((await ask('commentPost',{text:'A new comment'})).value,true);await idle();
 assert.equal((await ask('commentPost',{text:'A reply',key:'parent'})).value,true);await idle();
 const writes=calls.filter(x=>x.path.includes('/comment/create_'));assert.equal(writes.length,2);
 assert.equal(writes[0].body.commentText,'A new comment');assert.equal(writes[1].body.createReplyParams,'reply-token');
 assert.match(writes[0].headers.authorization,/^SAPISIDHASH /);
 const token=calls.filter(x=>x.path.endsWith('/next')).at(-1).body.continuation;
 assert.equal((await ask('commentSort',{sort:'NEWEST_FIRST'})).value,true);snapshot=await idle();
 assert.equal(snapshot.interaction.sort,'NEWEST_FIRST');assert.notEqual(calls.filter(x=>x.path.endsWith('/next')).at(-1).body.continuation,token);
 assert.equal((await ask('commentPost',{text:'x'.repeat(4001)})).ok,false);
 await page.evaluate(()=>window.commentSignedIn=false);assert.equal((await ask('commentPost',{text:'Not allowed'})).value,false);
 assert.equal(calls.filter(x=>x.path.includes('/comment/create_')).length,2);
 assert.equal(JSON.stringify(snapshot).includes('create-token'),false);assert.equal(JSON.stringify(snapshot).includes('reply-token'),false);
});
