import { resolveResidence, RESIDENCE_RULE } from './currency.js?v=1.2';



const RESIDENCE_PLACE_GROUPS = [
    { region:'US', currency:'USD', names:/芝加哥|纽约|洛杉矶|洛杉磯|旧金山|舊金山|美国|美國|\b(?:chicago|new york|los angeles|san francisco|united states|usa)\b/i },
    { region:'CN', currency:'CNY', names:/中国|中國|北京|上海|广州|廣州|深圳|杭州|成都|重庆|重慶|\b(?:china|beijing|shanghai|guangzhou|shenzhen|chengdu)\b/i },
    { region:'JP', currency:'JPY', names:/日本|东京|東京|大阪|京都|\b(?:japan|tokyo|osaka|kyoto)\b/i },
    { region:'GB', currency:'GBP', names:/英国|英國|伦敦|倫敦|\b(?:united kingdom|britain|england|london)\b/i },
    { region:'FR', currency:'EUR', names:/法国|法國|巴黎|\b(?:france|paris)\b/i },
    { region:'DE', currency:'EUR', names:/德国|德國|柏林|慕尼黑|\b(?:germany|berlin|munich)\b/i },
    { region:'CA', currency:'CAD', names:/加拿大|多伦多|多倫多|温哥华|溫哥華|\b(?:canada|toronto|vancouver)\b/i },
    { region:'AU', currency:'AUD', names:/澳大利亚|澳大利亞|澳洲|悉尼|墨尔本|墨爾本|\b(?:australia|sydney|melbourne)\b/i },
    { region:'KR', currency:'KRW', names:/韩国|韓國|首尔|首爾|\b(?:south korea|seoul)\b/i },
    { region:'SG', currency:'SGD', names:/新加坡|\bsingapore\b/i },
    { region:'HK', currency:'HKD', names:/香港|\bhong kong\b/i },
    { region:'TW', currency:'TWD', names:/台湾|臺灣|台灣|台北|臺北|\b(?:taiwan|taipei)\b/i },
];
// Accept a single explicit residence field in User Persona, not scenery,
// nationality, other people's homes, or a travel destination.
export function explicitPersonaResidence(persona,userName='') {
    // Normalize only the Markdown label wrapper, not the field value.
    const source=String(persona||'').normalize('NFKC').split(/\r?\n/).map(line=>
        line.replace(/^(\s*(?:[-*+]\s+|\d+[.)、]\s+)?)(?:\*\*|__)([^\n*]{1,50})(?:\*\*|__)\s*([:：])/, '$1$2$3')
            .replace(/^(\s*(?:[-*+]\s+|\d+[.)、]\s+)?)(?:\*\*|__)([^\n*]{1,50}[:：])(?:\*\*|__)/, '$1$2')
    ).join('\n');
    // Match only an explicit, unnegated user field. Don't infer a home from
    // somebody else's residence, birthplace, language, travel or prose.
    const pattern=/(?:^|[\n\r。；;])\s*(?:[-*+]\s+|\d+[.)、]\s+)?(?:(?:([\p{L}\p{N}·.]{1,30})\s*(?:的)?\s*)?(?:常驻地|常住地|常居地|现居地|居住地|定居地|长期居住地|residence|home\s*base))\s*[:：]\s*([^\n\r。；;]{1,100})/gimu;
    const matches=[...source.matchAll(pattern)];
    if(matches.length!==1)return null;
    const owner=String(matches[0][1]||'').trim().replace(/的$/,'');
    if(owner && /^(?:他|她|别人|朋友|同事|陌生人|NPC|另一位角色)$/i.test(owner))return null;
    if(userName && owner && !['user','本人','我','我的',userName].some(name=>name.normalize('NFKC').toLowerCase()===owner.toLowerCase()))return null;
    const place=matches[0][2].trim().replace(/^(?:\*\*|__)/,'').replace(/(?:\*\*|__)$/,'').trim();
    if(!place||/^(?:未知|未定|不详|不明|没有|不是|并非|unknown|none|not\b)/i.test(place))return null;
    // Inspect the entire field before determining its region. A list of
    // multiple residences must not silently become the first listed city.
    // Chicago, IL/Illinois is a single familiar US address, not two homes.
    if(/[、，/／]/.test(place)||/,(?!\s*(?:IL|Illinois)\b)/i.test(place)||
        /(?:\s+(?:and|or)\s+|(?:和|与|及|或)(?=[^\s]))/i.test(place))return null;
    const matchesRegion=RESIDENCE_PLACE_GROUPS.filter(item=>item.names.test(place));
    if(matchesRegion.length!==1)return null;
    return {region:matchesRegion[0].region,currency:matchesRegion[0].currency};
}

export const hasResidence = wallet => !!(wallet?.region && wallet?.currency);
export function residenceContract(wallet) {
    if (!hasResidence(wallet)) return RESIDENCE_RULE + '首次建账必须返回与 initial 并列的顶层 residence。User 人设明确写有“常驻地：芝加哥”等常居城市时直接据此判断真实国家地区与对应货币，不要求正文再次声明国家；只有完全无法推断时才 residence:null。';
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

export function assessmentResidence(wallet, data, persona, prose, summaries=[], userName='') {
    if(!hasResidence(wallet))return resolveResidence(data.residence,persona,prose,{allowInference:true}) || explicitPersonaResidence(persona,userName);
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
