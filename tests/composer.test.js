import test from 'node:test';
import assert from 'node:assert/strict';
import {bindComposerKeys} from '../src/composer.js';

test('composer handles mobile input fallback once, ignores composition, and leaves edits alone',async()=>{
 const root=new EventTarget(),input={matches:()=>true,value:'Hello',disabled:false};let calls=0;
 bindComposerKeys(root,{queue:async()=>{calls++;}});
 const emit=(type,props={})=>{const e=new Event(type,{cancelable:true});Object.defineProperty(e,'target',{value:input});Object.assign(e,props);root.dispatchEvent(e);};
 emit('compositionstart');emit('keydown',{key:'Enter'});emit('beforeinput',{inputType:'insertLineBreak'});await Promise.resolve();assert.equal(calls,0);
 emit('compositionend');emit('keydown',{key:'Enter'});await new Promise(r=>setTimeout(r,5));assert.equal(calls,0);
 emit('input',{inputType:'insertLineBreak'});emit('keydown',{key:'Enter'});await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);
 input.matches=()=>false;emit('keydown',{key:'Enter'});await Promise.resolve();assert.equal(calls,1);
});
