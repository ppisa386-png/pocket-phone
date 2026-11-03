import {localizedPerson,sameNamedPerson,nameAliases,CHINESE_NAME_RULE} from './names.js?v=1.1.8';
import {readXMemory,xMemoryPrompt} from './external-memory.js?v=1.1.14';
import { createSnapchat, parseSnapObject } from './snapchat.js?v=1.1.12';
import { establishedSources, establishedContactPrompt, validateEstablishedContacts } from './contacts.js?v=1.1.12';

export const CHAT_APPS = {whatsapp:'WhatsApp',wechat:'微信'};
export const chatItems = (state,app,type) => Object.values(state[app]||{}).filter(i=>i.type===type);
export const chatUnread = (state,app) => chatItems(state,app,'message').filter(m=>m.role==='assistant'&&!m.read).length;

// A short name is scoped to this request, never saved as a global identity alias.
function matchesFriendName(person,query){
    if(sameNamedPerson(person,{name:query}))return true;
    const short=query.normalize('NFKC').trim().toLowerCase();
    return nameAliases(person).some(alias=>{
        const full=alias.normalize('NFKC').trim().toLowerCase();
        const parts=full.split(/[\s·・•]+/u);
        if(parts.length>1)return parts.includes(short);
        // Unseparated Chinese full name with a single- or double-character surname.
        return /^[\p{Script=Han}]{2,4}$/u.test(full)&&/^[\p{Script=Han}]{1,2}$/u.test(short)
            &&full.endsWith(short)&&[1,2].includes(full.length-short.length);
    });
}
function friendTarget(context,existing,query){
    const members=context.groups?.find(g=>String(g.id)===String(context.groupId))?.members||[];
    const active=(context.characters||[]).filter((c,i)=>context.groupId!=null&&context.groupId!==''?members.includes(c.avatar):context.characterId!=null&&context.characterId!==''&&i===Number(context.characterId));
    const candidates=[...existing,...active].filter(a=>matchesFriendName(a,query));
    if(active.filter(c=>matchesFriendName(c,query)).length>1)throw Error('有多位角色符合这个名字，请输入可区分的姓名。');
    const first=candidates[0];
    if(candidates.some(a=>!sameNamedPerson(first,a)&&!(a.characterId&&a.characterId==='card:'+first.avatar)&&!(first.characterId&&first.characterId==='card:'+a.avatar)))
        throw Error('有多位人物符合这个名字，请补充姓氏或完整姓名。');
    return first||null;
}

