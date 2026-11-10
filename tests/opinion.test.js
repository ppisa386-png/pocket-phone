import test from 'node:test';
import assert from 'node:assert/strict';
import {opinionFromPost,buildOpinionPrompt,importStorySquare} from '../src/x-opinion.js';
import {replayJournal} from '../src/journal.js';
test('legacy automatic opinion and story-square tags are inert without deleting saved data',()=>{
 const post={id:'p',type:'post',text:'A public story',feed:'square'};
 assert.equal(opinionFromPost({significant:true,topic:'Old automatic topic'},post),null);
 assert.equal(buildOpinionPrompt({x:{p:post,old:{type:'opinion',topic:'Old automatic topic',postId:'p'}}},[],''),'');
 const raw={schema:1,events:[]};const imported=importStorySquare(raw,[],[{mes:'A story <!--durian-square:{}-->'}],{});
 assert.equal(imported.journal,raw);assert.equal(imported.changed,false);assert.deepEqual(replayJournal(raw).x,{});
});

test('selected trends and square posts never enter the story AI',()=>{
 const state={x:{'trend-edition':{topics:[{title:'LEAKED_TREND',summary:'私人话题',injected:true}]},square:{id:'square',type:'post',author:'npc',text:'SQUARE_CONTENT',feed:'square',publication:{selected:true}}}};
 assert.equal(buildOpinionPrompt(state,[],'selector text'),'', 'narrative output contains neither selected trends nor square content');
 assert.equal(state.x['trend-edition'].topics[0].injected,true,'selection state stays preserved in save data');
});