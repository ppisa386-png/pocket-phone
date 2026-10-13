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
