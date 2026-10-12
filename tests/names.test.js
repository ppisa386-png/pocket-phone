import test from 'node:test';
import assert from 'node:assert/strict';
import {localizedPerson,sameNamedPerson} from '../src/names.js';

test('established translation wins over a newly proposed translation',()=>{
 const context={powerUserSettings:{persona_description:'里昂·S·肯尼迪是主人公的朋友。'},characters:[{name:'Leon S. Kennedy',avatar:'leon.png'}]};
 const person=localizedPerson({name:'利昂',aliases:['Leon S. Kennedy','里昂·S·肯尼迪']},context);
 assert.equal(person.name,'里昂·S·肯尼迪');assert.equal(person.cardId,'card:leon.png');assert.ok(sameNamedPerson(person,{name:'Leon S. Kennedy'}));
});
