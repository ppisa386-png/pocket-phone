import {appendChange,replayJournal} from './journal.js?v=1.2.57';
import {readStoryClock} from './story-clock.js?v=1.2';
import {storyAnnotations} from './story-phone.js?v=1.2.64';
import {wxFriends,canViewWxMoment,wxMoments} from './wechat-moments.js?v=1.2.64';

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
            const at=prose.indexOf(text),prior=prose.slice(Math.max(0,at-100),at);
            const nearby=prose.slice(Math.max(0,at-100),at+text.length+45);
            // A pasted annotation cannot turn a plan or draft into a sent post.
            if(row.action==='published'&&
                (!/(?:发表|发布|发出|发到|更新|上传).{0,16}朋友圈|朋友圈.{0,16}(?:发表|发布|发出|更新|上传)|(?:posted|published).{0,16}moments?/i.test(nearby)||
                /(?:打算|准备|计划|想要|还没|尚未|并未|没有|未曾|取消|草稿).{0,18}(?:发|发表|发布|朋友圈|post|publish)/i.test(prior)))continue;
            if(row.action==='comment'&&!/(?:评论|留言|回复|朋友圈.{0,12}发送|comment|repl(?:y|ied))/i.test(nearby))continue;
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
