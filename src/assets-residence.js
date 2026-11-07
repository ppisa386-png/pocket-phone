import { resolveResidence, RESIDENCE_RULE } from './currency.js?v=1.1.29';


export const hasResidence = wallet => !!(wallet?.region && wallet?.currency);
export function residenceContract(wallet) {
    if (!hasResidence(wallet)) return RESIDENCE_RULE;
    return '常住地已经确认并保存为 '+wallet.region+'，账本币种 '+wallet.currency+'。本次沿用，不重新核实人设或正文居住依据，不要求返回residence。只检查本次正式摘要中 messageIndex 属于 expenseSummaryIndices 的花费楼层，是否明确说明user已经改变长期常住地；旅行、出差、计划、假设、他人搬家和仅出现外国消费均不算迁居。摘要缺失或没有明确变动就返回residenceChange:null，正常完成原币结算。确已迁居才返回residenceChange:{sourceIndex:摘要的messageIndex,subject:"user",status:"completed",region:新地区代码,currency:当地币种,place:摘要里的地名}。不从人设或其他楼层猜测迁居。跨币区时仅返回该变更与目标currency等待换币确认；同币区照常结算。';
}

// Read only existing public summaries of expense floors, during wallet update.
// No prose monitor, recall, auxiliary generation or cross-chat cached snapshot.
export function expenseFloorSummaries(state, floors) {
    if(!hasResidence(state.assets?.wallet))return [];
    const after=state.assets.wallet.lastIndex??-1,indices=new Set();
    for(const e of Object.values(state.assets||{}))if(e.sourceIndex>after&&
        ((e.type==='story_event'&&e.kind==='expense')||(e.type==='cash_transaction'&&e.deltaMinor<0)))indices.add(e.sourceIndex);
    for(const o of Object.values(state.orders||{}))if(o.type==='order'&&o.sourceIndex>after)indices.add(o.sourceIndex);
    return floors.filter(f=>indices.has(f.messageIndex));
}

export function assessmentResidence(wallet, data, persona, prose, summaries=[]) {
    if(!hasResidence(wallet))return resolveResidence(data.residence,persona,prose,{allowInference:true});
    const change=data.residenceChange;
    if(!change||change.subject!=='user'||change.status!=='completed')return null;
    // Structural guard only: a declared migration must point at a real
    // expense-floor summary. Whether the prose truly marks a completed move is
    // the model's judgement now; quotes are no longer verified.
    const source=summaries.find(f=>f.messageIndex===change.sourceIndex);
    if(!source)return null;
    try { return resolveResidence(change,'',[],{}); }
    catch { return null; } // An invalid proposed change cannot invalidate an established home.
}
