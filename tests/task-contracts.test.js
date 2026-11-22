import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_SCHEMAS, commonTaskSchema, assertTaskResponse } from '../src/task-contracts.js';
import { validateProducts } from '../src/amazon.js';

test('task schema routing is specific to the subtask, not the whole App',()=>{
 const cases=[
  ['x','当前任务：X 私信。',TASK_SCHEMAS.xDm],
  ['x','当前任务：X 搜索账号。',null],
  ['x','趋势评估资料（人设用于判断身份）',TASK_SCHEMAS.xTrends],
  ['x','当前任务：X 未结算剧情楼层的新增粉丝影响。',TASK_SCHEMAS.xFloor],
  ['x','当前任务：X 公开评论区互动。',TASK_SCHEMAS.xPublic],
  ['snapchat','当前任务：Snapchat 聊天。',TASK_SCHEMAS.snapChat],
  ['snapchat','当前任务：Snapchat stories 刷新。录音中提过语音通话',TASK_SCHEMAS.snapFeed],
  ['snapchat','当前任务：Snapchat 语音通话，只允许听觉内容。',TASK_SCHEMAS.snapCall],
  ['wechat','当前任务：微信 动态评论。',TASK_SCHEMAS.snapComment],
  ['whatsapp','当前任务：批量 WhatsApp 好友邀请。',TASK_SCHEMAS.snapBatch],
  ['messages','仅基于此前交流重写，只输出 {"text":"..."}。',TASK_SCHEMAS.textRewrite],
  ['contacts','task',null],
 ];
 for(const [app,prompt,expected] of cases)
  assert.equal(commonTaskSchema(app,prompt),expected,app+' '+prompt);
});

test('protocol requires delivery without forbidding zero, silence, no changes and empty lists',()=>{
 const valid=[
  [TASK_SCHEMAS.xInitial,{initialFollowers:0}],
  [TASK_SCHEMAS.sms,{status:'no_reply',text:''}],
  [TASK_SCHEMAS.payment,{accept:false}],
  [TASK_SCHEMAS.snapComment,{text:''}],
  [TASK_SCHEMAS.wechatMoments,{moments:[],interactions:[]}],
  [TASK_SCHEMAS.calendar,{region:'无可靠节日的地方',timezone:null,years:[2026,2027],holidays:[]}],
  [TASK_SCHEMAS.assetsInitial,{residence:null,initial:{balance:0,holdings:[],jobs:[]}}],
  [TASK_SCHEMAS.assetsUpdate,{events:[],living:{total:0,bookedIds:[]},business:[]}],
  [TASK_SCHEMAS.xFeed,{posts:[],replies:[]}],
  [TASK_SCHEMAS.xFeedPosts,{posts:[],replies:[]}],
 ];
 for(const [contract,value] of valid)assert.equal(assertTaskResponse(value,contract,{currentCurrency:'USD'}),value);
 for(const contract of [TASK_SCHEMAS.calendar,TASK_SCHEMAS.xInitial,TASK_SCHEMAS.snapComment,TASK_SCHEMAS.wechatMoments,TASK_SCHEMAS.payment,TASK_SCHEMAS.xFeed])
  assert.throws(()=>assertTaskResponse({},contract),error=>error.code==='PHONE_DATA_MISSING');
 assert.equal(assertTaskResponse({accounts:[]},TASK_SCHEMAS.xFeed).accounts.length,0);
 assert.throws(()=>assertTaskResponse({accounts:[]},TASK_SCHEMAS.xFeedPosts),e=>e.code==='PHONE_DATA_MISSING'&&e.missingFields.includes('posts'));
 assert.throws(()=>assertTaskResponse({status:'no_reply'},TASK_SCHEMAS.sms),error=>error.code==='PHONE_DATA_MISSING');
 assert.throws(()=>assertTaskResponse({events:[],business:[]},TASK_SCHEMAS.assetsUpdate,{currentCurrency:'USD'}),error=>error.code==='PHONE_DATA_MISSING'&&error.message.includes('生活开销'));
 const migration={residenceChange:{status:'completed',subject:'user',currency:'JPY'}};
 assert.equal(assertTaskResponse(migration,TASK_SCHEMAS.assetsUpdate,{currentCurrency:'USD'}),migration);
 assert.throws(()=>assertTaskResponse(migration,TASK_SCHEMAS.assetsUpdate,{currentCurrency:'JPY'}),error=>error.code==='PHONE_DATA_MISSING');
 const legacy={initial:{balance:100,holdings:[],jobs:[]}};
 assert.equal(assertTaskResponse(legacy,TASK_SCHEMAS.assetsInitial,{optionalMissing:['residence']}),legacy);
 assert.throws(()=>validateProducts({products:[]},'USD'));
});

test('Gemini response_schema avoids required-only anyOf and retains local task contracts',()=>{
 const check=(node,path)=>{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node.anyOf))for(const [i,branch] of node.anyOf.entries()){
   if(Array.isArray(branch.required)){
    assert.equal(branch.type,'object',path+'.anyOf['+i+'] requires OBJECT');
    assert.ok(branch.properties&&typeof branch.properties==='object',path+'.anyOf['+i+'] defines properties');
    for(const key of branch.required)assert.ok(Object.hasOwn(branch.properties,key),path+'.anyOf['+i+'] defines '+key);
   }
  }
  for(const [key,value] of Object.entries(node))if(value&&typeof value==='object')check(value,path+'.'+key);
 };
 for(const contract of Object.values(TASK_SCHEMAS))check(contract.value,contract.name);
 assert.equal(TASK_SCHEMAS.xFeed.value.anyOf,undefined);
 assert.deepEqual(TASK_SCHEMAS.xFeedPosts.value.required,['posts']);
 assert.equal(TASK_SCHEMAS.assetsUpdate.value.anyOf,undefined);
 assert.equal(TASK_SCHEMAS.friends.value.anyOf,undefined);
 assert.equal(assertTaskResponse({accounts:[]},TASK_SCHEMAS.xFeed).accounts.length,0);
 assert.throws(()=>assertTaskResponse({accounts:[]},TASK_SCHEMAS.xFeedPosts),e=>e.code==='PHONE_DATA_MISSING');
 assert.throws(()=>assertTaskResponse({},TASK_SCHEMAS.friends),e=>e.code==='PHONE_DATA_MISSING');
 assert.equal(assertTaskResponse({ambiguous:true},TASK_SCHEMAS.friends).ambiguous,true);
 assert.throws(()=>assertTaskResponse({events:[],business:[]},TASK_SCHEMAS.assetsUpdate,{currentCurrency:'USD'}),e=>e.code==='PHONE_DATA_MISSING');
});
