import {appendChange,replayJournal} from './journal.js?v=1.2';
import {readStoryClock} from './story-clock.js?v=1.2';
import {storyAnnotations} from './story-phone.js?v=1.2.49';
import {wxFriends,canViewWxMoment,wxMoments} from './wechat-moments.js?v=1.2.49';

const short=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

// Reconcile only explicit completed NPC Moments already written in the novel.
// All writes are anchored to this source-floor revision and replay backward on
// edit, swipe or deletion, just like X's narrative tags.
export function importStoryWechatMoments(raw,revisions,chat,context) {
    if(context?.extensionSettings?.personal_pocket_phone?.apps?.wechat===false)return {journal:raw,changed:false};
    let journal=raw,state=replayJournal(raw),changed=false;
    for(let index=0;index<chat.length;index++){
        const rows=storyAnnotations(chat[index],'durian-wechat-moment');
        for(const [n,row] of rows.entries()){
            const eventId='wechat-moment-story:'+revisions[index]+':'+n;
            if(journal.events.some(e=>e.id===eventId)||!record(row))continue;
            const account=wxFriends(state).find(a=>a.id===row.authorId);
            if(!account)continue;
            const text=short(row.text,row.action==='published'?6000:500);
            const prose=String(row.prose||'');
            if(!text||!prose.includes(text))continue;
            const prefix=chat.slice(0,index+1),clock=readStoryClock(prefix);
            const now=(Date.parse(chat[index]?.send_date)||Date.now())+n;
            let changes=[];
            if(row.action==='published'){
                const imageDescription=row.imageDescription==null?'':short(row.imageDescription,1500);
                if(imageDescription===null)continue;
                if(wxMoments(state).some(p=>p.authorId===account.id&&p.text===text&&
                    (p.imageDescription||'')===imageDescription))continue;
                const value={id:eventId,type:'moment',authorId:account.id,authorName:account.name,
                    text,imageDescription,visibility:'all',audienceIds:[],likes:[],comments:[],
                    createdAt:now,storyTime:clock,origin:'narrative'};
                changes=[{collection:'wechat',key:value.id,value}];
            }else if(row.action==='comment'){
                const target=state.wechat?.[row.momentId];
                if(target?.type!=='moment'||!canViewWxMoment(target,account.id))continue;
                const parent=row.replyTo==null||row.replyTo===''?null:
                    (target.comments||[]).find(c=>c.id===row.replyTo&&(c.authorId==='user'||c.authorId===account.id));
                if(row.replyTo&&!parent)continue;
                if((target.comments||[]).some(c=>c.authorId===account.id&&c.text===text&&
                    (c.replyTo||null)===(parent?.id||null)))continue;
                const comment={id:eventId,authorId:account.id,name:account.name,text,
                    replyTo:parent?.id||null,createdAt:now,storyTime:clock,origin:'narrative'};
                changes=[{collection:'wechat',key:target.id,value:{
                    ...target,comments:[...(target.comments||[]),comment]}}];
            }
            if(!changes.length)continue;
            journal=appendChange(journal,revisions.slice(0,index+1),changes,eventId);
            state=replayJournal(journal);changed=true;
        }
    }
    return {journal,changed};
}