// Both apps use the Snapchat conversation engine. Only acquiring friends differs:
// manual requests use recipient decisions; bulk imports restore opening relationships.
export function createChatApp({app,memory,phone,getContext,getSettings}) {
    const label=CHAT_APPS[app];
    if(!label)throw new Error('未知聊天应用。');
    const engine=createSnapchat({app,memory,phone,getContext,getSettings});
    const addByName=query=>phone.appTask(async(view,current,request)=>{
        const name=String(query||'').trim().slice(0,100);
        if(!name)throw new Error('请输入要添加的姓名。');
        const context=getContext(),settings=getSettings(),existing=chatItems(view.state,app,'account');
        const target=friendTarget(context,existing,name);
        const match=existing.filter(a=>sameNamedPerson(a,target||{name}));
        if(match.some(a=>a.blocked))throw new Error('该账号已拉黑，请先解除拉黑。');
        if(match.length>1)throw new Error('存在同名账号，请输入更完整的姓名。');
        if(match[0]?.friend==='friends')return {already:true};
        const inputs=()=>({user:getContext().name1,char:getContext().name2,sources:establishedSources(getContext()),alias:view.state[app]?.profile?.alias||getContext().name1,
            memory:readXMemory(getContext(),getSettings(),{latestOnly:true})});
        const basis=inputs(),signature=JSON.stringify(basis),valid=()=>current()&&signature===JSON.stringify(inputs());
        const ticket=await memory.begin(view);
        const contract='若这个简称在设定中对应多人且无法区分，只返回 {"ambiguous":true}。其余只返回 JSON：{"accepted":true或false,"name":"申请对象的完整中文姓名","aliases":["原名"]}。不添加其他人。';
        const prompt=settings.prompts.general+'\n'+CHINESE_NAME_RULE+'\n当前任务：'+label+'好友请求已送达 '+JSON.stringify({输入:name,候选全名:target?.name})+'。输入可以只是名或惯用简称，请结合设定识别同一人物，原文全名放入aliases。申请人账号名为 '+JSON.stringify(basis.alias)+
            '。结合已有设定与近期摘要，依据对方性格、双方关系、对申请人身份的实际认知及近期经历，判断对方是否愿意通过。不审查号码来源、是否交换账号、是否有共同好友或已在通讯录。没有摘要时仍根据已有设定判断。不得用隐私信息识破匿名。'+
            '\n设定资料：'+JSON.stringify({user:basis.user,char:basis.char,sources:basis.sources})+xMemoryPrompt(basis.memory,label)+'\n'+contract;
        const result=await request(prompt,data=>{
            if(data.ambiguous===true)throw Error('这个名字可能对应多位人物，请补充姓氏或完整姓名。');
            if(typeof data.accepted!=='boolean')throw Error('好友申请响应缺少有效的同意或拒绝决定。');
            if(data.accepted&&(typeof data.name!=='string'||!data.name.trim()||!(target&&!sameNamedPerson(target,{name})?sameNamedPerson(data,target):matchesFriendName(data,name))))throw Error('响应中的人物与申请对象不符。');
            return data;
        },valid,null,{establishedImport:true,retries:0,parseResponse:raw=>parseSnapObject(raw,label),finalOutputContract:contract});
        if(!valid())throw Error('聊天或设定已变化，本次申请已取消。');
        if(!result.accepted)return {declined:true};
        const person=localizedPerson(result,context,existing);
        const matches=existing.filter(a=>sameNamedPerson(a,person));
        if(matches.length>1||matches.some(a=>a.blocked))throw Error('账号已拉黑或姓名不唯一。');
        const old=matches[0],id=old?.id||person.cardId||'name:'+person.name.normalize('NFKC').toLowerCase();
        const value={type:'account',handle:'',blocked:false,createdAt:Date.now(),identityKnown:basis.alias===context.name1,
            ...old,id,name:person.name,aliases:person.aliases,characterId:old?.characterId||person.cardId,friend:'friends',
            ...(old?.inboundRequest?{inboundRequest:'accepted'}:{})};
        await memory.commit(ticket,[{collection:app,key:id,value}]);
        return {added:1};
    },app);
    const addEstablished=()=>phone.appTask(async(view,current,request)=>{
        const context=getContext(),chat=context.chat,sources=establishedSources(context),signature=JSON.stringify(sources);
        if(!sources.length)return {added:0,updated:0};
        const valid=()=>current()&&signature===JSON.stringify(establishedSources(getContext()));
        const existing=chatItems(view.state,app,'account'),ticket=await memory.begin(),settings=getSettings();
        const prompt=establishedContactPrompt(settings.prompts.establishedContacts,context,sources,existing);
        const found=await request(settings.prompts.general+'\n'+prompt+'\n这是'+label+'开局好友导入，不另判好友邀请。',data=>{
            const rejected=[];
            const contacts=validateEstablishedContacts(data,chat,context,sources,existing,(n,reason)=>{if(rejected.length<10)rejected.push('第 '+n+' 项：'+reason);});
            if(data.contacts?.length&&!contacts.length)throw Object.assign(new Error('未能核对开局人物设定。'),{diagnostic:rejected.join('\n')});
            return contacts;
        },valid,null,{retries:0,parseResponse:raw=>parseSnapObject(raw,label),establishedImport:true,
            finalOutputContract:'当前任务是从已给编号设定片段提取开局好友。只返回一个有效JSON对象，根字段contacts必须是数组。候选填写name、source_name、aliases、relationship、established:true、incidental:false、evidence_refs及number。没有符合的人物也必须输出{"contacts":[]}，不要留空、续写正文或生成聊天回复。'});
        if(!valid())throw new Error('聊天或设定已变化，本次添加已取消。');
        let added=0,updated=0;
        const changes=found.map(contact=>{
            const old=view.state[app]?.[contact.id];
            const characterId=contact.id.startsWith('card:')?contact.id:null;
            const value=old?{...old,friend:'friends',name:contact.name,aliases:contact.aliases,
                ...(contact.number?{number:contact.number}:{}),characterId:old.characterId||characterId}
                :{...contact,characterId,type:'account',handle:'',friend:'friends',blocked:false,
                    identityKnown:(view.state[app]?.profile?.alias||context.name1)===context.name1,createdAt:Date.now()};
            if(old){if(JSON.stringify(old)===JSON.stringify(value))return null;updated++;}else added++;
            return {collection:app,key:contact.id,value};
        }).filter(Boolean);
        if(changes.length)await memory.commit(ticket,changes);
        return {added,updated};
    },app);
    const {discover,invite,inviteMany,accept,publish,refresh,like,comment,...conversation}=engine;
    return {...conversation,accept,addByName,addEstablished};
}
