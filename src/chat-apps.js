import { createSnapchat, parseSnapObject } from './snapchat.js?v=1.1.2';
import { contactSources, contactPrompt, validateContacts, establishedSources, establishedContactPrompt, validateEstablishedContacts } from './contacts.js?v=1.1.2';

export const CHAT_APPS = {whatsapp:'WhatsApp',wechat:'微信'};
export const chatItems = (state,app,type) => Object.values(state[app]||{}).filter(i=>i.type===type);
export const chatUnread = (state,app) => chatItems(state,app,'message').filter(m=>m.role==='assistant'&&!m.read).length;

// Both apps use the Snapchat conversation engine. Only acquiring friends differs:
// the same source selection and validators as the phone address book are used.
export function createChatApp({app,memory,phone,getContext,getSettings}) {
    const label=CHAT_APPS[app];
    if(!label)throw new Error('未知聊天应用。');
    const engine=createSnapchat({app,memory,phone,getContext,getSettings});
    const acquire=(query,bulk)=>phone.appTask(async(view,current,request)=>{
        const context=getContext(),chat=structuredClone(context.chat);
        const name=typeof query==='string'?query.trim().slice(0,100):'';
        if(!bulk&&!name)throw new Error('请输入要添加的姓名。');
        const source=()=>bulk?establishedSources(getContext()):contactSources(getContext().chat,getContext(),name);
        const sources=source(),signature=JSON.stringify(sources);
        if(bulk&&!sources.length)return {added:0,updated:0};
        const valid=()=>current()&&signature===JSON.stringify(source());
        const existing=chatItems(view.state,app,'account');
        const ticket=await memory.begin();
        const settings=getSettings();
        const prompt=bulk?establishedContactPrompt(settings.prompts.establishedContacts,context,sources,existing)
            :contactPrompt(settings.prompts.contacts,context,sources,existing);
        const found=await request(settings.prompts.general+'\n'+settings.prompts[app]+'\n'+prompt+
            '\n本次是'+label+'的好友添加入口，完全沿用上述通讯录的姓名、资料来源与资格规则。验证通过者直接成为本 App 好友，不另判好友邀请或是否拥有社媒账号，不新增电话通讯录记录。不编造账号名或号码。输出仍为上述 contacts 结构。',data=>{
                const rejected=[];
                const contacts=bulk?validateEstablishedContacts(data,chat,context,sources,existing,(n,reason)=>{if(rejected.length<10)rejected.push('第 '+n+' 项：'+reason);})
                    :validateContacts(data,chat,context,sources,existing);
                if(data.contacts?.length&&!contacts.length)throw Object.assign(new Error('未能核对姓名或联系依据，本次没有添加好友。'),{diagnostic:rejected.join('\n')});
                return contacts;
            },valid,null,{retries:0,parseResponse:raw=>parseSnapObject(raw,label)});
        if(!valid())throw new Error('聊天或设定已变化，本次添加已取消。');
        let added=0,updated=0;
        const changes=found.map(contact=>{
            const old=view.state[app]?.[contact.id];
            const characterId=contact.id.startsWith('card:')?contact.id:null;
            const value=old?{...old,name:contact.name,aliases:contact.aliases,
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
    return {...conversation,addByName:query=>acquire(query,false),addEstablished:()=>acquire('',true)};
}
