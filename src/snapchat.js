// Fictional Snapchat: all media/calls are text roleplay; no real social API,
// microphone, camera, geolocation, payment or media hosting is used.
export const snapItems = (state, type) => Object.values(state.snapchat || {}).filter(item => item.type === type);
export const snapProfile = (state, name = 'user') => state.snapchat?.profile || { id:'profile',type:'profile',alias:name,currency:'USD',location:'',sharing:false };
export const snapExpired = (item, now = Date.now()) => now - item.createdAt >= 86400000;
export const snapUnread = state => snapItems(state,'message').filter(m=>m.role==='assistant'&&!m.read).length + snapItems(state,'account').filter(a=>a.friend==='incoming').length;
const setSnap = value => ({collection:'snapchat',key:value.id,value});
const text = (value,max=6000) => typeof value==='string' ? value.trim().slice(0,max) : '';
const required = (value,label,max=6000) => { const result=text(value,max);if(!result)throw new Error('请填写'+label+'。');return result; };
export function snapAmount(value) {
    const s=String(value).trim();if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))throw new Error('金额需为正数，最多两位小数。');
    const [whole,fraction='']=s.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!result)throw new Error('金额必须大于 0。');return result;
}
const currencyOf = value => { if(!/^[A-Z]{3}$/.test(value||''))throw new Error('币种请填写三个大写字母，例如 USD。');return value; };
const accountBy = (state,id) => {const a=state.snapchat?.[id];if(a?.type!=='account')throw new Error('账号已不可用。');return a;};
const friendBy = (state,id) => {const a=accountBy(state,id);if(a.friend!=='friends'||a.blocked)throw new Error('需要先成为好友，且不能处于拉黑状态。');return a;};
const mediaKinds=['text','voice','image','video'];
const threadFor=(state,id)=>snapItems(state,'message').filter(m=>m.accountId===id&&m.status!=='queued').sort((a,b)=>a.createdAt-b.createdAt);
const newRecord=(type,fields)=>({id:crypto.randomUUID(),type,createdAt:Date.now(),...fields});

