import{test}from'node:test';import assert from'node:assert/strict';import{mkdirSync}from'node:fs';import{launchExtension}from'./helpers/extension.mjs';
const card=(id,views,channel='UCcreator')=>({videoRenderer:{videoId:id,title:{simpleText:id},ownerText:{runs:[{text:'Creator',navigationEndpoint:{browseEndpoint:{browseId:channel}}}]},thumbnail:{thumbnails:[{url:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,width:480,height:270}]},viewCountText:{simpleText:`${views} views`},publishedTimeText:{simpleText:'2 days ago'},lengthText:{simpleText:'5:00'}}});
async function setup(t,{values={},empty=false}={}){
 const env=await launchExtension(t);await env.worker.evaluate(values=>chrome.storage.local.set({enabled:true,theater:true,autoFullscreen:false,uiLanguage:'en',homeExemptSubscribed:false,...values}),values);
 await env.context.addInitScript(()=>{window.ytcfg={get:key=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'home-filter-fixture'},user:{}}})[key]};});
 const requests=[];
 await env.context.route('https://i.ytimg.com/**',route=>route.fulfill({status:204}));
 await env.context.route('https://www.youtube.com/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/browse')){const body=route.request().postDataJSON();requests.push(body);const index=requests.length;
 const items=empty?[card('hidden'+index,1)]:[card('a',1000),card('b',10,'UCsubscribed'),card('c',2000)];
 await route.fulfill({json:{contents:[...items,...(empty?[{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'page'+index}}}}]:[])]}});}
 else if(path.endsWith('/guide'))await route.fulfill({json:{items:[{guideSubscriptionsSectionRenderer:{items:[{guideEntryRenderer:{formattedTitle:{simpleText:'Subscribed'},navigationEndpoint:{browseEndpoint:{browseId:'UCsubscribed'}}}}]}}]}});
 else if(path.startsWith('/youtubei/'))await route.fulfill({json:{contents:[]}});
 else await route.fulfill({contentType:'text/html',body:'<html><body><ytd-app><ytd-page-manager></ytd-page-manager></ytd-app></body></html>'});
 });
 const page=await env.context.newPage();await page.goto('https://www.youtube.com/');return{...env,page,requests};
}
test('home filter changes preserve neighbouring focus and relaxing settings restores cached videos', {timeout:45000},async t=>{
 const {page,worker,requests}=await setup(t);await page.locator('[data-browse-id="video:b"]').waitFor();
 await page.locator('[data-browse-id="video:b"]').focus();await worker.evaluate(()=>chrome.storage.local.set({homeMinViews:100}));
 await page.locator('[data-browse-id="video:b"]').waitFor({state:'detached'});
 await page.waitForFunction(()=>document.querySelector('#ytg-browse-root').shadowRoot.activeElement?.getAttribute('data-browse-id')==='video:c');
 assert.equal(await page.locator('[data-browse-id="video:c"]').getAttribute('data-selected'),'true');
 const count=requests.length;await worker.evaluate(()=>chrome.storage.local.set({homeMinViews:0}));await page.locator('[data-browse-id="video:b"]').waitFor();assert.equal(requests.length,count);
 await page.locator('#ytg-sidebar-settings').click();const menu=page.locator('#yt-gamepad-menu');await menu.locator('[data-setting=display]').click();
 await menu.locator('[data-setting="homeMinViews-+"]').click();await page.waitForFunction(()=>document.querySelector('#ytg-browse-root').shadowRoot.querySelector('[data-browse-id="video:b"]')===null);
 assert.equal((await worker.evaluate(()=>chrome.storage.local.get('homeMinViews'))).homeMinViews,1000);
 mkdirSync('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/home-filter-settings.png'});
});
test('filtered empty feeds stop automatically and retain an explicit load-more control', {timeout:45000},async t=>{
 const {page,requests}=await setup(t,{values:{homeMinViews:100,homeAutoPages:2},empty:true});
 await page.getByText('Automatic loading paused. Load more videos or adjust home filters.',{exact:true}).waitFor();
 assert.equal(requests.length,3);assert.equal(await page.locator('[data-browse-id]').count(),0);
 await page.waitForTimeout(300);assert.equal(requests.length,3);
 await page.locator('[data-browse-more]').click();await page.waitForFunction(()=>document.querySelector('#ytg-browse-root').shadowRoot.querySelector('[data-browse-more]')?.disabled===false);
 assert.equal(requests.length,6);
});
test('known subscribed channels bypass thresholds and full settings persist numeric filters', {timeout:45000},async t=>{
 const {page,worker,options}=await setup(t,{values:{homeMinViews:100,homeExemptSubscribed:true}});
 await page.locator('[data-browse-id="video:b"]').waitFor();
 await options.locator('[data-category-link=display]').click();await options.locator('#homeMinLikes').fill('50');await options.locator('#homeMinLikes').press('Tab');
 await options.waitForFunction(()=>window===window&&document.querySelector('#homeMinLikes').value==='50');
 await page.waitForTimeout(100);assert.equal((await worker.evaluate(()=>chrome.storage.local.get('homeMinLikes'))).homeMinLikes,50);
 await options.reload();await options.locator('[data-category-link=display]').click();assert.equal(await options.locator('#homeMinLikes').inputValue(),'50');
 assert.equal(await page.locator('[data-browse-id="video:b"]').count(),1);
});
