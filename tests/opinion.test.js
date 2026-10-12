import test from 'node:test';
import assert from 'node:assert/strict';
import {opinionFromPost,buildOpinionPrompt,importStorySquare} from '../src/x-opinion.js';
import {messageSignatures,revisionsFor,replayJournal} from '../src/journal.js';
const post={id:'p',type:'post',text:'Local reviewers are discussing the album.',createdAt:1};
const impact={significant:true,topic:'Album reviews',summary:'Local music critics disagree over the album.',publicBasis:'The album and reviews are public.',stakes:'May affect the upcoming local concert.'};
test('only material public discussion becomes pending context; adoption removes it and deleting adoption restores it',()=>{
 assert.equal(opinionFromPost({...impact,significant:false},post),null);assert.equal(opinionFromPost({...impact,publicBasis:''},post),null);
 const o=opinionFromPost(impact,post),state={x:{p:post,[o.id]:o},orders:{private:{secret:'PRIVATE_ORDER'}}};assert.match(buildOpinionPrompt(state,[],'Public context'),/Album reviews/);assert.doesNotMatch(buildOpinionPrompt(state,[],'Public context'),/PRIVATE_ORDER/);
 const evidence='Alex read the public reviews and mentioned them.';const chat=[{mes:evidence+'<!--durian-opinion:'+JSON.stringify({id:o.id,used:true,evidence})+'-->',is_user:false}];assert.equal(buildOpinionPrompt(state,chat,'Public context'),'');chat.pop();assert.match(buildOpinionPrompt(state,chat,'Public context'),/Album reviews/);
});
test('actual narrative X posts appear in the square; missing visible posts and named character authors are rejected',async()=>{
 const text='the park gates are open again',evidence='Rowan posted on X: '+text;
 const row={name:'Rowan',handle:'rowan',text,publicBasis:'Public park reopening',evidence};
 const chat=[{mes:evidence+'<!--durian-square:'+JSON.stringify(row)+'-->',is_user:false}];const revisions=await revisionsFor(messageSignatures(chat));const context={name1:'Sam',characters:[{name:'Alex'}]};
 const first=importStorySquare(undefined,revisions,chat,context);assert.equal(Object.values(replayJournal(first.journal).x).filter(x=>x.type==='post').length,1);assert.equal(importStorySquare(first.journal,revisions,chat,context).changed,false);
 chat[0].mes=evidence+'<!--durian-square:'+JSON.stringify({...row,name:'Alex'})+'-->';assert.equal(importStorySquare(undefined,await revisionsFor(messageSignatures(chat)),chat,context).changed,false);
});
