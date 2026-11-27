import {appendChange,replayJournal} from './journal.js?v=1.2.57';
import {readStoryClock} from './story-clock.js?v=1.2.100';
import {storyAnnotations} from './story-phone.js?v=1.2.100';
import {wxFriends,canViewWxMoment,wxMoments} from './wechat-moments.js?v=1.2.100';

const short=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const publishAction=/(?:发表|发布|发出|发到|发了|晒了|晒出|更新|上传|分享).{0,30}朋友圈|朋友圈.{0,30}(?:发表|发布|发出|发到|发了|晒了|晒出|更新|上传|分享)|(?:posted|published|uploaded).{0,30}moments?/i;
const abandoned=/(?:打算|准备|计划|想要|还没|尚未|并未|没有|未曾|取消|草稿).{0,18}(?:发|发表|发布|朋友圈|post|publish)/i;
const allowedModes=new Set(['all','private','include','exclude']);

// Old marker: imageDescription string. New marker: images[] in photo order.
// Accept alternate array shapes without silently discarding malformed media.
function markerImages(row){
    const raw=row.images??row.imageDescriptions??row.imageDescription??'';
    const images=Array.isArray(raw)?raw:typeof raw==='string'?(raw.trim()?[raw]:[]):null;
    if(!images||images.length>9||images.some(image=>typeof image!=='string'||!image.trim()||image.length>1500))
        return null;
    return images.map(image=>image.trim());
}

// Every imported Moment is tied to its completed source floor. Revisions,
// swipes and deletion revoke both user and NPC narrative publications.
export function importStoryWechatMoments(raw,revisions,chat,context) {
    if(context?.extensionSettings?.personal_pocket_phone?.apps?.wechat===false)return {journal:raw,changed:false};
    let journal=raw,state=replayJournal(raw),changed=false;
    for(let index=0;index<chat.length;index++){
        const rows=storyAnnotations(chat[index],'durian-wechat-moment');
        for(const [n,row] of rows.entries()){
            const eventId='wechat-moment-story:'+revisions[index]+':'+n;
            if(journal.events.some(e=>e.id===eventId)||!record(row))continue;
            const isUser=row.authorId==='user';
            const account=isUser?{id:'user',name:state.wechat?.profile?.alias||context.name1||'user'}:
                wxFriends(state).find(a=>a.id===row.authorId);
            if(!account)continue;
            const publishing=row.action==='published';
            if(!publishing&&row.action!=='comment')continue;
            const text=publishing&&(row.text==null||(typeof row.text==='string'&&!row.text.trim()))?'':short(row.text,publishing?6000:500);
            if(text===null)continue;
            const prose=String(row.prose||'');
            if(text&&!prose.includes(text))continue;
            const at=text?prose.indexOf(text):0;
            const prior=text?prose.slice(Math.max(0,at-100),at):prose;
            const nearby=text?prose.slice(Math.max(0,at-100),at+text.length+65):prose;
            if(publishing&&(!publishAction.test(nearby)||abandoned.test(prior)))continue;
            if(!publishing&&!/(?:评论|留言|回复|朋友圈.{0,12}发送|comment|repl(?:y|ied))/i.test(nearby))continue;
            const prefix=chat.slice(0,index+1),clock=readStoryClock(prefix);
            const now=(Date.parse(chat[index]?.send_date)||Date.now())+n;
            let changes=[];
            if(publishing){
                const images=markerImages(row);
                if(!images||(!text&&!images.length))continue;
                if(!text&&!/(?:图片|照片|配图|九宫格|拍照|相片|photo|picture|image)/i.test(nearby))continue;
                // A restricted narrative post must never quietly become public
                // if the model omitted its actual audience settings.
                const visibility=isUser?(row.visibility??'all'):'all';
                if(!allowedModes.has(visibility))continue;
                const audienceIds=isUser?(row.audienceIds??[]):[];
                const friends=new Set(wxFriends(state).map(a=>a.id));
                if(!Array.isArray(audienceIds)||audienceIds.length>300||
                    audienceIds.some(id=>typeof id!=='string'||!friends.has(id)))continue;
                const audience=[...new Set(audienceIds)];
                if(['include','exclude'].includes(visibility)&&!audience.length)continue;
                if(isUser&&visibility==='all'&&/(?:仅自己可见|仅我可见|设为私密|部分可见|不给谁看|只给[^，。；\n]{1,24}看|不给[^，。；\n]{1,24}看|仅[^，。；\n]{1,18}可见)/.test(nearby))continue;
                const imageDescription=images.join('\n');
                if(wxMoments(state).some(p=>p.authorId===account.id&&p.text===text&&
                    (p.imageDescription||'')===imageDescription))continue;
                const value={id:eventId,type:'moment',authorId:account.id,authorName:account.name,
                    text,imageDescription,...(images.length>1?{images}:{}),
                    visibility,audienceIds:['include','exclude'].includes(visibility)?audience:[],
                    likes:[],comments:[],createdAt:now,storyTime:clock,origin:'narrative'};
                changes=[{collection:'wechat',key:value.id,value}];
            }else{
                // User comments are written only by the real phone-side action.
                // Narrative import continues to record only authenticated NPCs.
                if(isUser)continue;
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
