import { snapItems, snapProfile, snapExpired } from './snapchat.js?v=0.14.2';

const snapEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const snapKind = {text:'文字',voice:'语音',image:'照片',video:'视频'};
const snapMoney = item => item.currency + ' ' + (item.amountMinor / 100).toFixed(2);
const snapTime = item => new Date(item.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

export function createSnapPanel({adapter,getView,redraw,notice}) {
    let tab='chat', accountId=null, page='', drafts=Object.create(null), status='', reading=false, posting=false;
    const profile=()=>snapProfile(getView(),adapter.userName?.()||'user');
    const key=name=>[tab,accountId||'',page,name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>getView().busy||posting?' disabled':'';
    const button=(action,label,id='',extra='')=>'<button type="button" class="pp-snap-button" data-snap-action="'+action+'" data-snap-id="'+snapEsc(id)+'" '+extra+disabled()+'>'+snapEsc(label)+'</button>';
    const field=(name,label,fallback='',type='text')=>'<label class="pp-field"><span>'+label+'</span><input data-snap-field="'+name+'" name="'+name+'" type="'+type+'" value="'+snapEsc(value(name,fallback))+'" '+(type==='number'?'min="0.01" step="0.01"':'maxlength="200"')+'></label>';
    const textarea=(name,label)=>'<label class="pp-field"><span>'+label+'</span><textarea data-snap-field="'+name+'" name="'+name+'" rows="3" maxlength="6000">'+snapEsc(value(name))+'</textarea></label>';
    const select=(name,options,fallback)=>'<select name="'+name+'" data-snap-field="'+name+'" aria-label="内容类型">'+options.map(k=>'<option value="'+k+'"'+(value(name,fallback)===k?' selected':'')+'>'+snapKind[k]+'</option>').join('')+'</select>';
    const form=(name,body,label)=>'<form class="pp-snap-form" data-snap-form="'+name+'">'+body+'<button class="pp-snap-primary" type="submit"'+disabled()+'>'+label+'</button></form>';
    const empty=text=>'<p class="pp-snap-empty">'+text+'</p>';
    function accountsHTML(state) {
        const accounts=snapItems(state,'account');
        return form('search',field('query','姓名或账号（可留空）'),'新增联系人')+accounts.map(a=>{
            const unread=snapItems(state,'message').filter(m=>m.accountId===a.id&&m.role==='assistant'&&!m.read).length;
            const label=a.blocked?'已拉黑':({none:'尚未添加',incoming:'邀请你成为好友',pending:'等待通过',declined:'邀请未通过',friends:'好友'})[a.friend];
            return '<article class="pp-snap-card"><div class="pp-snap-person"><span class="pp-snap-avatar">'+snapEsc(a.name.slice(0,1))+'</span><div><strong>'+snapEsc(a.name)+'</strong><small>@'+snapEsc(a.handle)+' · '+label+(unread?' · '+unread+' 条未读':'')+'</small></div></div><div class="pp-snap-actions">'+
                (a.blocked?button('unblock','解除拉黑',a.id):a.friend==='friends'?button('thread','聊天',a.id):a.friend==='incoming'?button('accept','接受邀请',a.id)+button('decline','拒绝',a.id):button('invite',a.friend==='pending'?'查看邀请回应':'添加好友',a.id))+(!a.blocked?button('block','拉黑',a.id):'')+'</div></article>';
        }).join('')+(accounts.length?'':empty('还没有 Snapchat 联系人。点「新增联系人」查找账号。'));
    }
    function transferHTML(t) {
        return '<article class="pp-snap-cash"><strong>Snapcash · '+(t.direction==='incoming'?'对方转来':'你转出')+'</strong><b>'+snapMoney(t)+'</b><p>'+snapEsc(t.memo)+'</p><small>'+({pending:'待收款',accepted:'已收款',declined:'已拒收／取消'})[t.status]+'</small><div class="pp-snap-actions">'+(t.status==='pending'?button('settle',t.direction==='incoming'?'收款':'查看收款回应',t.id)+button('cancel',t.direction==='incoming'?'拒收':'取消转账',t.id):'')+'</div></article>';
    }
    function threadHTML(state,a) {
        const items=Object.values(state.snapchat||{}).filter(i=>i.accountId===a.id&&['message','call','transfer'].includes(i.type)).sort((a,b)=>a.createdAt-b.createdAt);
        const active=items.find(i=>i.type==='call'&&i.status==='connected');
        const chat=items.map(i=>{
            if(i.type==='transfer')return transferHTML(i);
            if(i.type==='call')return '<article class="pp-snap-card"><strong>'+snapKind[i.mode]+'通话 · '+({connected:'通话中',ended:'已结束',no_answer:'未接听'})[i.status]+'</strong>'+i.turns.map(t=>'<p class="pp-snap-copy"><b>'+(t.role==='user'?'你':snapEsc(a.name))+'：</b>'+snapEsc(t.text)+'</p>').join('')+'</article>';
            return '<article class="pp-snap-message '+(i.role==='user'?'is-user':'')+'"><small>'+(i.role==='user'?'你':snapEsc(a.name))+' · '+snapKind[i.kind]+' · '+snapTime(i)+'</small><p class="pp-snap-copy">'+snapEsc(i.text)+'</p>'+(['failed','pending'].includes(i.status)?button('retry','重试回复',i.id):i.status==='no_reply'?'<small>对方暂未回复</small>':'')+'</article>';
        }).join('');
        return button('list','‹ 聊天列表')+'<div class="pp-snap-person"><span class="pp-snap-avatar">'+snapEsc(a.name.slice(0,1))+'</span><div><strong>'+snapEsc(a.name)+'</strong><small>@'+snapEsc(a.handle)+'</small></div></div><div class="pp-snap-actions">'+(!a.blocked?button('voice','语音通话',a.id)+button('video','视频通话',a.id)+button('cash','转账',a.id)+(a.identityKnown?'':button('reveal','自我介绍',a.id))+button('block','拉黑',a.id):button('unblock','解除拉黑',a.id))+'</div><div class="pp-snap-thread">'+chat+'</div>'+
            (a.blocked?empty('已拉黑，不能发送消息或通话。'):page==='cash'?form('cash',field('amount','金额','','number')+field('currency','币种',profile().currency)+field('memo','附言'),'发送转账')+button('thread','返回聊天',a.id):active?form('call',textarea('call','通话内容'),'说话')+button('hangup','挂断',active.id):form('message',select('kind',['text','voice','image','video'],'text')+textarea('message','消息内容'),'发送'));
    }
    function postHTML(item) {
        return '<article class="pp-snap-card '+(item.type==='clip'?'pp-snap-clip':'')+'"><header><strong>'+snapEsc(item.name)+'</strong><small>'+snapKind[item.kind]+(item.type==='story'?' · <span data-snap-expiry="'+item.createdAt+'">'+(snapExpired(item)?'已过期':'24 小时内')+'</span>':'')+'</small></header><div class="pp-snap-media"><span aria-hidden="true">'+(item.kind==='video'?'▷':'▧')+'</span><p class="pp-snap-copy">'+snapEsc(item.text)+'</p></div><div class="pp-snap-actions">'+button('like',item.liked?'♥ 已赞':'♡ 点赞',item.id)+button('comment','评论',item.id)+'</div>'+(item.comments||[]).map(c=>'<p class="pp-snap-copy"><b>'+snapEsc(c.name)+'：</b>'+snapEsc(c.text)+'</p>').join('')+(page==='comment:'+item.id?form('comment',textarea('comment','评论内容'),'发送评论'):'')+'</article>';
    }
    function feedsHTML(state) {
        if(tab==='stories')return form('story',select('storyKind',['image','video'],'image')+textarea('story','故事内容'),'发布故事')+button('refresh','刷新好友故事')+snapItems(state,'story').slice().reverse().filter(i=>i.author==='user'||!state.snapchat[i.author]?.blocked).map(postHTML).join('');
        if(tab==='spotlight')return button('refresh','加载短视频')+'<div class="pp-snap-clips">'+snapItems(state,'clip').slice().reverse().map(postHTML).join('')+'</div>'+empty('上下滑动浏览更多视频。');
        const p=profile();const locations=snapItems(state,'location').filter(i=>!state.snapchat[i.author]?.blocked).slice().reverse();
        return button('refresh','刷新共享位置与动态')+'<div class="pp-snap-map"><strong>Snap Map</strong><p>朋友分享的位置 · 世界动态</p><div class="pp-snap-pins">'+(p.sharing&&p.location?'<span>⌖ 你 · '+snapEsc(p.location)+'</span>':'')+locations.slice(0,6).map(i=>'<span>⌖ '+snapEsc(i.name)+' · '+snapEsc(i.place)+'</span>').join('')+'</div></div>'+(!p.sharing?empty('你的位置未共享，可在「我的账号」开启。'):'')+locations.map(i=>'<article class="pp-snap-card"><strong>'+snapEsc(i.name)+' · '+snapEsc(i.place)+'</strong><small>'+snapTime(i)+'</small><p class="pp-snap-copy">'+snapEsc(i.text)+'</p></article>').join('');
    }
    function html() {
        const state=getView();if(accountId&&!state.snapchat?.[accountId]){accountId=null;page='';}
        const a=state.snapchat?.[accountId];const p=profile();
        let body=page==='profile'?button('list','‹ 返回')+form('profile',field('alias','网名',p.alias)+field('currency','默认币种',p.currency)+field('location','我分享的位置',p.location)+'<label class="pp-snap-check"><input name="sharing" data-snap-field="sharing" type="checkbox"'+(value('sharing',p.sharing)?' checked':'')+'>向好友共享此位置</label>','保存个人设置'):tab==='chat'?(a?threadHTML(state,a):accountsHTML(state)):feedsHTML(state);
        return '<div class="pp-snap"><header class="pp-snap-top"><b>Snapchat</b>'+button('profile','我的账号')+'</header><p class="pp-snap-status" role="status">'+snapEsc(state.busy?'正在处理…':state.errorKind==='snapchat'&&state.error?state.error:status)+'</p>'+body+'<nav class="pp-snap-tabs" aria-label="Snapchat 页面">'+[['chat','聊天'],['stories','故事'],['spotlight','聚光灯'],['map','地图']].map(([id,label])=>'<button type="button" data-snap-action="tab" data-snap-id="'+id+'" aria-pressed="'+(tab===id)+'">'+label+'</button>').join('')+'</nav></div>';
    }
    async function perform(method,args=[],message='') {
        if(!adapter.snapchat){notice('请在酒馆内使用 Snapchat。');return null;}
        if(posting||getView().busy)return null;
        posting=true;redraw();
        try {const result=await adapter.snapchat[method](...args);if(result?.ok){status=message;return result;}status=result?.error||'正在处理其他操作，请稍后重试。';return result;}
        catch(error){status=error.message;return null;}
        finally{posting=false;redraw();}
    }
    return {
        html,
        reset(){tab='chat';accountId=null;page='';drafts=Object.create(null);status='';},
        input(target){if(target.dataset.snapField)drafts[key(target.dataset.snapField)]=target.type==='checkbox'?target.checked:target.value;},
        async readVisible(){if(reading||posting||getView().busy||!accountId||page==='profile'||!adapter.snapchat)return;if(!snapItems(getView(),'message').some(m=>m.accountId===accountId&&m.role==='assistant'&&!m.read))return;reading=true;try{await adapter.snapchat.markRead(accountId);}finally{reading=false;}},
        async action(action,id) {
            if(action==='tab'){tab=id;accountId=null;page='';status='';redraw();return;}
            if(action==='profile'){page='profile';redraw();return;}
            if(action==='list'){accountId=null;page='';redraw();return;}
            if(action==='thread'){accountId=id;page='';redraw();return;}
            if(action==='cash'){page='cash';redraw();return;}
            if(action==='comment'){page='comment:'+id;redraw();return;}
            const handlers={invite:['invite',[id]],accept:['accept',[id,true]],decline:['accept',[id,false]],block:['block',[id,true]],unblock:['block',[id,false]],reveal:['reveal',[id]],voice:['call',[id,'voice']],video:['call',[id,'video']],hangup:['hangup',[id]],retry:['retryMessage',[id]],refresh:['refresh',[tab]],like:['like',[id]],settle:['settle',[id,true]],cancel:['settle',[id,false]]};
            if(handlers[action])await perform(...handlers[action]);
        },
        async submit(formElement) {
            const data=Object.fromEntries(new FormData(formElement));const formName=formElement.dataset.snapForm;
            const initialKey=key('');const draftKey=name=>initialKey+name;let result;
            if(formName==='search'){result=await perform('discover',[data.query]);if(result?.ok)status='搜索完成，新增 '+result.value.added+' 个账号。';}
            if(formName==='profile')result=await perform('saveProfile',[{...data,sharing:data.sharing==='on'}],'已保存个人设置');
            if(formName==='message'){
                const before=new Set(snapItems(getView(),'message').map(m=>m.id));
                result=await perform('send',[accountId,data.kind,data.message]);
                // Sent-but-failed messages have a retry button; do not send them twice.
                if(result?.ok||snapItems(getView(),'message').some(m=>!before.has(m.id)&&m.role==='user'))delete drafts[draftKey('message')];
            }
            if(formName==='story'){result=await perform('publish',[data.storyKind,data.story],'故事已发布');if(result?.ok)delete drafts[draftKey('story')];}
            if(formName==='comment'){result=await perform('comment',[page.slice(8),data.comment]);if(result?.ok){delete drafts[draftKey('comment')];page='';}}
            if(formName==='call'){const active=snapItems(getView(),'call').find(c=>c.accountId===accountId&&c.status==='connected');if(active){result=await perform('call',[accountId,active.mode,data.call,active.id]);if(result?.ok)delete drafts[draftKey('call')];}}
            if(formName==='cash'){
                result=await perform('transfer',[accountId,data.amount,data.currency,data.memo]);
                if(result?.ok){for(const name of ['amount','memo'])delete drafts[draftKey(name)];page='';await perform('settle',[result.value,true]);}
            }
            redraw();
        },
    };
}
