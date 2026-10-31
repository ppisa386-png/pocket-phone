import { CHAT_APPS, chatItems } from './chat-apps.js?v=1.1.2';
import { displayStoryTime } from './story-clock.js?v=1.1.2';
import { icon } from './icons.js?v=1.1.2';

const chatEsc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const chatKinds={text:'文字',voice:'语音',image:'照片',video:'视频'};
const chatCallLabels={connected:'通话中',ended:'已结束',no_answer:'未接听'};

export function createChatPanel({app,adapter,getView,redraw,notice}) {
    const label=CHAT_APPS[app],wc=app==='wechat';
    let tab='chats',accountId=null,page='',editingId=null,status='',epoch=0,posting=false,reading=false;
    let drafts=Object.create(null);
    const records=type=>chatItems(getView(),app,type);
    const account=()=>getView()[app]?.[accountId];
    const profile=()=>getView()[app]?.profile||{alias:adapter.userName?.()||'user',currency:'USD'};
    const key=name=>[tab,accountId||'',page,name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>getView().busy||posting?' disabled':'';
    const avatar=name=>'<span class="pp-chat-avatar" aria-hidden="true">'+chatEsc(Array.from(name||'?')[0])+'</span>';
    const button=(action,title,id='',glyph='',extra='')=>'<button type="button" class="pp-chat-button '+(glyph?'is-icon':'')+'" data-chat-action="'+action+'" data-chat-id="'+chatEsc(id)+'" aria-label="'+chatEsc(title)+'" title="'+chatEsc(title)+'"'+extra+'>'+ (glyph?icon(glyph):chatEsc(title))+'</button>';
    const field=(name,title,fallback='',type='text')=>'<label class="pp-chat-field"><span>'+title+'</span><input data-chat-field="'+name+'" name="'+name+'" type="'+type+'" value="'+chatEsc(value(name,fallback))+'" maxlength="100"'+(type==='number'?' min="0.01" step="0.01"':'')+'></label>';
    const textarea=(name,title)=>'<textarea name="'+name+'" data-chat-field="'+name+'" aria-label="'+title+'" placeholder="'+title+'" rows="2" maxlength="6000" enterkeyhint="enter">'+chatEsc(value(name))+'</textarea>';
    const form=(name,body,title)=>'<form class="pp-chat-form" data-chat-form="'+name+'">'+body+'<button class="pp-chat-primary" type="submit"'+disabled()+'>'+title+'</button></form>';
    const empty=(title,copy)=>'<div class="pp-chat-empty">'+icon('messages')+'<strong>'+title+'</strong><p>'+copy+'</p></div>';
    const threadItems=id=>Object.values(getView()[app]||{}).filter(i=>i.accountId===id&&['message','call','transfer'].includes(i.type)).sort((a,b)=>a.createdAt-b.createdAt);
    const preview=i=>!i?'点击开始聊天':i.type==='call'?'['+chatKinds[i.mode]+'通话] '+(chatCallLabels[i.status]||''):i.type==='transfer'?'[转账] '+i.currency+' '+(i.amountMinor/100).toFixed(2):(i.status==='queued'?'[未发送] ':'')+(i.kind!=='text'?'['+chatKinds[i.kind]+'] ':'')+i.text;
    function row(a,contacts=false) {
        const latest=threadItems(a.id).at(-1),unread=records('message').filter(m=>m.accountId===a.id&&m.role==='assistant'&&!m.read).length;
        return '<button type="button" class="pp-chat-row" data-chat-action="thread" data-chat-id="'+chatEsc(a.id)+'">'+avatar(a.name)+'<span class="pp-chat-row-copy"><strong>'+chatEsc(a.name)+'</strong><span>'+chatEsc(a.blocked?'已拉黑':contacts?(a.number||'好友'):preview(latest))+'</span></span><span class="pp-chat-row-meta"><time>'+chatEsc(latest?displayStoryTime(latest):'')+'</time>'+(unread?'<b class="pp-chat-badge">'+(unread>99?'99+':unread)+'</b>':'')+'</span></button>';
    }
    function listHTML() {
        const q=value('filter').trim().toLocaleLowerCase();
        let friends=records('account').filter(a=>a.friend==='friends'&&(!q||[a.name,...(a.aliases||[]),a.number].some(n=>String(n||'').toLocaleLowerCase().includes(q))));
        friends.sort(tab==='contacts'?(a,b)=>a.name.localeCompare(b.name,'zh'):(a,b)=>(threadItems(b.id).at(-1)?.createdAt||0)-(threadItems(a.id).at(-1)?.createdAt||0));
        const search='<label class="pp-chat-search">'+icon('search')+'<input data-chat-field="filter" aria-label="搜索好友" placeholder="搜索" value="'+chatEsc(value('filter'))+'"></label>';
        const actions='<div class="pp-chat-add-actions">'+button('add','添加好友','','plus')+button('bulk','一键添加好友','','people',disabled())+'<span>添加好友 · 一键添加</span></div>';
        return search+actions+(friends.length?friends.map(a=>row(a,tab==='contacts')).join(''):empty(q?'没有找到好友':'与朋友开始聊天',q?'试试其他姓名。':'点击上方 + 按姓名添加，或一键添加已有好友。'));
    }
    function callsHTML() {
        const calls=records('call').slice().reverse();
        return '<div class="pp-chat-add-actions">'+button('contacts','发起通话','','phone')+'<span>选择好友，语音或视频通话</span></div>'+(calls.length?calls.map(c=>{const a=getView()[app]?.[c.accountId];return a?'<button type="button" class="pp-chat-row" data-chat-action="thread" data-chat-id="'+chatEsc(a.id)+'">'+avatar(a.name)+'<span class="pp-chat-row-copy"><strong>'+chatEsc(a.name)+'</strong><span>'+chatKinds[c.mode]+' · '+chatCallLabels[c.status]+'</span></span>'+icon(c.mode==='video'?'video':'phone')+'</button>':'';}).join(''):empty('暂无通话','打开好友聊天，点击顶部的电话或视频图标。'));
    }
    function transferHTML(t,blocked) {
        return '<article class="pp-chat-transfer '+(t.direction==='outgoing'?'is-user':'')+'">'+icon('cash')+'<strong>'+chatEsc(t.currency)+' '+(t.amountMinor/100).toFixed(2)+'</strong><p>'+chatEsc(t.memo||'转账')+'</p><small>'+({pending:'待收款',accepted:'已收款',declined:'已退还／取消'})[t.status]+'</small>'+(t.status==='pending'?'<div>'+(!blocked?button('settle',t.direction==='incoming'?'收款':'查看收款回应',t.id,'',disabled()):'')+button('cancel','退还／取消',t.id,'',disabled())+'</div>':'')+'</article>';
    }
    function threadHTML(a) {
        const items=threadItems(a.id);
        return items.map(i=>{
            if(i.type==='transfer')return transferHTML(i,a.blocked);
            if(i.type==='call')return '<article class="pp-chat-call">'+icon(i.mode==='video'?'video':'phone')+'<strong>'+chatKinds[i.mode]+'通话 · '+chatCallLabels[i.status]+'</strong>'+i.turns.map(t=>'<p><b>'+chatEsc(t.role==='user'?'你':a.name)+'：</b>'+chatEsc(t.text)+'</p>').join('')+'</article>';
            const own=i.role==='user';
            const tools=own?'':'<div class="pp-chat-message-tools">'+button('edit','修改消息',i.id,'edit',disabled())+button('reroll','重新生成消息',i.id,'retry',disabled())+'</div>';
            const editing=editingId===i.id?form('edit',textarea('editText','修改消息'),'保存')+button('cancel-edit','取消修改'):'';
            const stateText={queued:'未发送',pending:'等待回复',failed:'发送失败',no_reply:'对方暂未回复'}[i.status]||'';
            return '<article class="pp-chat-message '+(own?'is-user':'')+'">'+(wc?avatar(own?profile().alias:a.name):'')+'<div class="pp-chat-bubble">'+(i.kind!=='text'?'<small class="pp-chat-kind">'+icon(i.kind==='voice'?'voice':i.kind==='video'?'video':'image')+chatKinds[i.kind]+'</small>':'')+'<p>'+chatEsc(i.text)+'</p><div class="pp-chat-message-meta"><time>'+chatEsc(displayStoryTime(i))+'</time>'+(stateText?'<span>'+stateText+'</span>':'')+(!wc&&own&&i.status==='answered'?'<span class="pp-chat-checks" aria-label="已回复">✓✓</span>':'')+'</div>'+tools+editing+(['failed','pending'].includes(i.status)?button('retry','重试回复',i.id,'',disabled()):'')+'</div></article>';
        }).join('')||'<p class="pp-chat-thread-start">'+chatEsc(a.name)+'</p>';
    }
    function composerHTML(a) {
        if(a.blocked)return '<div class="pp-chat-composer"><p>已拉黑，不能发送消息或通话。</p>'+button('unblock','解除拉黑',a.id,'',disabled())+'</div>';
        const call=threadItems(a.id).find(i=>i.type==='call'&&i.status==='connected');
        if(call)return '<div class="pp-chat-composer">'+form('call',textarea('call','通话内容'),'说话')+button('hangup','挂断',call.id,'',disabled())+'</div>';
        return '<div class="pp-chat-composer">'+form('message','<div class="pp-chat-compose-input"><select name="kind" data-chat-field="kind" aria-label="消息类型">'+Object.entries(chatKinds).map(([id,title])=>'<option value="'+id+'"'+(value('kind','text')===id?' selected':'')+'>'+title+'</option>').join('')+'</select>'+textarea('message','发送消息')+'</div>','发送')+'<div class="pp-chat-compose-extra">'+button('cash','转账',a.id,'cash',disabled())+'<small>换行暂存 · 点击发送</small></div></div>';
    }
    function html() {
        if(accountId&&!account()){accountId=null;page='';editingId=null;}
        const a=account(),p=profile(),thread=!!a&&!page;
        const title=a?a.name:page==='add'?'添加好友':tab==='contacts'?'通讯录':tab==='calls'?'通话':tab==='me'?(wc?'我':'设置'):(wc?'微信':'WhatsApp');
        let body='';
        if(page==='add')body='<div class="pp-chat-settings">'+form('add',field('name','好友姓名'),'搜索并添加')+button('bulk','一键添加好友','','',disabled())+'</div>';
        else if(a&&page==='info')body='<div class="pp-chat-settings"><div class="pp-chat-profile">'+avatar(a.name)+'<h2>'+chatEsc(a.name)+'</h2>'+(a.number?'<p>'+chatEsc(a.number)+'</p>':'')+'</div>'+(!a.identityKnown?button('reveal','自我介绍',a.id,'',disabled()):'')+button(a.blocked?'unblock':'block',a.blocked?'解除拉黑':'加入黑名单',a.id,'',disabled())+'</div>';
        else if(a&&page==='cash')body='<div class="pp-chat-settings">'+form('cash',field('amount','转账金额（USD）','','number')+field('memo','附言'),'确认转账')+'</div>';
        else if(a)body=threadHTML(a);
        else if(tab==='me')body='<div class="pp-chat-settings"><div class="pp-chat-profile">'+avatar(p.alias)+'<h2>'+chatEsc(p.alias)+'</h2><span>'+label+'</span></div>'+form('profile',field('alias','昵称',p.alias),'保存个人设置')+'</div>';
        else body=tab==='calls'?callsHTML():listHTML();
        const message=getView().busy?'正在处理…':getView().errorKind===app&&getView().error?getView().error:status;
        const tabs=[['chats',wc?'微信':'聊天','messages'],['contacts','通讯录','people'],['calls','通话','phone'],['me',wc?'我':'设置',wc?'person':'settings']];
        return '<section class="pp-chat-app pp-'+app+(thread?' is-thread':'')+'"><header class="pp-chat-top">'+(a||page?button('back','返回','','back'):'')+(!wc&&a?avatar(a.name):'')+'<h2>'+chatEsc(title)+'</h2><div>'+(thread?button('voice','语音通话',a.id,'phone',disabled())+button('video','视频通话',a.id,'video',disabled())+button('info','聊天信息',a.id,'more'):!a&&!page?button('add','添加好友','','plus'):'')+'</div></header>'+(message?'<p class="pp-chat-status" role="status">'+chatEsc(message)+'</p>':'')+'<div class="pp-chat-scroll" data-chat-page="'+chatEsc([app,tab,accountId||'',page].join(':'))+'" data-chat-count="'+(a?threadItems(a.id).length:0)+'">'+body+'</div>'+(thread?composerHTML(a):'')+(!a&&!page?'<nav class="pp-chat-tabs" aria-label="'+label+' 页面">'+tabs.map(([id,text,glyph])=>'<button type="button" data-chat-action="tab" data-chat-id="'+id+'" aria-pressed="'+(tab===id)+'">'+icon(glyph)+'<span>'+text+'</span></button>').join('')+'</nav>':'')+'</section>';
    }
    async function perform(method,args=[],message='') {
        if(!adapter[app]){notice('请在酒馆内使用'+label+'。');return null;}
        if(posting||getView().busy)return null;
        const token=epoch;posting=true;redraw();
        try{const result=await adapter[app][method](...args);if(token!==epoch)return null;status=result?.ok?message:result?.error||'正在处理其他操作，请稍后重试。';return result;}
        catch(error){if(token===epoch)status=error.message;return null;}
        finally{if(token===epoch)posting=false;redraw();}
    }
    async function queueCurrent(){
        const token=epoch,id=accountId,draftKey=key('message'),text=value('message');
        if(!text.trim())return;
        const result=await perform('queueMessage',[id,value('kind','text'),text]);
        if(token===epoch&&result?.ok&&drafts[draftKey]===text)delete drafts[draftKey];redraw();return result;
    }
    function back(){
        if(editingId){editingId=null;redraw();return true;}
        if(page){page='';redraw();return true;}
        if(accountId){accountId=null;redraw();return true;}
        return false;
    }
    async function bulk(){const token=epoch,result=await perform('addEstablished');if(token===epoch&&result?.ok){status='已添加 '+result.value.added+' 位好友'+(result.value.updated?'，更新 '+result.value.updated+' 位':'')+'。';redraw();}}
    return {html,back,queueCurrent,
        reset(){epoch++;posting=false;reading=false;tab='chats';accountId=null;page='';editingId=null;status='';drafts=Object.create(null);},
        input(target){const name=target.dataset.chatField;if(name){const changed=value(name)!==target.value;drafts[key(name)]=target.value;if(name==='filter'&&changed)redraw();}},
        async readVisible(){if(reading||posting||getView().busy||page||!accountId||!adapter[app]||!records('message').some(m=>m.accountId===accountId&&m.role==='assistant'&&!m.read))return;const token=epoch;reading=true;try{await adapter[app].markRead(accountId);}finally{if(token===epoch)reading=false;}},
        async action(action,id){
            if(action==='back'){back();return;}
            if(action==='tab'||action==='contacts'){tab=action==='contacts'?'contacts':id;accountId=null;page='';editingId=null;status='';redraw();return;}
            if(action==='thread'){accountId=id;page='';editingId=null;status='';redraw();return;}
            if(['add','info','cash'].includes(action)){page=action;editingId=null;redraw();return;}
            if(action==='edit'){editingId=id;drafts[key('editText')]=getView()[app]?.[id]?.text||'';redraw();return;}
            if(action==='cancel-edit'){editingId=null;redraw();return;}
            if(action==='bulk'){await bulk();return;}
            const handlers={reroll:['rerollMessage',[id]],retry:['retryMessage',[id]],block:['block',[id,true]],unblock:['block',[id,false]],reveal:['reveal',[id]],voice:['call',[id,'voice']],video:['call',[id,'video']],hangup:['hangup',[id]],settle:['settle',[id,true]],cancel:['settle',[id,false]]};
            if(handlers[action])await perform(...handlers[action]);
        },
        async submit(element){
            const data=Object.fromEntries(new FormData(element)),name=element.dataset.chatForm,token=epoch,id=accountId,prefix=key('');
            if(name==='add'){const result=await perform('addByName',[data.name]);if(token===epoch&&result?.ok){status=result.value.added?'已添加 '+result.value.added+' 位好友。':result.value.updated?'好友资料已更新。':'没有新增好友，请核对姓名和联系方式。';redraw();}return;}
            if(name==='profile'){await perform('saveProfile',[{...profile(),alias:data.alias}],'已保存个人设置');return;}
            if(name==='edit'){const result=await perform('editMessage',[editingId,data.editText]);if(token===epoch&&result?.ok)editingId=null;redraw();return;}
            if(name==='message'){
                const text=value('message');
                if(text.trim()){const queued=await perform('queueMessage',[id,value('kind','text'),text]);if(token!==epoch||!queued?.ok)return;if(drafts[prefix+'message']===text)delete drafts[prefix+'message'];}
                await perform('flushMessages',[id]);redraw();return;
            }
            if(name==='call'){const call=threadItems(id).find(i=>i.type==='call'&&i.status==='connected');if(call){const result=await perform('call',[id,call.mode,data.call,call.id]);if(token===epoch&&result?.ok)delete drafts[prefix+'call'];}redraw();return;}
            if(name==='cash'){const result=await perform('transfer',[id,data.amount,'USD',data.memo]);if(token===epoch&&result?.ok){delete drafts[prefix+'amount'];delete drafts[prefix+'memo'];page='';await perform('settle',[result.value,true]);}redraw();}
        },
    };
}
