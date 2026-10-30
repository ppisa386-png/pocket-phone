import { displayStoryTime } from './story-clock.js?v=1.0.9';
import { icon } from './icons.js?v=1.0.9';
import { snapItems, snapProfile, snapExpired, snapStoryRefreshState } from './snapchat.js?v=1.0.9';

const snapEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const snapKind = {text:'文字',voice:'语音',image:'照片',video:'视频'};
const snapMoney = item => item.currency + ' ' + (item.amountMinor / 100).toFixed(2);
const snapTime = item => displayStoryTime(item);

export function createSnapPanel({adapter,getView,redraw,notice}) {
    let editingId=null;
    const selectedAccounts=new Set();
    let tab='chat', accountId=null, page='', drafts=Object.create(null), status='', reading=false, posting=false, epoch=0;
    const profile=()=>snapProfile(getView(),adapter.userName?.()||'user');
    const key=name=>[tab,accountId||'',page,name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>getView().busy||posting?' disabled':'';
    const actionIcons={profile:'person',voice:'phone',video:'video',cash:'cash'};
    const button=(action,label,id='',extra='')=>'<button type="button" class="pp-snap-button" data-snap-action="'+action+'" data-snap-id="'+snapEsc(id)+'" aria-label="'+snapEsc(label)+'" title="'+snapEsc(label)+'" '+extra+disabled()+'>'+(actionIcons[action]?icon(actionIcons[action]):snapEsc(label))+'</button>';
    const messageTools=i=>'<div class="pp-message-tools"><button type="button" class="pp-icon-button" data-snap-action="edit-message" data-snap-id="'+snapEsc(i.id)+'" aria-label="修改消息"'+disabled()+'>'+icon('edit')+'</button><button type="button" class="pp-icon-button" data-snap-action="reroll-message" data-snap-id="'+snapEsc(i.id)+'" aria-label="重新生成消息"'+disabled()+'>'+icon('retry')+'</button></div>';
    const field=(name,label,fallback='',type='text')=>'<label class="pp-field"><span>'+label+'</span><input data-snap-field="'+name+'" name="'+name+'" type="'+type+'" value="'+snapEsc(value(name,fallback))+'" '+(type==='number'?'min="0.01" step="0.01"':'maxlength="200"')+'></label>';
    const textarea=(name,label)=>'<label class="pp-field"><span>'+label+'</span><textarea data-snap-field="'+name+'" name="'+name+'" enterkeyhint="enter" rows="3" maxlength="6000">'+snapEsc(value(name))+'</textarea></label>';
    const select=(name,options,fallback)=>'<select name="'+name+'" data-snap-field="'+name+'" aria-label="内容类型">'+options.map(k=>'<option value="'+k+'"'+(value(name,fallback)===k?' selected':'')+'>'+snapKind[k]+'</option>').join('')+'</select>';
    const form=(name,body,label)=>'<form class="pp-snap-form" data-snap-form="'+name+'">'+body+'<div class="pp-compose-actions"><button class="pp-snap-primary" type="submit"'+disabled()+'>'+label+'</button></div></form>';
    const empty=text=>'<p class="pp-snap-empty">'+text+'</p>';
    function accountsHTML(state) {
        const accounts=snapItems(state,'account');
        for(const id of selectedAccounts){const a=state.snapchat?.[id];if(!a||a.blocked||['friends','incoming'].includes(a.friend))selectedAccounts.delete(id);}
        return form('search',field('query','姓名或账号（可留空）'),'新增联系人')+'<div class="pp-snap-actions">'+button('add-selected','添加（'+selectedAccounts.size+'）','',selectedAccounts.size?'':'disabled')+'</div>'+accounts.map(a=>{
            const unread=snapItems(state,'message').filter(m=>m.accountId===a.id&&m.role==='assistant'&&!m.read).length;
            const label=a.blocked?'已拉黑':({none:'尚未添加',incoming:'邀请你成为好友',pending:'等待通过',declined:'邀请未通过',friends:'好友'})[a.friend];
            return '<article class="pp-snap-card pp-snap-account"><div class="pp-snap-person"><span class="pp-snap-avatar">'+snapEsc(a.name.slice(0,1))+'</span><div><strong>'+snapEsc(a.name)+'</strong><small>@'+snapEsc(a.handle)+' · '+label+(unread?' · '+unread+' 条未读':'')+'</small></div></div><div class="pp-snap-actions">'+
                (a.blocked?button('thread','聊天记录',a.id)+button('unblock','解除拉黑',a.id):a.friend==='friends'?button('thread','聊天',a.id):a.friend==='incoming'?button('accept','接受邀请',a.id)+button('decline','拒绝',a.id):'<label class="pp-snap-check"><input type="checkbox" data-snap-select="'+snapEsc(a.id)+'" aria-label="选择 '+snapEsc(a.name)+'"'+(selectedAccounts.has(a.id)?' checked':'')+disabled()+'>选择添加</label>')+(!a.blocked?button('block','拉黑',a.id):'')+'</div></article>';
        }).join('')+(accounts.length?'':empty('还没有 Snapchat 联系人。点「新增联系人」查找账号。'));
    }
    function transferHTML(t,blocked) {
        return '<article class="pp-snap-cash"><strong>Snapcash · '+(t.direction==='incoming'?'对方转来':'你转出')+'</strong><b>'+snapMoney(t)+'</b><p>'+snapEsc(t.memo)+'</p><small>'+({pending:'待收款',accepted:'已收款',declined:'已拒收／取消'})[t.status]+'</small><div class="pp-snap-actions">'+(t.status==='pending'?(blocked?'':button('settle',t.direction==='incoming'?'收款':'查看收款回应',t.id))+button('cancel',t.direction==='incoming'?'拒收':'取消转账',t.id):'')+'</div></article>';
    }
    function threadHTML(state,a) {
        const items=Object.values(state.snapchat||{}).filter(i=>i.accountId===a.id&&['message','call','transfer'].includes(i.type)).sort((a,b)=>a.createdAt-b.createdAt);
        const active=items.find(i=>i.type==='call'&&i.status==='connected');
        const chat=items.map(i=>{
            if(i.type==='transfer')return transferHTML(i,a.blocked);
            if(i.type==='call')return '<article class="pp-snap-card"><strong>'+snapKind[i.mode]+'通话 · '+({connected:'通话中',ended:'已结束',no_answer:'未接听'})[i.status]+'</strong>'+i.turns.map(t=>'<p class="pp-snap-copy"><b>'+(t.role==='user'?'你':snapEsc(a.name))+'：</b>'+snapEsc(t.text)+'</p>').join('')+'</article>';
            return '<article class="pp-snap-message '+(i.role==='user'?'is-user':'')+'"><small>'+(i.role==='user'?'你':snapEsc(a.name))+' · '+snapKind[i.kind]+' · '+snapTime(i)+'</small><p class="pp-snap-copy">'+snapEsc(i.text)+'</p>'+(i.role==='assistant'?messageTools(i)+(editingId===i.id?form('edit-message',textarea('editText','修改消息'),'保存')+button('cancel-edit','取消'):''):'')+(i.status==='queued'?'<small>未发送</small>':'')+(['failed','pending'].includes(i.status)?button('retry','重试回复',i.id):i.status==='no_reply'?'<small>对方暂未回复</small>':'')+'</article>';
        }).join('');
        return button('list','‹ 聊天列表')+'<div class="pp-snap-person"><span class="pp-snap-avatar">'+snapEsc(a.name.slice(0,1))+'</span><div><strong>'+snapEsc(a.name)+'</strong><small>@'+snapEsc(a.handle)+'</small></div></div><div class="pp-snap-actions">'+(!a.blocked?button('voice','语音通话',a.id)+button('video','视频通话',a.id)+button('cash','转账',a.id)+(a.identityKnown?'':button('reveal','自我介绍',a.id))+button('block','拉黑',a.id):button('unblock','解除拉黑',a.id))+'</div><div class="pp-snap-thread">'+chat+'</div>'+
            (a.blocked?empty('已拉黑，不能发送消息或通话。'):page==='cash'?form('cash',field('amount','金额','','number')+'<input type="hidden" name="currency" value="USD"><p>美元 USD</p>'+field('memo','附言'),'发送转账')+button('thread','返回聊天',a.id):active?form('call',textarea('call','通话内容'),'说话')+button('hangup','挂断',active.id):form('message',select('kind',['text','voice','image','video'],'text')+textarea('message','消息内容'),'发送'));
    }
    function postHTML(item) {
        return '<article class="pp-snap-card '+(item.type==='clip'?'pp-snap-clip':'pp-snap-story')+'"><header><strong>'+snapEsc(item.name)+'</strong><small>'+snapKind[item.kind]+(item.type==='story'?' · <span data-snap-expiry="'+item.createdAt+'">'+(snapExpired(item)?'已过期':'24 小时内')+'</span>':'')+'</small></header><div class="pp-snap-media"><span aria-hidden="true">'+(item.kind==='video'?'▷':'▧')+'</span><p class="pp-snap-copy">'+snapEsc(item.text)+'</p></div><div class="pp-snap-actions">'+button('like',item.liked?'♥ 已赞':'♡ 点赞',item.id)+button('comment','评论',item.id)+'</div>'+(item.friendLikes?.length?'<p class="pp-snap-copy">♥ '+snapEsc(item.friendLikes.map(id=>getView().snapchat?.[id]?.name||'好友').join('、'))+' 赞了这条故事</p>':'')+(item.comments||[]).map(c=>'<p class="pp-snap-copy"><b>'+snapEsc(c.name)+'：</b>'+snapEsc(c.text)+'</p>').join('')+(page==='comment:'+item.id?form('comment',textarea('comment','评论内容'),'发送评论'):'')+'</article>';
    }
    function feedsHTML(state) {
        if(tab==='stories'){const refresh=snapStoryRefreshState(state);return form('story',select('storyKind',['image','video'],'image')+textarea('story','故事内容'),'发布故事')+button('refresh',refresh.refreshed?(refresh.allowed?'查看新故事互动':'本回合已刷新'):'刷新好友故事','',refresh.allowed?'':'disabled')+snapItems(state,'story').slice().reverse().filter(i=>i.author==='user'||!state.snapchat[i.author]?.blocked).map(postHTML).join('');}
        if(tab==='spotlight')return button('refresh','加载短视频')+'<div class="pp-snap-clips">'+snapItems(state,'clip').slice().reverse().map(postHTML).join('')+'</div>'+empty('上下滑动浏览更多视频。');
        const p=profile();const locations=snapItems(state,'location').filter(i=>!state.snapchat[i.author]?.blocked).slice().reverse();
        return button('refresh','刷新共享位置与动态')+'<div class="pp-snap-map"><strong>Snap Map</strong><p>朋友分享的位置 · 世界动态</p><div class="pp-snap-pins">'+(p.sharing&&p.location?'<span>⌖ 你 · '+snapEsc(p.location)+'</span>':'')+locations.slice(0,6).map(i=>'<span>⌖ '+snapEsc(i.name)+' · '+snapEsc(i.place)+'</span>').join('')+'</div></div>'+(!p.sharing?empty('你的位置未共享，可在「我的账号」开启。'):'')+locations.map(i=>'<article class="pp-snap-card"><strong>'+snapEsc(i.name)+' · '+snapEsc(i.place)+'</strong><small>'+snapTime(i)+'</small><p class="pp-snap-copy">'+snapEsc(i.text)+'</p></article>').join('');
    }
    function html() {
        const state=getView();if(accountId&&!state.snapchat?.[accountId]){accountId=null;page='';}
        const a=state.snapchat?.[accountId];const p=profile();
        let body=page==='profile'?button('list','‹ 返回')+form('profile',field('alias','网名',p.alias)+'<input type="hidden" name="currency" value="USD">'+field('location','我分享的位置',p.location)+'<label class="pp-snap-check"><input name="sharing" data-snap-field="sharing" type="checkbox"'+(value('sharing',p.sharing)?' checked':'')+'>向好友共享此位置</label>','保存个人设置'):tab==='chat'?(a?threadHTML(state,a):accountsHTML(state)):feedsHTML(state);
        return '<div class="pp-snap pp-snapchat" data-snap-tab="'+tab+'"><header class="pp-snap-top"><span class="pp-snap-brand">'+icon('snapchat')+'<b>'+({chat:'聊天',stories:'故事',spotlight:'聚光灯',map:'地图'})[tab]+'</b></span>'+button('profile','我的账号')+'</header><div class="pp-snap-body" data-snap-page="'+snapEsc([tab,accountId||'',page].join(':'))+'" data-snap-count="'+(a?snapItems(state,'message').filter(m=>m.accountId===a.id).length:0)+'"><p class="pp-snap-status" role="status">'+snapEsc(state.busy?'正在处理…':state.errorKind==='snapchat'&&state.error?state.error:status)+'</p>'+body+'</div><nav class="pp-snap-tabs" aria-label="Snapchat 页面">'+[['chat','聊天','messages'],['stories','故事','stories'],['spotlight','聚光灯','video'],['map','地图','map']].map(([id,label,glyph])=>'<button type="button" data-snap-action="tab" data-snap-id="'+id+'" aria-pressed="'+(tab===id)+'">'+icon(glyph)+'<span>'+label+'</span></button>').join('')+'</nav></div>';
    }
    async function perform(method,args=[],message='') {
        if(!adapter.snapchat){notice('请在酒馆内使用 Snapchat。');return null;}
        if(posting||getView().busy)return null;
        const token=epoch;posting=true;redraw();
        try {const result=await adapter.snapchat[method](...args);if(token!==epoch)return null;if(result?.ok){status=message;return result;}status=result?.error||'正在处理其他操作，请稍后重试。';return result;}
        catch(error){if(token===epoch)status=error.message;return null;}
        finally{if(token===epoch)posting=false;redraw();}
    }
    async function queueCurrent(){
        const token=epoch,selected=accountId,draftKey=key('message'),message=value('message'),kind=value('kind','text');
        if(!message.trim())return;
        const result=await perform('queueMessage',[selected,kind,message]);
        if(token===epoch&&result?.ok&&drafts[draftKey]===message)delete drafts[draftKey];
        redraw();return result;
    }
    async function sendCurrent(){
        const token=epoch,selected=accountId,draftKey=key('message'),message=value('message'),kind=value('kind','text');
        if(message.trim()) {const added=await perform('queueMessage',[selected,kind,message]);if(token!==epoch||!added?.ok)return;if(drafts[draftKey]===message)delete drafts[draftKey];}
        await perform('flushMessages',[selected]);redraw();
    }
    function back() {
        if(editingId){editingId=null;redraw();return true;}
        if(page==='cash'){page='';redraw();return true;}
        if(!page&&!accountId)return false;
        accountId=null;page='';redraw();return true;
    }
    return {
        html, queueCurrent, back,
        reset(){selectedAccounts.clear();epoch++;posting=false;editingId=null;tab='chat';accountId=null;page='';drafts=Object.create(null);status='';},
        input(target){if(target.dataset.snapSelect){if(posting||getView().busy)return;target.checked?selectedAccounts.add(target.dataset.snapSelect):selectedAccounts.delete(target.dataset.snapSelect);redraw();return;}if(target.dataset.snapField)drafts[key(target.dataset.snapField)]=target.type==='checkbox'?target.checked:target.value;},
        async readVisible(){if(reading||posting||getView().busy||!accountId||page==='profile'||!adapter.snapchat)return;if(!snapItems(getView(),'message').some(m=>m.accountId===accountId&&m.role==='assistant'&&!m.read))return;reading=true;try{await adapter.snapchat.markRead(accountId);}finally{reading=false;}},
        async action(action,id) {
            if(action==='add-selected'){const token=epoch,ids=[...selectedAccounts];const result=await perform('inviteMany',[ids]);if(token===epoch&&result?.ok){ids.forEach(id=>selectedAccounts.delete(id));const r=result.value;status='已添加 '+r.friends+' 人，等待通过 '+r.pending+' 人，未通过 '+r.declined+' 人。';redraw();}return;}
            if(action==='edit-message'){editingId=id;drafts[key('editText')]=getView().snapchat[id]?.text||'';redraw();return;}
            if(action==='cancel-edit'){editingId=null;redraw();return;}
            if(action==='reroll-message'){await perform('rerollMessage',[id]);return;}
            if(action==='tab'){editingId=null;tab=id;accountId=null;page='';status='';redraw();return;}
            if(action==='profile'){editingId=null;page='profile';redraw();return;}
            if(action==='list'){editingId=null;accountId=null;page='';redraw();return;}
            if(action==='thread'){editingId=null;accountId=id;page='';redraw();return;}
            if(action==='cash'){editingId=null;page='cash';redraw();return;}
            if(action==='comment'){editingId=null;page='comment:'+id;redraw();return;}
            const handlers={invite:['invite',[id]],accept:['accept',[id,true]],decline:['accept',[id,false]],block:['block',[id,true]],unblock:['block',[id,false]],reveal:['reveal',[id]],voice:['call',[id,'voice']],video:['call',[id,'video']],hangup:['hangup',[id]],retry:['retryMessage',[id]],refresh:['refresh',[tab]],like:['like',[id]],settle:['settle',[id,true]],cancel:['settle',[id,false]]};
            if(handlers[action])await perform(...handlers[action]);
        },
        async submit(formElement) {
            const data=Object.fromEntries(new FormData(formElement));const formName=formElement.dataset.snapForm;
            const initialKey=key(''),token=epoch;const draftKey=name=>initialKey+name;let result;
            if(formName==='search'){result=await perform('discover',[data.query]);if(token===epoch&&result?.ok)status='搜索完成，新增 '+result.value.added+' 个账号。';}
            if(formName==='profile')result=await perform('saveProfile',[{...data,sharing:data.sharing==='on'}],'已保存个人设置');
            if(formName==='message'){await sendCurrent();return;}
            if(formName==='edit-message'){result=await perform('editMessage',[editingId,data.editText]);if(token===epoch&&result?.ok)editingId=null;}
            if(formName==='story'){result=await perform('publish',[data.storyKind,data.story],'故事已发布');if(token===epoch&&result?.ok)delete drafts[draftKey('story')];}
            if(formName==='comment'){result=await perform('comment',[page.slice(8),data.comment]);if(token===epoch&&result?.ok){delete drafts[draftKey('comment')];page='';}}
            if(formName==='call'){const active=snapItems(getView(),'call').find(c=>c.accountId===accountId&&c.status==='connected');if(active){result=await perform('call',[accountId,active.mode,data.call,active.id]);if(token===epoch&&result?.ok)delete drafts[draftKey('call')];}}
            if(formName==='cash'){
                result=await perform('transfer',[accountId,data.amount,data.currency,data.memo]);
                if(token===epoch&&result?.ok){for(const name of ['amount','memo'])delete drafts[draftKey(name)];page='';await perform('settle',[result.value,true]);}
            }
            redraw();
        },
    };
}
