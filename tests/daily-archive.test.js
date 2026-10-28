import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateDailyArchives } from '../src/daily-archive.js';
import { appendChange, replayJournal, reconcileJournal } from '../src/journal.js';
import { dailyArchives } from '../src/daily-core.js';
import { dateDay } from '../src/story-clock.js';

test('legacy edition journal recovers last three complete dates, latest same-day printing, once and with rollback',()=>{
 let journal;const revisions=[];
 const add=(date,label)=>{revisions.push('r'+revisions.length);const articles=Array.from({length:4},(_,i)=>({id:label+i,type:'article',editionId:label,headline:label+i,body:'完整旧报道'+i,selected:i===0,selectedIndex:revisions.length-1}));
  const edition={id:'edition',type:'edition',editionId:label,day:dateDay(date),publication:'Old Daily',articleIds:articles.map(a=>a.id),sourceIndex:revisions.length-1};
  journal=appendChange(journal,revisions,[edition,...articles].map(value=>({collection:'daily',key:value.id,value})));};
 add('2003-07-24','first');add('2003-07-24','reprint');add('2003-07-25','day25');add('2003-07-26','day26');add('2003-07-27','day27');
 const original=structuredClone(journal),migrated=migrateDailyArchives(journal,revisions);assert.equal(migrated.changed,true);assert.deepEqual(journal,original);
 const state=replayJournal(migrated.journal),archives=dailyArchives(state,[{mes:'2003-07-27'}]);assert.deepEqual(archives.map(a=>a.editionId),['day26','day25','reprint']);assert.equal(archives[2].articles[0].selected,true);assert.equal(archives[2].articles[0].body,'完整旧报道0');
 assert.equal(migrateDailyArchives(migrated.journal,revisions).changed,false);
 const rolled=reconcileJournal(migrated.journal,revisions.slice(0,-1)).journal;const recovered=migrateDailyArchives(rolled,revisions.slice(0,-1));
 assert.equal(recovered.changed,true);assert.equal(replayJournal(recovered.journal).daily.edition.editionId,'day26');assert.deepEqual(dailyArchives(replayJournal(recovered.journal),[{mes:'2003-07-26'}]).map(a=>a.editionId),['day25','reprint']);
});

test('legacy recovery does not invent dates or collect incomplete editions',()=>{
 let journal;const revisions=['a','b'];
 const article={id:'old',type:'article',editionId:'old',body:'body'};
 journal=appendChange(journal,['a'],[{collection:'daily',key:'edition',value:{id:'edition',type:'edition',editionId:'old',day:null,articleIds:['old']}},{collection:'daily',key:'old',value:article}]);
 journal=appendChange(journal,revisions,[{collection:'daily',key:'edition',value:{id:'edition',type:'edition',editionId:'new',day:123,articleIds:['new']}}]);
 assert.equal(Object.values(replayJournal(migrateDailyArchives(journal,revisions).journal).daily).filter(e=>e.type==='archive').length,0);
});