export function createSnapchat({memory,phone,getContext,getSettings}) {
    const run=work=>phone.appTask(async(view,current,request)=>{
        if(!current())throw new Error('Snapchat 已关闭或聊天已变化。');
        const ticket=await memory.begin();
        const commit=async changes=>{if(!current())throw new Error('聊天已变化，本次操作已取消。');if(changes.length)await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit);
    });
    const profile=state=>snapProfile(state,getContext().name1);
    function target(state,account) {
        return {id:account.characterId||account.id,name:account.name,channel:'snapchat',alias:profile(state).alias,identityKnown:account.identityKnown===true};
    }
    function rules(state,account=null) {
        const p=profile(state);
        return getSettings().prompts.general+'\n'+getSettings().prompts.snapchat+'\n这是 Snapchat 文字扮演任务。媒体用文字描述；语音只含可听见内容，视频通话仅限镜头内可见和可听见内容。不得替 user 发言，不产生真实操作。'+
            '\n当前 user 公开网名：'+JSON.stringify(p.alias)+'。'+(account?'当前对方账号：'+JSON.stringify({name:account.name,handle:account.handle})+'；对方'+(account.identityKnown?'已通过此前披露知道账号的真实身份。':'不知道这个账号是谁。后台真人对应、角色卡、user 人设、私人剧情和记忆都不能据此暴露账号身份；只能认识网名及本账号公开过的内容。'):'发现账号不等于知道账号背后的真实身份。')+
            '\n仅使用对应账号已知的信息，不将正文中的私人剧情写成公开动态或据此公开 user 身份。user 未共享的位置不得显示给别人。'+
            (account?'\n本账号此前互动与转账：'+JSON.stringify(Object.values(state.snapchat||{}).filter(i=>i.accountId===account.id&&['call','transfer'].includes(i.type)).slice(-20))+'\nuser 向好友公开的故事：'+JSON.stringify(snapItems(state,'story').filter(i=>i.author==='user'&&!snapExpired(i)).slice(-8))+'\nuser 共享位置：'+JSON.stringify(p.sharing?p.location:null):'')+
            '\n只输出本任务指定 JSON，内容语言遵守酒馆预设。';
    }
    const ask=(state,account,request,current,prompt,validate)=>request(rules(state,account)+'\n'+prompt,validate,current,account?target(state,account):null);
    const knownAtContact=(state,account)=>account.identityKnown||profile(state).alias===getContext().name1;
    function ledger(transfer) {
        return {collection:'assets',key:'snapcash:'+transfer.id,value:{id:'snapcash:'+transfer.id,type:'cash_transaction',source:'snapcash',transferId:transfer.id,currency:transfer.currency,amountMinor:transfer.amountMinor,
            deltaMinor:transfer.direction==='incoming'?transfer.amountMinor:-transfer.amountMinor,counterparty:transfer.accountId,createdAt:Date.now()}};
    }
    function replyData(data) {
        if(!['reply','no_reply'].includes(data.status))throw new Error('Snapchat 回复格式不正确。');
        const source=data.messages??(data.text?[{kind:data.kind,text:data.text}]:[]);
        if(!Array.isArray(source)||source.length>8)throw new Error('Snapchat 消息格式不正确。');
        const messages=source.map(m=>({kind:mediaKinds.includes(m.kind)?m.kind:'text',text:text(m.text)}));
        if(data.status==='reply'&&(!messages.length||messages.some(m=>!m.text)))throw new Error('回复没有文字内容。');
        if(messages.some(m=>m.text.length>600))throw new Error('回复过长，请分成简短消息。');
        if(data.transfer){snapAmount(data.transfer.amount);currencyOf(data.transfer.currency);}
        return {status:data.status,messages:data.status==='reply'?messages:[],transfer:data.transfer};
    }
    async function answerMessage(state,account,message,request,current,commit) {
        const batch=message.batchId?threadFor(state,account.id).filter(m=>m.role==='user'&&m.batchId===message.batchId):[message];
        const result=await ask(state,account,request,current,'当前任务：Snapchat 聊天。回应 user 本次连续发送的一组内容，不仅是末尾一句。聊天像现实即时通信：通常一句话一条消息，简短自然，按需要回复 1—3 条；不写长篇大论或小说旁白，不为凑条数重复。双方聊天资料：'+JSON.stringify(threadFor(state,account.id).slice(-60).map(m=>({role:m.role,kind:m.kind,text:m.text})))+
            '\n本次 user 消息：'+JSON.stringify(batch.map(m=>({kind:m.kind,text:m.text})))+
            '\n只输出 {"status":"reply 或 no_reply","messages":[{"kind":"text/voice/image/video","text":"一条简短消息、语音转写或媒体描述"}],"transfer":null}。语言和翻译要求遵守预设。如角色自愿转账，可将 transfer 设为 {"amount":"金额字符串","currency":"USD 等三字母币种","memo":"附言"}；仅为待收款邀请，不自动收款。',replyData);
        const changes=batch.map(m=>setSnap({...m,status:result.status==='reply'?'answered':'no_reply'}));
        const time=Math.max(Date.now(),...threadFor(state,account.id).map(m=>m.createdAt+1));
        result.messages.forEach((m,i)=>changes.push(setSnap({id:'reply:'+message.id+(i?':'+i:''),type:'message',accountId:account.id,role:'assistant',kind:m.kind,text:m.text,replyTo:message.id,createdAt:time+i/1000,read:false})));
        if(result.transfer)changes.push(setSnap({id:'transfer:'+message.id,type:'transfer',accountId:account.id,direction:'incoming',status:'pending',amountMinor:snapAmount(result.transfer.amount),currency:currencyOf(result.transfer.currency),memo:text(result.transfer.memo,300),createdAt:time}));
        await commit(changes);
    }
    return {
        async open(){await memory.read();},
        saveProfile(values){return run(async(state,_c,_r,commit)=>{
            const p=profile(state);await commit([setSnap({...p,alias:required(values.alias,'网名',60),currency:currencyOf(values.currency),location:text(values.location,200),sharing:values.sharing===true})]);
        });},
        discover(query=''){return run(async(state,current,request,commit)=>{
            const visible=(getContext().chat||[]).filter(m=>!m.is_system&&!m.hidden&&!m.is_hidden).slice(-80).map(m=>m.mes);
            const data=await ask(state,null,request,current,'当前任务：Snapchat 新增联系人。搜索 '+JSON.stringify(text(query,100))+'。可见剧情：'+JSON.stringify(visible)+
                '\n根据当前设定判断哪些人物确实有 Snapchat 账号，不能因为是亲友或已有电话号码就自动添加；不合适用空数组。char 默认用真名、各只有一个账户。仅发现账号，不自动成为好友。可返回合理的待接受邀请。输出 {"accounts":[{"name":"姓名","handle":"唯一账号名","has_account":true,"invitation":"none 或 incoming"}]}，最多 10 个。',d=>{if(!Array.isArray(d.accounts)||d.accounts.length>10)throw new Error('账号搜索结果格式不正确。');return d.accounts;});
            const changes=[],used=new Set(),handles=new Set();
            for(const item of data){if(item.has_account!==true)continue;const name=text(item.name,100),handle=text(item.handle,60).replace(/^@/,'');if(!name||!handle||/[\s<>]/.test(handle))continue;
                const matches=(getContext().characters||[]).filter(c=>c.name===name);const characterId=matches.length===1?'card:'+matches[0].avatar:null;
                const old=snapItems(state,'account').find(a=>(characterId&&a.characterId===characterId)||a.name===name||a.handle.toLowerCase()===handle.toLowerCase());
                if(old||used.has(name)||handles.has(handle.toLowerCase())||name===getContext().name1)continue;used.add(name);handles.add(handle.toLowerCase());
                changes.push(setSnap(newRecord('account',{name,handle,characterId,friend:item.invitation==='incoming'?'incoming':'none',identityKnown:false,blocked:false})));
            }
            await commit(changes);return {added:changes.length};
        });},
        invite(id){return run(async(state,current,request,commit)=>{
            const account=accountBy(state,id);if(account.blocked||account.friend==='friends')throw new Error('无需再次添加这个账号。');
            const known={...account,identityKnown:knownAtContact(state,account)};
            const data=await ask(state,known,request,current,'当前任务：Snapchat 好友邀请。user 请求添加对方。根据角色决定，输出 {"status":"friends 或 pending 或 declined"}。',d=>{if(!['friends','pending','declined'].includes(d.status))throw new Error('好友邀请结果格式不正确。');return d;});
            await commit([setSnap({...known,friend:data.status})]);
        });},
        accept(id,accept){return run(async(state,_c,_r,commit)=>{const a=accountBy(state,id);if(a.friend!=='incoming')throw new Error('邀请已处理。');await commit([setSnap({...a,friend:accept?'friends':'declined',identityKnown:accept?knownAtContact(state,a):a.identityKnown})]);});},
        block(id,value){return run(async(state,_c,_r,commit)=>{const a=accountBy(state,id);const changes=[setSnap({...a,blocked:value})];for(const call of snapItems(state,'call').filter(c=>c.accountId===id&&c.status==='connected'))changes.push(setSnap({...call,status:'ended'}));await commit(changes);});},
        reveal(id){return run(async(state,_c,_r,commit)=>{const a=friendBy(state,id);await commit([setSnap({...a,identityKnown:true}),setSnap(newRecord('message',{accountId:id,role:'user',kind:'text',text:'我是 '+getContext().name1+'。',status:'sent',read:true}))]);});},
        queueMessage(id,kind,value){return run(async(state,_c,_r,commit)=>{
            friendBy(state,id);if(!mediaKinds.includes(kind))throw new Error('消息类型不可用。');
            const message=newRecord('message',{accountId:id,role:'user',kind,text:required(value,'消息内容'),status:'queued',read:true});
            await commit([setSnap(message)]);return message.id;
        });},
        flushMessages(id){return run(async(state,current,request,commit)=>{
            const a=friendBy(state,id),queued=snapItems(state,'message').filter(m=>m.accountId===id&&m.role==='user'&&m.status==='queued');
            if(!queued.length)throw new Error('请先填写消息。');
            const batchId=crypto.randomUUID(),batch=queued.map(m=>({...m,status:'pending',batchId})),last=batch.at(-1);
            await commit(batch.map(setSnap));
            const fresh=await memory.read(),ticket=await memory.begin();
            try{await answerMessage(fresh.state,a,last,request,current,async changes=>{if(!current())throw new Error('聊天已变化。');await memory.commit(ticket,changes);});}
            catch(error){if(current())await memory.commit(ticket,batch.map(m=>setSnap({...m,status:'failed'})));throw error;}
        });},
        editMessage(id,value){return run(async(state,_c,_r,commit)=>{
            const m=state.snapchat[id];if(m?.type!=='message'||m.role!=='assistant')throw new Error('只能修改对方的消息。');
            await commit([setSnap({...m,text:required(value,'消息内容')})]);
        });},
        rerollMessage(id){return run(async(state,current,request,commit)=>{
            const m=state.snapchat[id];if(m?.type!=='message'||m.role!=='assistant')throw new Error('只能重新生成对方的消息。');
            const a=friendBy(state,m.accountId),thread=threadFor(state,a.id),before=thread.slice(0,thread.findIndex(x=>x.id===id));
            const result=await ask(state,a,request,current,'当前任务：仅重写选中的一条 Snapchat 消息。只用它之前的聊天，不预知后续；简短自然，通常一句话。保持消息类型，不生成其他消息，不触发或改变转账。此前聊天：'+JSON.stringify(before.map(({role,kind,text})=>({role,kind,text})))+'\n被选中的消息：'+JSON.stringify({kind:m.kind,text:m.text})+'\n输出 {"text":"这条消息的新内容"}。',d=>({text:required(d.text,'回复内容',600)}));
            await commit([setSnap({...m,text:result.text})]);
        });},
        send(id,kind,value){return run(async(state,current,request,commit)=>{
            const a=friendBy(state,id);if(!mediaKinds.includes(kind))throw new Error('消息类型不可用。');
            const message=newRecord('message',{accountId:id,role:'user',kind,text:required(value,'消息内容'),status:'pending',read:true});
            await commit([setSnap(message)]);
            const fresh=await memory.read();const nextTicket=await memory.begin();
            try{await answerMessage(fresh.state,a,message,request,current,async changes=>{if(!current())throw new Error('聊天已变化。');await memory.commit(nextTicket,changes);});}
            catch(error){if(current())await memory.commit(nextTicket,[setSnap({...message,status:'failed'})]);throw error;}
        });},
        retryMessage(id){return run(async(state,current,request,commit)=>{const m=state.snapchat[id];if(m?.type!=='message'||m.role!=='user'||!['failed','pending'].includes(m.status))throw new Error('此消息不需要重试。');const a=friendBy(state,m.accountId);const last=m.batchId?threadFor(state,a.id).filter(x=>x.role==='user'&&x.batchId===m.batchId).at(-1):m;await answerMessage(state,a,last,request,current,commit);});},
        markRead(id){return run(async(state,_c,_r,commit)=>{await commit(threadFor(state,id).filter(m=>m.role==='assistant'&&!m.read).map(m=>setSnap({...m,read:true})));});},
        call(id,mode,value='',callId=null){return run(async(state,current,request,commit)=>{
            const a=friendBy(state,id);if(!['voice','video'].includes(mode))throw new Error('通话类型不可用。');
            if(!callId&&snapItems(state,'call').some(c=>c.status==='connected'))throw new Error('请先挂断当前通话。');
            const old=callId?state.snapchat[callId]:null;if(callId&&(old?.type!=='call'||old.accountId!==id||old.status!=='connected'))throw new Error('通话已结束。');
            const turns=old?[...old.turns,{role:'user',text:required(value,'通话内容')}]:[];
            const data=await ask(state,a,request,current,'当前任务：Snapchat '+(mode==='voice'?'语音通话，只允许听觉内容。':'视频通话，可描述镜头内画面与声音，不写镜头外或内心。')+(old?'通话已接通，回应 user。':'user 拨出，决定接听或未接。')+'记录：'+JSON.stringify(turns)+'\n输出 {"status":"answered 或 no_answer","text":"对方回复"}。',d=>{if(!['answered','no_answer'].includes(d.status)||d.status==='answered'&&!text(d.text))throw new Error('通话回复格式不正确。');return d;});
            if(data.status==='answered')turns.push({role:'assistant',text:text(data.text)});
            await commit([setSnap({...(old||newRecord('call',{})),accountId:id,mode,status:data.status==='answered'?'connected':'no_answer',turns})]);
        });},
        hangup(id){return run(async(state,_c,_r,commit)=>{const call=state.snapchat[id];if(call?.type==='call')await commit([setSnap({...call,status:'ended'})]);});},
        publish(kind,value){return run(async(state,_c,_r,commit)=>{if(!['image','video'].includes(kind))throw new Error('故事请选择照片或视频。');await commit([setSnap(newRecord('story',{author:'user',name:profile(state).alias,kind,text:required(value,'故事内容'),comments:[],liked:false}))]);});},
        refresh(tab){return run(async(state,current,request,commit)=>{
            if(!['stories','spotlight','map'].includes(tab))throw new Error('页面不可刷新。');
            const friends=snapItems(state,'account').filter(a=>a.friend==='friends'&&!a.blocked).map(({id,name,handle})=>({id,name,handle}));
            const spec=tab==='stories'?'只为给定好友生成已发布的照片/视频故事。每项 {accountId,kind:"image/video",text}。':tab==='spotlight'?'生成陌生人/创作者公开短视频。每项 {name,text}，text 是视频画面、声音与字幕的文字描述。':'生成好友明确共享的位置或世界各地公开动态。每项 {accountId:null 或给定好友ID,name,place,text,shared:true}；不得泄漏不分享位置的好友。';
            const items=await ask(state,null,request,current,'当前任务：Snapchat '+tab+' 刷新。'+spec+'好友列表：'+JSON.stringify(friends)+'\n输出 {"items": [...]}，最多 5 条，不替 user 发布内容。',d=>{if(!Array.isArray(d.items)||d.items.length>5)throw new Error('动态内容格式不正确。');return d.items;});
            const changes=[];
            for(const item of items){const a=friends.find(a=>a.id===item.accountId);if(tab==='stories'&&!a)continue;if(tab==='map'&&(item.shared!==true||item.accountId&&!a))continue;
                const body=text(item.text);if(!body)continue;
                changes.push(setSnap(newRecord(tab==='stories'?'story':tab==='spotlight'?'clip':'location',{author:a?.id||'public',name:a?.name||text(item.name,100)||'创作者',kind:item.kind==='image'?'image':'video',text:body,place:text(item.place,200),comments:[],liked:false})));
            }
            await commit(changes);
        });},
        like(id){return run(async(state,_c,_r,commit)=>{const item=state.snapchat[id];if(!['story','clip'].includes(item?.type))throw new Error('动态不存在。');await commit([setSnap({...item,liked:!item.liked})]);});},
        comment(id,value){return run(async(state,current,request,commit)=>{const item=state.snapchat[id];if(!['story','clip'].includes(item?.type))throw new Error('动态不存在。');const content=required(value,'评论');const a=state.snapchat[item.author];
            if(a?.blocked)throw new Error('此账号已拉黑。');
            const reply=item.author==='user'?{text:''}:await ask(state,a?.type==='account'?a:null,request,current,'当前任务：Snapchat 动态评论。动态：'+JSON.stringify({name:item.name,text:item.text})+'；user 网名 '+JSON.stringify(profile(state).alias)+' 评论：'+JSON.stringify(content)+'。仅生成作者的简短回复或不回复，输出 {"text":"回复或空字符串"}。',d=>({text:text(d.text,1000)}));
            const comments=[...(item.comments||[]),{name:profile(state).alias,text:content},...(reply.text?[{name:item.name,text:reply.text}]:[])];await commit([setSnap({...item,comments})]);
        });},
        transfer(id,amount,currency,memo){return run(async(state,_c,_r,commit)=>{friendBy(state,id);const t=newRecord('transfer',{accountId:id,direction:'outgoing',status:'pending',amountMinor:snapAmount(amount),currency:currencyOf(currency),memo:text(memo,300)});await commit([setSnap(t)]);return t.id;});},
        settle(id,accept=true){return run(async(state,current,request,commit)=>{
            const t=state.snapchat[id];if(t?.type!=='transfer'||t.status!=='pending')throw new Error('这笔转账已处理。');const a=friendBy(state,t.accountId);
            let status=accept?'accepted':'declined';
            if(t.direction==='outgoing'&&accept){const data=await ask(state,a,request,current,'当前任务：Snapcash 收款判断。user 转账 '+JSON.stringify({amount:t.amountMinor/100,currency:t.currency,memo:t.memo})+'。决定是否收下，输出 {"status":"accepted 或 declined 或 pending"}。',d=>{if(!['accepted','declined','pending'].includes(d.status))throw new Error('收款结果格式不正确。');return d;});status=data.status;}
            const updated={...t,status};await commit([setSnap(updated),...(status==='accepted'?[ledger(updated)]:[])]);
        });},
    };
}
