import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, isMemoryHidden } from './journal.js?v=1.0.6';
import { createNarrativePrompt } from './narrative-prompt.js?v=1.0.6';
import { buildDailyPrompt } from './daily-core.js?v=1.0.6';
export const DAILY_KEY='durian_phone_daily';
export function createDailyBridge({getContext,getSettings,onError=()=>{}}){
    const c=getContext(),bus=c?.eventSource,types=c?.event_types??c?.eventTypes??{},hooks=[];let token=0,disposed=false;
    const output=createNarrativePrompt({getContext,key:DAILY_KEY,depth:1});
    const clear=()=>{token++;output.clear();};
    const listen=(n,f)=>{if(types[n]&&bus?.on){bus.on(types[n],f);hooks.push([types[n],f]);}};
    async function prepare(type='normal',_o,dry){
        if(dry)return;clear();if(disposed||['quiet','impersonate'].includes(type)||!getSettings().apps.daily)return;
        const c=getContext(),metadata=c.chatMetadata;if(!metadata||!c.chat?.length)return;
        const chat=['swipe','regenerate'].includes(type)&&!c.chat.at(-1).is_user?c.chat.slice(0,-1):c.chat;
        const signatures=messageSignatures(chat),turn=token;
        const current=()=>!disposed&&turn===token&&getSettings().apps.daily&&getContext().chatMetadata===metadata&&JSON.stringify(messageSignatures(getContext().chat||[]).slice(0,signatures.length))===JSON.stringify(signatures);
        try{
            const rev=await revisionsFor(signatures),legacy=chat.some(isMemoryHidden)?await revisionsFor(messageSignatures(chat,true)):null;
            const state=replayJournal(reconcileJournal(metadata[JOURNAL_KEY],rev,legacy).journal);
            if(!current())return;
            const prompt=buildDailyPrompt(state,chat,getSettings().prompts.dailyStory);
            output.set(prompt,current);
        }catch(e){onError(e);}
    }
    if(c?.setExtensionPrompt&&bus?.on){if(types.GENERATION_AFTER_COMMANDS){listen('GENERATION_STARTED',(_t,_o,dry)=>{if(!dry)clear();});listen('GENERATION_AFTER_COMMANDS',prepare);}else listen('GENERATION_STARTED',prepare);for(const n of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','MESSAGE_SWIPED','GROUP_WRAPPER_FINISHED'])listen(n,clear);}
    return {prepare,destroy(){clear();disposed=true;output.destroy();for(const[n,f]of hooks)bus.removeListener?.(n,f);}};
}
