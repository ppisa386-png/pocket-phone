import { isMemoryHidden } from './journal.js?v=1.1.13';
import { resolveResidence, RESIDENCE_RULE } from './currency.js?v=1.1.11';


export const hasResidence = wallet => !!(wallet?.region && wallet?.currency);
export function residenceContract(wallet) {
    if (!hasResidence(wallet)) return RESIDENCE_RULE;
    return '常住地已经确认并保存为 '+wallet.region+'，账本币种 '+wallet.currency+'。本次沿用，不重新核实人设或正文居住依据，不要求返回residence。只检查expenseFloorSummaries中产生花费楼层的正式摘要，是否明确说明user已经改变长期常住地；旅行、出差、计划、假设、他人搬家和仅出现外国消费均不算迁居。摘要缺失或没有明确变动就返回residenceChange:null，正常完成原币结算。确已迁居才返回residenceChange:{sourceIndex:摘要的messageIndex,subject:"user",status:"completed",region:新地区代码,currency:当地币种,place:摘要里的地名,evidence:摘要里说明已迁居的原句}。不从人设、普通正文或其他召回猜测迁居。跨币区时仅返回该变更与目标currency等待换币确认；同币区照常结算。';
}

// Read only existing public summaries of expense floors, during wallet update.
// No prose monitor, recall, auxiliary generation or cross-chat cached snapshot.
export function expenseFloorSummaries(context, settings, state, bridge = globalThis.qqj_v3_public_bridge_v1) {
    if (!hasResidence(state.assets?.wallet) || settings.api?.memorySource === 'none' || !bridge?.getSnapshot) return [];
    const after=state.assets.wallet.lastIndex ?? -1;
    const indices=new Set(Object.values(state.assets||{}).filter(e=>
        (e.type==='story_event' && e.kind==='expense') || (e.type==='cash_transaction' && e.deltaMinor<0)
    ).map(e=>e.sourceIndex).filter(i=>Number.isInteger(i)&&i>after&&i<context.chat.length));
    for(const o of Object.values(state.orders||{}))if(o.type==='order'&&o.sourceIndex>after&&o.sourceIndex<context.chat.length)indices.add(o.sourceIndex);
    if(!indices.size)return [];
    try {
        const snapshot=bridge.getSnapshot(), primary=context.getCurrentChatId?.();
        const id=String(primary==null||primary===''?context.chatId??'':primary).trim(), qqjId=context.chatMetadata?.qianqianjie?.chatId;
        if(snapshot?.status!=='ready'||snapshot.memory?.status!=='ready'||!id||snapshot.identity?.hostChatId!==id||(qqjId&&snapshot.identity?.qqjChatId!==qqjId))return [];
        const selected=[],seen=new Set();
        for(const f of Array.isArray(snapshot.memory.floors)?snapshot.memory.floors:[]){
            const message=context.chat[f?.messageIndex];
            if(!indices.has(f?.messageIndex)||seen.has(f.messageIndex)||message?.is_user||message?.role==='user'||(message?.is_system&&!isMemoryHidden(message))||message?.role==='system'||typeof f.summary!=='string'||!f.summary.trim())continue;
            seen.add(f.messageIndex);selected.push({messageIndex:f.messageIndex,summary:f.summary});
        }
        return selected.sort((a,b)=>a.messageIndex-b.messageIndex);
    } catch { return []; }
}

export function assessmentResidence(wallet, data, persona, prose, summaries=[]) {
    if(!hasResidence(wallet))return resolveResidence(data.residence,persona,prose,{allowInference:true});
    const change=data.residenceChange;
    if(!change||change.subject!=='user'||change.status!=='completed')return null;
    const source=summaries.find(f=>f.messageIndex===change.sourceIndex);
    if(!source||typeof change.evidence!=='string'||!source.summary.includes(change.evidence))return null;
    const evidence=change.evidence;
    if(/(?:计划|打算|准备|考虑|想要|假如|如果|尚未|还没|没有|并未|取消|plans? to|planning to|might|has not|hasn't|not yet|cancelled)/i.test(evidence))return null;
    try { return resolveResidence(change,'',[{text:source.summary}]); }
    catch { return null; } // An unverified proposed change cannot invalidate an established home.
}
