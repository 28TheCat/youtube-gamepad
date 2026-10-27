import {test} from 'node:test';import assert from 'node:assert/strict';import {importSettingsModel}from'./helpers/settings-model.mjs';
const {homeFilterDefaults,normalizeHomeFilter,createHomeFilter,parseViewCount,parseDuration,parsePublishedAt,safeHomeFilterData}=await importSettingsModel('src/shared/home-filter.ts');
const item=(filterData={},extra={})=>({id:'video:a',title:'Video',channel:'Channel',href:'/watch?v=a',thumbnail:'',filterData,...extra});
test('home filter normalizes limits and does not coerce invalid values',()=>{
 const values=normalizeHomeFilter({homeMinViews:-1,homeAutoPages:99,homeMaxAgeDays:3.7,homeMinLikes:'30',homeHideVertical:true});
 assert.equal(values.homeMinViews,0);assert.equal(values.homeAutoPages,10);assert.equal(values.homeMaxAgeDays,4);assert.equal(values.homeMinLikes,0);assert.equal(values.homeHideVertical,true);
 assert.deepEqual(safeHomeFilterData({views:-1,likes:NaN,subscribed:'true',channelId:'https://evil.test'}),undefined);
});
test('home filters combine thresholds, preserve unknowns and exempt known subscriptions',()=>{
 const settings={...homeFilterDefaults,homeMinViews:100,homeMinLikes:10,homeMinDuration:60,homeMaxAgeDays:7,homeHideVertical:true};const now=1_800_000_000_000;
 const filter=createHomeFilter(settings,new Set(['UCknown']),now);
 assert.equal(filter(item({views:101,likes:11,duration:61,publishedAt:now})),true);
 for(const data of [{views:100},{likes:10},{duration:60},{publishedAt:now-8*86400000},{vertical:true}])assert.equal(filter(item(data)),false);
 assert.equal(filter(item()),true,'missing data stays unknown');
 assert.equal(filter(item({}, {id:'short:a'})),false);
 assert.equal(filter(item({views:0,subscribed:true})),true);
 assert.equal(filter(item({views:0,channelId:'UCknown'})),true);
 assert.equal(filter(item({views:0},{isPlaylist:true})),true);
 assert.equal(createHomeFilter({...settings,homeExemptSubscribed:false})(item({views:0,subscribed:true})),false);
});
test('display metadata handles Chinese and English counts and rounded publication labels',()=>{
 for(const [text,value]of [['1.2M views',1200000],['1,234 views',1234],['1694万次观看',16940000],['1.2億次觀看',120000000],['1.234次观看',1234],['No views',0]])assert.equal(parseViewCount(text),value,text);
 for(const text of ['LIVE','unknown','1,2 views'])assert.equal(parseViewCount(text),undefined,text);
 assert.equal(parseDuration('1:02:03'),3723);assert.equal(parseDuration('LIVE'),undefined);
 const now=1_800_000_000_000;assert.equal(parsePublishedAt('2 weeks ago',now),now-14*86400000);assert.equal(parsePublishedAt('3天前',now),now-3*86400000);assert.equal(parsePublishedAt('unavailable',now),undefined);
});
