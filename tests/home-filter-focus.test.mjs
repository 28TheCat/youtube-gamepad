import {test} from 'node:test';import assert from 'node:assert/strict';import {createPinia}from'pinia';import{importSettingsModel}from'./helpers/settings-model.mjs';
const {useBrowseStore}=await importSettingsModel('src/app/browse-store.ts');
const {createHomeFilter,homeFilterDefaults}=await importSettingsModel('src/shared/home-filter.ts');
const item=(id,views)=>({id,title:id,channel:'Channel',thumbnail:'',href:'/watch?v='+id,filterData:{views}});
test('filtering the selected video chooses the next surviving identity, then the previous one',()=>{
 const store=useBrowseStore(createPinia()),items=[item('a',1000),item('b',10),item('c',2000)];
 store.apply({route:'/',items,canLoadMore:false});store.select('b');store.apply({route:'/',items:items.filter(createHomeFilter({...homeFilterDefaults,homeMinViews:100})),canLoadMore:false});assert.equal(store.activeItemId,'c');
 store.apply({route:'/',items:[items[0]],canLoadMore:false});assert.equal(store.activeItemId,'a');store.apply({route:'/',items:[],canLoadMore:false});assert.equal(store.activeItemId,null);
});
