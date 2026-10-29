import { smsForAI } from './sms-context.js?v=1.0.2';
import { exactStoryTime } from './story-clock.js?v=1.0.2';
import { isMemoryHidden } from './journal.js?v=1.0.2';
import { readPreparedMemory } from './external-memory.js?v=1.0.2';
const normalizeQuote=value=>String(value??'').normalize('NFKC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,'');
// Read only the current participant's card, user persona and chat-scoped prepared recall.
export function proactiveSources(context,settings,participant,state) {
    const card=context.characters?.[participant.characterId],data=card?.data||card||{};
    const expand=text=>String(text||'').replace(/\{\{\s*(user|char)\s*\}\}/gi,(_,key)=>key.toLowerCase()==='user'?context.name1||'user':participant.name);
    const sources=[];
    const add=(id,text)=>{if(typeof text==='string'&&text.trim())sources.push({id,text:expand(text)});};
    add('persona',context.powerUserSettings?.persona_description);
    for(const key of ['description','personality','scenario'])add('card:'+key,data[key]);
    add('memory',readPreparedMemory(context,settings).text);
    for(const call of Object.values(state.calls||{}))if(call.contactId===participant.id&&call.turns?.length)add('call:'+call.id,call.turns.map(t=>t.text).join('\n'));
    for(const m of smsForAI(state,participant.id,exactStoryTime(context.chat)))if(m.contactId===participant.id&&m.replyStatus!=='queued')add('message:'+m.id,m.text);
    return sources;
}
export function findProactiveEvidence(evidence,chat,sources=[],source) {
    const quote=normalizeQuote(evidence);if(quote.length<4)return null;
    if(!source||source==='chat'){
        const index=chat.findIndex(m=>(!m.is_system||isMemoryHidden(m))&&normalizeQuote(m.mes).includes(quote));
        if(index>=0)return {source:'chat',sourceIndex:index};
    }
    const item=sources.find(s=>(!source||source===s.id)&&normalizeQuote(s.text).includes(quote));
    return item?{source:item.id,sourceIndex:chat.length-1}:null;
}
