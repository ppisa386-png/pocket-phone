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

test('injected trends ride along as optional background material',()=>{
 const state={x:{'trend-edition':{topics:[{title:'乐评人转向',summary:'本地乐评人开始讨论新专辑',scope:'city',injected:true}]}}};
 const prompt=buildOpinionPrompt(state,[],'');
 assert.match(prompt,/趋势话题/);assert.match(prompt,/乐评人转向/);assert.match(prompt,/可以完全不提/);assert.match(prompt,/完全由当前剧情决定/);
});