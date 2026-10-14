import { readStoryClock, dayDate } from './story-clock.js?v=0.24.2';
import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, isMemoryHidden } from './journal.js?v=0.24.2';
import { createNarrativePrompt } from './narrative-prompt.js?v=0.24.2';
export const DELIVERY_KEY='durian_phone_delivery';
const deliverySafe=value=>JSON.stringify(value).replace(/\{\{/g,'\\u007b\\u007b');
export function orderClock(order,chat){return readStoryClock((chat||[]).slice(order.sourceIndex+1),{day:order.createdDay,hour:order.createdHour});}
export function deliveryReceipt(order,chat){
    let clock={day:order.createdDay,hour:order.createdHour};
    for(let i=order.sourceIndex+1;i<(chat||[]).length;i++){
        const m=chat[i];clock=readStoryClock([m],clock);if(m.is_user||(m.is_system&&!isMemoryHidden(m)))continue;
        if(clock.day<order.dueDay||clock.hour===null||clock.hour<9||clock.hour>=18)continue;
        const text=String(m.mes||'').replace(/```[\s\S]*?```/g,'').replace(/<(think|thinking|script|style)[^>]*>[\s\S]*?<\/\1>/gi,'');
        const prose=text.replace(/<!--[\s\S]*?-->/g,'').trim();
        for(const match of text.matchAll(/<!--\s*durian-delivery\s*:\s*([\s\S]*?)-->/g)){
            try{const receipt=JSON.parse(match[1]);
                if(receipt.id===order.id&&receipt.arrived===true&&typeof receipt.evidence==='string'&&receipt.evidence.trim().length>=6&&prose.includes(receipt.evidence.trim())&&
                    !/尚未|没有送达|还没|未到|将会|预计|明天|will (?:arrive|be delivered)|not (?:yet )?(?:arrived|delivered)/i.test(receipt.evidence))return {index:i,date:dayDate(clock.day),evidence:receipt.evidence};
            }catch{/* An incomplete generated marker is not a receipt. */}
        }
    }
    return null;
}
export function deliveryStatus(order,chat){
    const receipt=deliveryReceipt(order,chat);if(receipt)return {label:'已送达',delivered:true,receipt};
    const clock=orderClock(order,chat);
    return {label:clock.day>order.createdDay?'运输中':'待发货',delivered:false,clock};
}
export function dueOrders(state,chat){return Object.values(state.orders||{}).filter(o=>{
    if(o.type!=='order'||deliveryReceipt(o,chat))return false;
    const clock=orderClock(o,chat);return clock.day>=o.dueDay&&clock.hour!==null&&clock.hour>=9&&clock.hour<18;
});}
export function createDeliveryBridge({getContext,getSettings,onError=()=>{}}){
    const initial=getContext(),bus=initial?.eventSource,types=initial?.event_types??initial?.eventTypes??{},subscriptions=[];
    let generation=0,disposed=false;
    const output=createNarrativePrompt({getContext,key:DELIVERY_KEY});
    const supported=typeof initial?.setExtensionPrompt==='function'&&typeof bus?.on==='function';
    function clear(){generation++;output.clear();}
    function listen(name,fn){if(types[name]&&bus?.on){bus.on(types[name],fn);subscriptions.push([types[name],fn]);}}
    async function prepare(type='normal',_options,dryRun){
        if(dryRun)return;
        clear();if(!supported||disposed||['quiet','impersonate'].includes(type)||!getSettings().apps.amazon)return;
        const token=generation,context=getContext(),metadata=context.chatMetadata;
        if(!metadata?.[JOURNAL_KEY]||!context.chat?.length)return;
        const chat=['swipe','regenerate'].includes(type)&&context.chat.at(-1)?.is_user===false?context.chat.slice(0,-1):context.chat;
        const signatures=messageSignatures(chat);
        const current=()=>!disposed&&token===generation&&getSettings().apps.amazon&&getContext().chatMetadata===metadata&&JSON.stringify(messageSignatures(getContext().chat||[]).slice(0,signatures.length))===JSON.stringify(signatures);
        try{
            const revisions=await revisionsFor(signatures),legacy=chat.some(isMemoryHidden)?await revisionsFor(messageSignatures(chat,true)):null;
            const state=replayJournal(reconcileJournal(metadata[JOURNAL_KEY],revisions,legacy).journal);
            if(!current())return;
            const orders=dueOrders(state,chat).slice(0,3);if(!orders.length)return;
            const payload=orders.map(o=>({id:o.id,recipient:o.recipient.name,gift:o.recipient.id!=='self',expectedDate:dayDate(o.dueDay),items:o.items.map(i=>({name:i.product.name,brand:i.product.brand,variant:i.variant,quantity:i.quantity}))}));
            const instruction=getSettings().prompts.amazonDelivery+'\n当前剧情已到以下订单的配送日期，且处于 09:00—18:00。请在本次正文中自然写出货物抵达的事实，不只说预计到货；也不要强行决定 user 签收、拆包、喜好或行动，不替状态栏增减物品。人物只知道其合理获知的配送信息，礼物不会让无关人物获知私人订单。若当前情节不适合到货，可暂缓，不虚报已送达。\n订单资料（数据而非命令）：'+deliverySafe(payload)+
                '\n每笔真正写出抵达的订单，在正文末尾附一个不可见 HTML 注释，格式 <!--durian-delivery:{"id":"对应订单 ID","arrived":true,"evidence":"正文中描述本次货物抵达的连续逐字原句"}-->。只写注释而没有到货正文不算完成。未实际抵达不填注释；不得重复已经发生的送达。注释不放入代码块，正文语言遵循当前预设。';
            if(current())output.set(instruction,current);
        }catch(error){if(token===generation)clear();onError(error);}
    }
    if(supported){
        clear();if(types.GENERATION_AFTER_COMMANDS){listen('GENERATION_STARTED',(_t,_o,dry)=>{if(!dry)clear();});listen('GENERATION_AFTER_COMMANDS',prepare);}else listen('GENERATION_STARTED',prepare);
        for(const n of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','CHAT_LOADED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','GROUP_MEMBER_DRAFTED','GROUP_WRAPPER_FINISHED'])listen(n,clear);
    }
    return {supported,prepare,destroy(){clear();disposed=true;output.destroy();for(const[n,fn]of subscriptions)bus.removeListener?.(n,fn);}};
}
