import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
import {browserPage} from './helpers/bundles.mjs';
const result=await build({configFile:false,publicDir:false,logLevel:'silent',plugins:[vue({template:{compilerOptions:{hoistStatic:false}}})],define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{write:false,minify:false,lib:{entry:fileURLToPath(new URL('../src/ui/mount-watch-panel.ts',import.meta.url)),formats:['iife'],name:'CommentUI'}}});
const code=(Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code;
async function fixture(t,signedIn=true){
 const page=await browserPage(t);await page.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<div id="panel"></div>'}));await page.goto('https://www.youtube.com/watch?v=fixture');await page.evaluate(code);
 await page.evaluate(signedIn=>{
  window.calls=[];window.requests=[];window.failSend=true;
  const record={key:'parent',author:'Author',text:'A real comment',replies:[],hasReplies:false,canReply:signedIn};
  const snapshot={route:location.pathname+location.search,items:[record],loading:false,failed:false,hasMore:false,interaction:{signedIn,canPost:signedIn,posting:false,sort:'TOP_COMMENTS',sortAvailable:true}};
  window.commentSnapshot=snapshot;
  document.addEventListener('ytg-page-request-v1',event=>window.requests.push(JSON.parse(event.detail).operation));
  const style={badge(){},hint(){},bind(){}};
  window.panel=CommentUI.mountWatchPanel(document.querySelector('#panel'),style,{
   openThread(){},replies(){},load(){},
   async postComment(text,key){window.calls.push({operation:'commentPost',text,key});return window.delaySend?await new Promise(resolve=>window.finishSend=resolve):!window.failSend;},
   sortComments(sort){window.calls.push({operation:'commentSort',sort});snapshot.interaction.sort=sort;window.renderComments();return true;}
  });
  window.renderComments=()=>window.panel.update({panel:'comments',text:'',records:snapshot.items,unavailable:false,commentsStatus:structuredClone(snapshot),commentRoute:snapshot.route});
  window.renderComments();
 },signedIn);

 return page;
}

test('shared comment controls select server sorting and retain failed drafts until explicit retry',async t=>{
 const page=await fixture(t);
 await page.getByRole('button',{name:'Newest first',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Newest first',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Write a comment',exact:true}).click();
 await page.locator('textarea').fill('第一行\nSecond line');await page.locator('textarea').press('Enter');await page.locator('textarea').press('Space');
 assert.ok((await page.locator('textarea').inputValue()).includes('\n'));
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.operation==='commentPost').length),0,'editing never publishes');
 await page.getByRole('button',{name:'Post comment',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Your draft is kept'}).waitFor();
 assert.ok((await page.locator('textarea').inputValue()).includes('Second line'));
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.operation==='commentPost').length),1);
 await page.evaluate(()=>window.failSend=false);
 await page.getByRole('button',{name:'Post comment',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Comment sent.'}).waitFor();
 assert.equal(await page.locator('textarea').count(),0);
 assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.operation==='commentPost').length),2);
 assert.deepEqual(await page.evaluate(()=>window.requests),[],'the component uses injected data and callbacks without creating a bridge client');
});

test('injected comment updates reset drafts and ignore a send result from the previous video',async t=>{
 const page=await fixture(t);
 await page.getByRole('button',{name:'Write a comment',exact:true}).click();
 await page.locator('textarea').fill('Previous video draft');
 await page.evaluate(()=>window.delaySend=true);
 await page.getByRole('button',{name:'Post comment',exact:true}).click();
 await page.waitForFunction(()=>!!window.finishSend);
 await page.evaluate(()=>{window.commentSnapshot.route='/watch?v=next';window.renderComments();});
 assert.equal(await page.locator('textarea').count(),0);
 await page.getByRole('button',{name:'Write a comment',exact:true}).click();
 await page.locator('textarea').fill('New video draft');
 await page.evaluate(()=>window.finishSend(true));
 assert.equal(await page.locator('textarea').inputValue(),'New video draft');
 assert.equal(await page.getByRole('status').filter({hasText:'Comment sent.'}).count(),0);
});

test('reply targets its parent and Back cancels editing before closing the comment drawer',async t=>{
 const page=await fixture(t);const reply=page.locator('[data-focus-id="reply:parent"]');await reply.click();
 await page.getByLabel('Write a reply',{exact:true}).fill('A reply draft');
 assert.equal(await page.evaluate(()=>CommentUI.backCommentComposer(document.querySelector('#panel'))),true);
 assert.equal(await page.locator('textarea').count(),0);
 assert.equal(await reply.evaluate(node=>node===document.activeElement),true);
 assert.equal(await page.evaluate(()=>CommentUI.backCommentComposer(document.querySelector('#panel'))),false);
 await reply.click();await page.locator('textarea').fill('Send this reply');await page.evaluate(()=>window.failSend=false);
 await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByRole('status').filter({hasText:'Comment sent.'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(x=>x.operation==='commentPost').map(({key,text})=>({key,text}))),[{key:'parent',text:'Send this reply'}]);
});

test('signed-out comments retain sorting and explain why publishing is unavailable',async t=>{
 const page=await fixture(t,false);assert.equal(await page.getByRole('button',{name:'Write a comment',exact:true}).isDisabled(),true);
 await page.getByText('Sign in to comment or reply.',{exact:true}).waitFor();assert.equal(await page.locator('[data-focus-id="reply:parent"]').count(),0);
 await page.getByRole('button',{name:'Newest first',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),1);
 await page.evaluate(()=>window.panel.dispose());assert.equal(await page.locator('#panel').textContent(),'');
});
