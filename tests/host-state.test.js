import test from 'node:test';
import assert from 'node:assert/strict';
import {createGenerationReader} from '../src/host-state.js';

test('host generation reader uses live host function over contradictory visual state',()=>{
 let busy=false;const context={groupId:'group1'};
 const read=createGenerationReader({isGenerating:()=>busy},()=>context,()=>true);
 assert.equal(read(),false);assert.equal(read.source,'host.isGenerating');busy=true;assert.equal(read(),true);
});

test('older host send flag stays live; unavailable exports use compatibility',()=>{
 const host={is_send_press:false},context={groupId:null};const read=createGenerationReader(host,()=>context,()=>null);
 assert.equal(read(),false);host.is_send_press=true;assert.equal(read(),true);
 context.groupId='group';assert.equal(read(),null);
 context.isGenerating=()=>false;assert.equal(read(),false);assert.equal(read.source,'context.isGenerating');
});
