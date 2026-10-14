import { squareStatus, squareExpiry } from './square-core.js?v=0.24.3';
import { displayStoryTime } from './story-clock.js?v=0.24.3';
import { xItems, xProfile, xCounts } from './x.js?v=0.24.3';
const xEscape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createXPanel({adapter,getView,redraw,notice}) {
    let tab='home',page='',selected=null,replyTarget=null,following=false,results=null,drafts=Object.create(null),status='',working=false,reading=false,epoch=0;
    const profile=()=>xProfile(getView(),adapter.userName?.()||'user');
    const key=name=>[tab,page,selected||'',name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>working||getView().busy?' disabled':'';
    const button=(action,label,id='',extra='')=>'<button type="button" class="pp-snap-button" data-x-action="'+action+'" data-x-id="'+xEscape(id)+'" '+extra+disabled()+'>'+xEscape(label)+'</button>';
    const field=(name,label,fallback='',long=false)=>'<label class="pp-field"><span>'+label+'</span>'+(long?'<textarea rows="3" maxlength="6000"':'<input type="text" maxlength="100"')+' name="'+name+'" data-x-field="'+name+'"'+(long?'>'+xEscape(value(name,fallback))+'</textarea>':' value="'+xEscape(value(name,fallback))+'">')+'</label>';
    const form=(name,body,label)=>'<form class="pp-snap-form" data-x-form="'+name+'">'+body+'<button type="submit" class="pp-snap-primary"'+disabled()+'>'+label+'</button></form>';
    const refreshButton=(square=false)=>'<button type="button" class="pp-snap-button pp-x-refresh" data-x-action="'+(square?'square-refresh':'refresh')+'" aria-label="刷新'+(square?'广场':'动态')+'" title="刷新"'+disabled()+'><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/></svg></button>';
    const empty=text=>'<p class="pp-snap-empty">'+text+'</p>';
    function person(a) {
        return '<div class="pp-snap-person"><span class="pp-snap-avatar">'+xEscape(a.name.slice(0,1))+'</span><div><strong>'+xEscape(a.name)+'</strong><small>@'+xEscape(a.handle)+'</small></div></div>';
    }
    function accountHTML(a,full=false) {
        return '<article class="pp-x-account">'+person(a)+(a.bio?'<p class="pp-snap-copy">'+xEscape(a.bio)+'</p>':'')+'<div class="pp-snap-actions">'+(a.blocked?button('unblock','解除拉黑',a.id):button(a.following?'unfollow':'follow',a.following?'已关注':'关注',a.id)+button('thread','私信',a.id)+(full?button('block','拉黑',a.id):button('account','主页',a.id)))+'</div></article>';
    }
    function injectionButton(p,state) {
        if(p.feed!=='square')return '';
        const status=squareStatus(p,state,adapter.storyChat?.()||[]),selected=!!p.publication?.selected;
        const label=status==='used'?'已采用':status==='expired'?'已过期':status==='unknown'?'时间不明确':status==='old'?'旧帖':status==='blocked'?'已拉黑':selected?'已选 · 取消注入':'注入正文';
        return '<button type="button" class="pp-square-inject" data-x-action="inject" data-x-id="'+xEscape(p.id)+'" title="'+label+'" aria-label="'+label+'" aria-pressed="'+(status==='active'&&selected)+'"'+(status!=='active'?' disabled':disabled())+'><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H5v18h14V8M14 3v5h5M8 13h8m-4-3 3 3-3 3"/></svg><span>'+label+'</span></button>';
    }
    function squareHeader(state) {
        const edition=state.x?.['square-edition'];if(!edition)return '';
        const status=squareExpiry(edition,adapter.storyChat?.()||[]);
        return '<div class="pp-square-edition">'+(status==='expired'?'<span class="pp-square-expired">已过期</span>':status==='unknown'?'<span>剧情时间不明确 · 暂不可注入</span>':'<span>24 小时内的广场</span>')+'</div>';
    }
    function postsHTML(state,posts) {
        return posts.filter(p=>p.author==='user'||!state.x[p.author]?.blocked).map(p=>{
            const a=state.x[p.author];const self=p.author==='user';
            const name=self?profile().alias:a?.name||'用户';const comments=xItems(state,'comment').filter(c=>c.postId===p.id);const counts=xCounts(state,p);
            const target=comments.find(c=>c.id===replyTarget);
            if(page==='post:'+p.id && !target)replyTarget=null;
            const commenter=c=>c.author==='user'?profile().alias:state.x[c.author]?.name||'用户';
            return '<article class="pp-x-post" data-x-post="'+xEscape(p.id)+'">'+(page==='profile'&&!self&&p.reposted?'<small>你转发了</small>':'')+'<header>'+(self?'<strong>'+xEscape(name)+'</strong>':button('account',name,p.author))+'<small>'+(!self&&a?'@'+xEscape(a.handle)+' · ':'')+displayStoryTime(p)+'</small></header><p class="pp-snap-copy">'+xEscape(p.text)+'</p>'+injectionButton(p,state)+'<div class="pp-snap-actions">'+button('comments','回复 '+counts.replies,p.id)+button('repost',(p.reposted?'已转发 ':'转发 ')+counts.reposts,p.id,'aria-pressed="'+!!p.reposted+'"')+button('like',(p.liked?'已赞 ':'赞 ')+counts.likes,p.id,'aria-pressed="'+!!p.liked+'"')+'</div>'+
                (page==='post:'+p.id?'<div class="pp-x-comments">'+comments.map(c=>{
                    const parent=comments.find(other=>other.id===c.replyTo);
                    return '<article class="pp-x-comment" data-x-comment="'+xEscape(c.id)+'"><p class="pp-snap-copy"><strong>'+xEscape(commenter(c))+'：</strong>'+xEscape(c.text)+'</p>'+(parent?'<small>回复 @'+xEscape(commenter(parent))+'</small>':'')+button('reply-comment','回复',c.id)+'</article>';
                }).join('')+(target?'<div class="pp-snap-actions"><span>回复 @'+xEscape(commenter(target))+'</span>'+button('cancel-reply','取消')+'</div>':'')+form('comment',field('comment',target?'回复内容':'回复帖子','',true),'回复')+'</div>':'')+'</article>';
        }).join('')||(empty('暂无帖子'));
    }
    function inbox(state) {
        const accounts=xItems(state,'account').filter(a=>xItems(state,'message').some(m=>m.accountId===a.id));
        return accounts.map(a=>{const thread=xItems(state,'message').filter(m=>m.accountId===a.id);const last=thread.at(-1),unread=thread.filter(m=>m.role==='assistant'&&!m.read).length;return '<article class="pp-x-account">'+person(a)+'<p class="pp-snap-copy">'+xEscape(last.text)+'</p>'+button('thread','查看消息'+(unread?' · '+unread:''),a.id)+'</article>';}).join('')||empty('暂无消息。搜索用户，开始私信。');
    }
    function threadHTML(state,a) {
        const messages=xItems(state,'message').filter(m=>m.accountId===a.id).sort((a,b)=>a.createdAt-b.createdAt);
        return button('inbox','‹ 消息')+person(a)+'<div class="pp-snap-actions">'+button('account','主页',a.id)+(!a.blocked&&!a.identityKnown&&a.dmPolicy!=='closed'?button('reveal','自我介绍',a.id):'')+'</div>'+messages.map(m=>'<article class="pp-snap-message '+(m.role==='user'?'is-user':'')+'"><small>'+(m.role==='user'?'你':xEscape(a.name))+'</small><p class="pp-snap-copy">'+xEscape(m.text)+'</p>'+(m.status==='request'?'<small>消息请求已发送</small>'+button('retry','查看回应',m.id):['failed','pending'].includes(m.status)?button('retry','重试',m.id):m.status==='no_reply'?'<small>已发送</small>':'')+'</article>').join('')+
            (a.blocked?empty('已拉黑'):a.dmPolicy==='closed'?empty('此账号暂不接收私信'):form('message',field('message','消息','',true),'发送'));
    }
    function html() {
        const state=getView();const p=profile();if(selected&&!state.x?.[selected]){selected=null;page='';}const a=state.x?.[selected];
        let body;
        if(page.startsWith('post:')&&!state.x?.[page.slice(5)]){page='';replyTarget=null;}
        if(page==='profile')body=button('back','‹ 返回')+form('profile',field('alias','名称',p.alias)+field('bio','简介',p.bio,true),'保存')+'<h3>帖子与转发</h3>'+postsHTML(state,xItems(state,'post').filter(p=>p.author==='user'||p.reposted).reverse());
        else if(page==='account'&&a)body=button('back','‹ 返回')+accountHTML(a,true)+postsHTML(state,xItems(state,'post').filter(p=>p.author===a.id).reverse());
        else if(page==='thread'&&a)body=threadHTML(state,a);
        else if(page.startsWith('post:'))body=button('back','‹ 返回')+postsHTML(state,[state.x?.[page.slice(5)]].filter(p=>p?.type==='post'));
        else if(tab==='search')body=form('search',field('query','搜索用户'),'搜索')+(results?.length===0?empty('没有找到相关用户'):xItems(state,'account').filter(a=>results===null||results.includes(a.id)).map(a=>accountHTML(a)).join(''));
        else if(tab==='messages')body=inbox(state);
        else if(tab==='square')body='<div class="pp-snap-actions"><h3>广场</h3>'+refreshButton(true)+'</div>'+squareHeader(state)+postsHTML(state,xItems(state,'post').filter(p=>p.feed==='square'&&(!state.x['square-edition']||p.publication?.editionId===state.x['square-edition'].editionId)).reverse());
        else body='<div class="pp-snap-actions">'+button('all','为你推荐','', 'aria-pressed="'+!following+'"')+button('following','正在关注','','aria-pressed="'+following+'"')+refreshButton()+'</div>'+form('post',field('post','有什么新鲜事？','',true),'发帖')+postsHTML(state,xItems(state,'post').filter(p=>p.feed!=='square'&&(!following||p.author==='user'||state.x[p.author]?.following)).reverse());
        return '<div class="pp-snap pp-x"><header class="pp-snap-top"><b>𝕏</b>'+button('profile','个人主页')+'</header><p class="pp-snap-status" role="status">'+xEscape(working||state.busy?'正在处理…':state.errorKind==='x'&&state.error?state.error:status)+'</p>'+body+'<nav class="pp-snap-tabs pp-x-tabs" aria-label="X 页面">'+[['home','首页'],['square','广场'],['search','搜索'],['messages','私信']].map(([id,label])=>'<button type="button" data-x-action="tab" data-x-id="'+id+'" aria-pressed="'+(tab===id)+'">'+label+'</button>').join('')+'</nav></div>';
    }
    async function perform(method,args=[],message='') {
        if(!adapter.x){notice('请在酒馆内使用 X。');return null;}if(working||getView().busy)return null;
        working=true;const token=epoch;redraw();
        try{const result=await adapter.x[method](...args);if(token!==epoch)return null;status=result?.ok?message:result?.error||'请稍后重试。';return result;}
        catch(error){if(token===epoch)status=error.message;return null;}
        finally{working=false;redraw();}
    }
    return {
        html,
        reset(){epoch++;replyTarget=null;tab='home';page='';selected=null;following=false;results=null;drafts=Object.create(null);status='';},
        input(el){drafts[key(el.dataset.xField)]=el.value;},
        async readVisible(){
            if(reading||working||getView().busy||!adapter.x)return;
            const postId=page.startsWith('post:')?page.slice(5):null;
            const messageUnread=page==='thread'&&selected&&xItems(getView(),'message').some(m=>m.accountId===selected&&m.role==='assistant'&&!m.read);
            const postUnread=postId&&xItems(getView(),'comment').some(c=>c.postId===postId&&c.author!=='user'&&!c.read);
            if(!messageUnread&&!postUnread)return;reading=true;
            try{if(messageUnread)await adapter.x.markRead(selected);else await adapter.x.markPostRead(postId);}finally{reading=false;}
        },
        async action(action,id) {
            if(action==='tab'){replyTarget=null;tab=id;page='';selected=null;status='';redraw();return;}
            if(action==='back'){replyTarget=null;page='';selected=null;redraw();return;}
            if(action==='profile'){page='profile';selected=null;redraw();return;}
            if(action==='account'){selected=id;page='account';redraw();return;}
            if(action==='thread'){selected=id;page='thread';tab='messages';redraw();return;}
            if(action==='inbox'){selected=null;page='';tab='messages';redraw();return;}
            if(action==='reply-comment'){replyTarget=id;redraw();return;}
            if(action==='cancel-reply'){replyTarget=null;redraw();return;}
            if(action==='comments'){replyTarget=null;selected=null;page=page==='post:'+id?'':'post:'+id;redraw();return;}
            if(action==='all'||action==='following'){following=action==='following';page='';redraw();return;}
            const map={inject:['toggleInjection',[id]],'square-refresh':['refresh',['square']],refresh:['refresh',[following]],follow:['follow',[id,true]],unfollow:['follow',[id,false]],block:['block',[id,true]],unblock:['block',[id,false]],like:['react',[id,'liked']],repost:['react',[id,'reposted']],reveal:['reveal',[id]],retry:['retryMessage',[id]]};
            if(map[action])await perform(...map[action]);
        },
        async submit(el) {
            const data=Object.fromEntries(new FormData(el)),kind=el.dataset.xForm,base=key(''),token=epoch;let result;
            if(kind==='profile')result=await perform('saveProfile',[data],'已保存');
            if(kind==='search'){result=await perform('discover',[data.query]);if(result?.ok)results=result.value.ids;}
            if(kind==='post'){result=await perform('publish',[data.post],'已发布');if(result?.ok)delete drafts[base+'post'];}
            if(kind==='comment'){result=await perform('comment',[page.slice(5),data.comment,replyTarget]);if(result?.ok){delete drafts[base+'comment'];replyTarget=null;}}
            if(kind==='message'){
                const before=new Set(xItems(getView(),'message').map(m=>m.id));result=await perform('send',[selected,data.message]);
                if(token===epoch&&(result?.ok||xItems(getView(),'message').some(m=>!before.has(m.id)&&m.role==='user')))delete drafts[base+'message'];
            }
            redraw();
        },
    };
}
