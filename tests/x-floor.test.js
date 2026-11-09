import test from 'node:test';
import assert from 'node:assert/strict';
import {X_FLOOR_LEDGER,coveredFloors,hasUnsettledFloors,pendingFloorBatch,coverThrough,floorAudienceChanges} from '../src/x-floor.js';

const chat=()=>[
    {mes:'第一楼已经公开传播。'},
    {mes:'user message',is_user:true},
    {mes:'第二楼持续爆红。'},
    {mes:'<!-- hidden -->',is_system:true},
    {mes:'第三楼网友开始取关。'},
];
test('unmarked first use, merged ranges, and only unprocessed assistant floors',()=>{
    const messages=chat();
    assert.equal(hasUnsettledFloors(messages,null,4),true);
    assert.deepEqual(pendingFloorBatch(messages,[],4).rows.map(x=>x.sourceIndex),[0,2,4]);
    const first=coverThrough([],2);
    assert.deepEqual(first,[[0,2]]);
    assert.deepEqual(pendingFloorBatch(messages,first,4).rows.map(x=>x.sourceIndex),[4]);
    assert.deepEqual(coverThrough(first,4),[[0,4]]);
    assert.equal(hasUnsettledFloors(messages,{id:X_FLOOR_LEDGER,type:'floor-ledger',ranges:[[0,4]]},4),false);
    assert.deepEqual(coveredFloors([[5,5],[0,1],[2,4]]),[[0,5]]);
});
test('limited batches leave later floors available and do not count user/system messages',()=>{
    const messages=chat();
    const first=pendingFloorBatch(messages,[],4,16);
    assert.deepEqual(first.rows.map(x=>x.sourceIndex),[0]);
    const next=pendingFloorBatch(messages,coverThrough([],first.lastIndex),4,16);
    assert.deepEqual(next.rows.map(x=>x.sourceIndex),[2]);
});
test('floor follower deltas are incremental, validated and do not alter the original influence records',()=>{
    const state={x:{audience:{id:'audience',type:'audience',initialFollowers:100,followers:100},
        p:{id:'p',type:'post',author:'user'},'impact:post:p':{id:'impact:post:p',type:'influence',gained:20,lost:0}}};
    const apply=effects=>{for(const row of floorAudienceChanges(state,effects))state.x[row.key]=row.value;};
    apply([{postId:'p',gained:15,lost:2}]);
    assert.equal(state.x.audience.followers,113);
    assert.equal(state.x['impact:post:p'].gained,20);
    apply([]);assert.equal(state.x.audience.followers,113);
    assert.throws(()=>apply([{postId:'invented',gained:1,lost:0}]));
    assert.throws(()=>apply([{postId:'p',gained:1,lost:0},{postId:'p',gained:1,lost:0}]));
    assert.throws(()=>apply([{postId:'p',gained:-1,lost:0}]));
    assert.equal(state.x.audience.followers,113);
});
