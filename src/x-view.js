import {visibleXComments,X_COMMENT_LIMIT} from './x-comments.js?v=1.2';
import {xFeedArea,squareFeedPost} from './x-feed.js?v=1.2';
import {pageFields,objectFields} from './x-edit.js?v=1.2';
import {refreshFloor} from './x-influence.js?v=1.2';
import { icon } from './icons.js?v=1.2';
import { squareStatus, squareExpiry } from './square-core.js?v=1.2';
import { displayStoryTime } from './story-clock.js?v=1.2';
import { xItems, xProfile, xCounts } from './x.js?v=1.2';
import { xAudience } from './x-audience.js?v=1.2';
const xEscape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createXPanel({adapter,getView,redraw,notice}) {
    let tab='home',page='',selected=null,replyTarget=null,following=false,results=null,drafts=Object.create(null),status='',working=false,reading=false,epoch=0;
    let editor=null;
    const commentHistory=[];
    const rememberCommentPage=()=>commentHistory.push({tab,page,selected,replyTarget});
    const profile=()=>xProfile(getView(),adapter.userName?.()||'user');
    const key=name=>[tab,page,selected||'',name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>working||getView().busy?' disabled':'';
    const actionIcons={profile:'person',comments:'messages',repost:'repost',like:'heart'};
    const button=(action,label,id='',extra='')=>'<button type="button" class="pp-snap-button" data-x-action="'+action+'" data-x-id="'+xEscape(id)+'" aria-label="'+xEscape(label)+'" title="'+xEscape(label)+'" '+extra+disabled()+'>'+(actionIcons[action]?icon(actionIcons[action])+(action==='profile'?'':'<span>'+xEscape(label.split(' ').at(-1))+'</span>'):xEscape(label))+'</button>';
    const field=(name,label,fallback='',long=false)=>'<label class="pp-field"><span>'+label+'</span>'+(long?'<textarea rows="3" maxlength="6000"':'<input type="text" maxlength="100"')+' name="'+name+'" data-x-field="'+name+'"'+(long?'>'+xEscape(value(name,fallback))+'</textarea>':' value="'+xEscape(value(name,fallback))+'">')+'</label>';
    const form=(name,body,label)=>'<form class="pp-snap-form" data-x-form="'+name+'">'+body+'<button type="submit" class="pp-snap-primary"'+disabled()+'>'+label+'</button></form>';
    const refreshButton=(locked)=>'<button type="button" class="pp-snap-button pp-x-refresh" data-x-action="refresh" aria-label="综合刷新" title="综合刷新"'+(locked?' disabled':disabled())+'><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/></svg></button>';
    const empty=text=>'<p class="pp-snap-empty">'+text+'</p>';
    function person(a) {
        return '<div class="pp-snap-person"><span class="pp-snap-avatar">'+xEscape(a.name.slice(0,1))+'</span><div><strong>'+xEscape(a.name)+'</strong><small>@'+xEscape(a.handle)+'</small></div></div>';
    }
    function accountHTML(a,full=false) {
        return '<article class="pp-x-account" data-press="x-account" data-x-id="'+xEscape(a.id)+'">'+person(a)+(a.bio?'<p class="pp-snap-copy">'+xEscape(a.bio)+'</p>':'')+'<div class="pp-snap-actions">'+(!full?button('account','查看主页',a.id):a.blocked?button('unblock','解除拉黑',a.id):button(a.following?'unfollow':'follow',a.following?'已关注':'关注',a.id)+button('thread','私信',a.id)+(full?button('block','拉黑',a.id):button('account','主页',a.id)))+'</div></article>';
    }
    function squareHeader(state) {
        const edition=state.x?.['square-edition'];if(!edition)return '';
        const status=squareExpiry(edition,adapter.storyChat?.()||[]);
        return '<div class="pp-square-edition">'+(status==='expired'?'<span class="pp-square-expired">已过期</span>':status==='unknown'?'<span>剧情时间不明确 · 暂不可注入</span>':'<span>24 小时内的广场</span>')+'</div>';
    }
    function commentAuthor(state,c) {
        const account=state.x[c.author],self=c.author==='user';
        const name=self?profile().alias:account?.type==='account'?account.name:'账号已不存在';
        if(!self&&account?.type!=='account')return '<strong>'+xEscape(name)+'</strong>';
        const label=name+(!self&&account.handle?' @'+account.handle:'');
        return '<button type="button" class="pp-x-comment-author" data-x-action="comment-author" data-x-id="'+xEscape(c.author)+'" aria-label="查看 '+xEscape(label)+' 的主页"'+disabled()+'>'+xEscape(label)+'</button>';
    }
    function postsHTML(state,posts) {
        return posts.filter(p=>p.author==='user'||!state.x[p.author]?.blocked).map(p=>{
            const a=state.x[p.author];const self=p.author==='user';
            const name=self?profile().alias:a?.name||'用户';const comments=xItems(state,'comment').filter(c=>c.postId===p.id);const counts=xCounts(state,p);
            const target=comments.find(c=>c.id===replyTarget);
            if(page==='post:'+p.id && !target)replyTarget=null;
            const commenter=c=>c.author==='user'?profile().alias:state.x[c.author]?.name||'用户';
            return '<article class="pp-x-post" data-x-post="'+xEscape(p.id)+'" data-press="x-post" data-x-id="'+xEscape(p.id)+'">'+(page==='profile'&&!self&&p.reposted?'<small>你转发了</small>':'')+'<header><button type="button" class="pp-x-post-avatar" data-x-action="'+(self?'profile':'account')+'" data-x-id="'+xEscape(p.author)+'" aria-label="查看 '+xEscape(name)+' 的主页">'+xEscape(name.slice(0,1))+'</button><div class="pp-x-author">'+(self?'<strong>'+xEscape(name)+'</strong>':button('account',name,p.author))+'<small>'+(!self&&a?'@'+xEscape(a.handle)+' · ':'')+(p.storyTime?.date?xEscape(p.storyTime.date)+' ':'')+displayStoryTime(p)+'</small></div></header><p class="pp-snap-copy">'+xEscape(p.text)+'</p>'+(p.imageDescription?'<p class="pp-snap-copy"><small>配图</small> '+xEscape(p.imageDescription)+'</p>':'')+'<div class="pp-snap-actions pp-x-reactions">'+button('comments','回复 '+counts.replies,p.id)+button('repost',(p.reposted?'已转发 ':'转发 ')+counts.reposts,p.id,'aria-pressed="'+!!p.reposted+'"')+button('like',(p.liked?'已赞 ':'赞 ')+counts.likes,p.id,'aria-pressed="'+!!p.liked+'"')+'</div>'+
                (page==='post:'+p.id?'<div class="pp-x-comments">'+visibleXComments(comments).map(c=>{
                    const parent=comments.find(other=>other.id===c.replyTo);
                    return '<article class="pp-x-comment" data-x-comment="'+xEscape(c.id)+'" data-press="x-comment" data-x-id="'+xEscape(c.id)+'"><p class="pp-snap-copy">'+commentAuthor(state,c)+'：'+xEscape(c.text)+'</p>'+(parent?'<small>回复 @'+xEscape(commenter(parent))+'</small>':'')+button('reply-comment','回复',c.id)+'</article>';
                }).join('')+(comments.length<Math.min(X_COMMENT_LIMIT,counts.replies)?button('complete-comments','补齐评论（'+comments.length+'/'+Math.min(X_COMMENT_LIMIT,counts.replies)+'）',p.id):'')+(target?'<div class="pp-snap-actions"><span>回复 @'+xEscape(commenter(target))+'</span>'+button('cancel-reply','取消')+'</div>':'')+form('comment',field('comment',target?'回复内容':'回复帖子','',true),'回复')+'</div>':'')+'</article>';
        }).join('')||(empty('暂无帖子'));
    }
    function trendsHTML(state) {
        const edition=state.x?.['trend-edition'];
        return '<section class="pp-x-trends" aria-label="趋势"><div class="pp-snap-actions"><h3>趋势</h3></div>'+
            (edition?'<small>上次刷新结果</small>':'')+
            (edition?.topics?.length?edition.topics.map((topic,i)=>'<article class="pp-x-trend" data-x-trend="'+i+'" data-press="x-trend" data-x-id="'+i+'"><small>'+ (i+1)+(topic.scope?' · '+xEscape(topic.scope):'')+'</small><h4>'+xEscape(topic.title)+'</h4><p class="pp-snap-copy">'+xEscape(topic.summary)+'</p>'+
                '<div class="pp-snap-actions">'+(topic.injected?'<span class="pp-x-trend-on">已注入</span>':'')+topic.sourcePostIds.filter(id=>state.x[id]?.type==='post'&&state.x[id].author==='user').map((id,n)=>button('comments','查看你的推文'+(topic.sourcePostIds.length>1?' '+(n+1):''),id)).join('')+'</div></article>').join(''):
                empty(edition?'当前暂无趋势话题':'刷新后查看当前话题趋势'))+'</section>';
    }
    function inbox(state) {
        const accounts=xItems(state,'account').filter(a=>xItems(state,'message').some(m=>m.accountId===a.id));
        const mentions=xItems(state,'post').filter(p=>p.outreachMention&&!state.x[p.author]?.blocked);
        const notices=mentions.map(p=>button('comments','公开提及 · '+(state.x[p.author]?.name||'用户'),p.id)).join('');
        return notices+accounts.map(a=>{const thread=xItems(state,'message').filter(m=>m.accountId===a.id);const last=thread.at(-1),unread=thread.filter(m=>m.role==='assistant'&&!m.read).length;return '<article class="pp-x-account">'+person(a)+'<p class="pp-snap-copy">'+xEscape(a.inboundRequest&&!a.dmAccepted&&last.kind&&last.kind!=='text'?'[请求中的媒体已隐藏]':last.text)+'</p>'+button('thread','查看消息'+(unread?' · '+unread:''),a.id)+'</article>';}).join('')||empty('暂无消息。搜索用户，开始私信。');
    }
    function threadHTML(state,a) {
        const messages=xItems(state,'message').filter(m=>m.accountId===a.id).sort((a,b)=>a.createdAt-b.createdAt);
        return button('inbox','‹ 消息')+person(a)+'<div class="pp-snap-actions">'+button('account','主页',a.id)+(!a.blocked&&!a.identityKnown&&a.dmPolicy!=='closed'?button('reveal','自我介绍',a.id):'')+'</div>'+messages.map(m=>'<article class="pp-snap-message '+(m.role==='user'?'is-user':'')+'" data-press="x-message" data-x-id="'+xEscape(m.id)+'"><small>'+(m.role==='user'?'你':xEscape(a.name))+'</small><p class="pp-snap-copy">'+xEscape(a.inboundRequest&&!a.dmAccepted&&m.kind&&m.kind!=='text'?'[请求中的媒体已隐藏]':m.text)+'</p>'+(m.status==='request'?'<small>消息请求已发送</small>'+button('retry','查看回应',m.id):m.status==='pending'?'<small>等待回复…</small>':m.status==='failed'?'<small>回复失败</small>':m.status==='no_reply'?'<small>已发送</small>':'')+'</article>').join('')+
            (a.blocked?empty('已拉黑'):a.inboundRequest==='pending'?button('accept-request','接受私信',a.id)+button('inbox','暂不处理')+button('decline-request','拒绝请求',a.id)+button('block','拉黑',a.id):a.inboundRequest==='declined'?empty('已拒绝'):a.dmPolicy==='closed'?empty('此账号暂不接收私信'):form('message',field('message','消息','',true),'发送'));
    }
    function html() {
        const state=getView();const p=profile();if(selected&&!state.x?.[selected]){selected=null;page='';}const a=state.x?.[selected];
        const floor=refreshFloor(adapter.storyChat?.()||[]);
        let body;
        if(page.startsWith('post:')&&!state.x?.[page.slice(5)]){page='';replyTarget=null;}
        if(page==='profile')body=button('back','‹ 返回')+'<div class="pp-x-audience"><strong data-x-followers>'+xEscape(xAudience(state)?.followers?.toLocaleString('en-US')??'—')+'</strong><span> 粉丝</span> · <strong>'+xItems(state,'account').filter(a=>a.following&&!a.blocked).length+'</strong><span> 正在关注</span>'+button('reset-followers','还原初始粉丝')+'</div>'+form('profile',field('alias','名称',p.alias)+field('bio','简介',p.bio,true)+'<label>陌生私信请求<select name="requestsOpen"><option value="true">允许</option><option value="false"'+(p.requestsOpen===false?' selected':'')+'>关闭</option></select></label>','保存')+'<h3>帖子与转发</h3>'+postsHTML(state,xItems(state,'post').filter(p=>p.author==='user'||p.reposted).reverse());
        else if(page==='account'&&a)body=button('back','‹ 返回')+accountHTML(a,true)+postsHTML(state,xItems(state,'post').filter(p=>p.author===a.id).reverse());
        else if(page==='thread'&&a)body=threadHTML(state,a);
        else if(page.startsWith('post:'))body=button('back','‹ 返回')+postsHTML(state,[state.x?.[page.slice(5)]].filter(p=>p?.type==='post'));
        else if(tab==='search'){
            const accounts=results?.length===0?empty('没有找到相关用户'):xItems(state,'account').filter(a=>results===null||results.includes(a.id)).map(a=>accountHTML(a)).join('');
            body=form('search',field('query','搜索用户'),'搜索')+(results===null?trendsHTML(state)+accounts:accounts+trendsHTML(state));
        }
        else if(tab==='messages')body=inbox(state);
        else if(tab==='square')body='<div class="pp-snap-actions"><h3>广场</h3></div>'+squareHeader(state)+postsHTML(state,xItems(state,'post').filter(p=>squareFeedPost(state,p)).reverse());
        else body='<div class="pp-snap-actions pp-x-feed-tabs">'+button('all','为你推荐','', 'aria-pressed="'+!following+'"')+button('following','正在关注','','aria-pressed="'+following+'"')+refreshButton(floor<0||state.x?.['public-refresh']?.floor===floor)+'</div>'+form('post',field('post','有什么新鲜事？','',true),'发帖')+postsHTML(state,xItems(state,'post').filter(p=>xFeedArea(state,p)==='home'&&(!following||p.author==='user'||state.x[p.author]?.following)).reverse());
        if(editor){
            const inputs=editor.fields.map((f,i)=>'<label class="pp-field"><span>'+xEscape(f.label)+'</span>'+(f.number?'<input type="number" min="0" max="1000000000"':'<textarea rows="2" maxlength="6000"')+' name="f'+i+'" data-x-field="f'+i+'"'+(f.number?' value="'+xEscape(editor.values[i])+'">':'>'+xEscape(editor.values[i])+'</textarea>')+'</label>').join('');
            body=button('cancel-edit','取消编辑')+(inputs?form('edit-page',inputs,'保存修改'):empty('当前页面暂无可编辑内容'));
        }
        return '<div class="pp-snap pp-x"><header class="pp-snap-top"><b aria-label="X">'+icon('x')+'</b>'+button('profile','个人主页')+'</header><div class="pp-x-body" data-x-page="'+xEscape([tab,page,selected||''].join(':'))+'" data-x-thread="'+(page==='thread')+'" data-x-count="'+(page==='thread'?xItems(state,'message').filter(m=>m.accountId===selected).length:0)+'"><p class="pp-snap-status" role="status">'+xEscape(working||state.busy?'正在处理…':state.errorKind==='x'&&state.error?state.error:status)+'</p>'+body+'</div><nav class="pp-snap-tabs pp-x-tabs" aria-label="X 页面">'+[['home','首页','home'],['square','广场','globe'],['search','搜索','search'],['messages','私信','mail']].map(([id,label,glyph])=>'<button type="button" data-x-action="tab" data-x-id="'+id+'" aria-pressed="'+(tab===id)+'">'+icon(glyph)+'<span>'+label+'</span></button>').join('')+'</nav></div>';
    }
    function openEditor(scope) {
        const fields=objectFields(getView(),scope);
        editor={scope,fields,values:fields.map(f=>f.value)};redraw();
    }
    async function perform(method,args=[],message='') {
        if(!adapter.x){notice('请在酒馆内使用 X。');return null;}if(working||getView().busy)return null;
        working=true;const token=epoch;redraw();
        try{const result=await adapter.x[method](...args);if(token!==epoch)return null;status=result?.ok?(method==='refreshPublic'&&Number.isInteger(result.value?.added)?'首页新增 '+result.value.added+' 条 NPC 推文':message):result?.error||'请稍后重试。';
            return result;}
        catch(error){if(token===epoch)status=error.message;return null;}
        finally{if(token===epoch)working=false;redraw();}
    }
    function back() {
        if(editor){editor=null;redraw();return true;}
        if(commentHistory.length){
            ({tab,page,selected,replyTarget}=commentHistory.pop());redraw();return true;
        }
        if(!page)return false;
        replyTarget=null;page='';selected=null;redraw();return true;
    }
    const api = {
        html, back,
        reset(){editor=null;commentHistory.length=0;epoch++;working=false;replyTarget=null;tab='home';page='';selected=null;following=false;results=null;drafts=Object.create(null);status='';},
        input(el){if(editor){editor.values[Number(el.name.slice(1))]=el.value;return;}drafts[key(el.dataset.xField)]=el.value;},
        async readVisible(){
            if(reading||working||getView().busy||!adapter.x)return;
            const postId=page.startsWith('post:')?page.slice(5):null;
            const messageUnread=page==='thread'&&selected&&xItems(getView(),'message').some(m=>m.accountId===selected&&m.role==='assistant'&&!m.read);
            const postUnread=postId&&((getView().x[postId]?.outreachMention&&!getView().x[postId].read)||xItems(getView(),'comment').some(c=>c.postId===postId&&c.author!=='user'&&!c.read));
            if(!messageUnread&&!postUnread)return;reading=true;
            try{if(messageUnread)await adapter.x.markRead(selected);else await adapter.x.markPostRead(postId);}finally{reading=false;}
        },
        async action(action,id) {
            if(['accept-request','decline-request'].includes(action)){await perform('decideRequest',[id,action==='accept-request']);return;}
            if(action==='edit-page'){
                const scope={tab,accountId:selected,following,ids:results},fields=pageFields(getView(),scope);
                editor={scope,fields,values:fields.map(f=>f.value)};redraw();return;
            }
            if(action==='cancel-edit'){editor=null;redraw();return;}
            if(action==='delete-post'){
                if(!window.confirm('确认删除这条推文？它的评论与互动记录会一并删除，无法恢复。'))return;
                await perform('deletePost',[id],'已删除推文');return;
            }
            if(action==='delete-message'){
                if(!window.confirm('删除这条私信？删除后不会再出现在聊天记录中。'))return;
                await perform('deleteMessage',[id],'已删除私信');return;
            }
            if(action==='tab'){commentHistory.length=0;editor=null;replyTarget=null;tab=id;page='';selected=null;status='';redraw();return;}
            if(action==='back'){back();return;}
            if(action==='comment-author'){
                if(id!=='user'&&getView().x?.[id]?.type!=='account')return;
                rememberCommentPage();editor=null;
                selected=id==='user'?null:id;page=id==='user'?'profile':'account';redraw();return;
            }
            if(action==='account'&&getView().x?.[id]?.type!=='account')return;
            if(['profile','account','thread','comments'].includes(action)&&commentHistory.length)rememberCommentPage();
            if(action==='profile'){editor=null;page='profile';selected=null;redraw();return;}
            if(action==='account'){selected=id;page='account';redraw();return;}
            if(action==='thread'){selected=id;page='thread';tab='messages';redraw();return;}
            if(action==='inbox'){selected=null;page='';tab='messages';redraw();return;}
            if(action==='reply-comment'){replyTarget=id;redraw();return;}
            if(action==='cancel-reply'){replyTarget=null;redraw();return;}
            if(action==='complete-comments'){await perform('completeComments',[id]);return;}
            if(action==='comments'){
                replyTarget=null;selected=null;page=page==='post:'+id?'':'post:'+id;redraw();
                const state=getView(),post=state.x?.[id];
                if(page&&post?.type==='post'&&adapter.x?.completeComments){
                    const saved=xItems(state,'comment').filter(c=>c.postId===id).length;
                    if(saved<Math.min(X_COMMENT_LIMIT,xCounts(state,post).replies))await perform('completeComments',[id]);
                }
                return;
            }
            if(action==='all'||action==='following'){commentHistory.length=0;following=action==='following';page='';redraw();return;}
            if(action==='reset-followers'){await perform('resetFollowers',[],'已还原初始粉丝');return;}
            const map={inject:['toggleInjection',[id]],refresh:['refreshPublic',[],'本楼公开内容已刷新'],follow:['follow',[id,true]],unfollow:['follow',[id,false]],block:['block',[id,true]],unblock:['block',[id,false]],like:['react',[id,'liked']],repost:['react',[id,'reposted']],reveal:['reveal',[id]],retry:['retryMessage',[id]],'trend-inject':['toggleTrendInjection',[id]]};
            if(map[action])await perform(...map[action]);
        },
        press(element){
            const state=getView(),kind=element.dataset.press,id=element.dataset.xId,busy=!!(working||state.busy);
            if(kind==='x-post'){
                const post=state.x?.[id];
                if(post?.type!=='post')return [];
                const actions=[{icon:'edit',label:'修改推文',disabled:busy,run:()=>openEditor({kind:'post',id})}];
                if(post.feed==='square'){
                    const status=squareStatus(post,state,adapter.storyChat?.()||[]),selected=post.publication?.selected===true;
                    actions.push({icon:'inject',label:selected?'取消注入这篇推文':'注入这篇推文',active:status==='active'&&selected,
                        disabled:busy||status!=='active',run:()=>api.action('inject',id)});
                }
                actions.push({icon:'delete',label:'删除推文',danger:true,disabled:busy,run:()=>api.action('delete-post',id)});
                return actions;
            }
            const simple={ 'x-comment':['comment','修改回复'], 'x-account':['account','修改账号资料'] };
            if(simple[kind])return [{icon:'edit',label:simple[kind][1],disabled:busy,run:()=>openEditor({kind:simple[kind][0],id})}];
            if(kind==='x-trend'){
                const topic=state.x?.['trend-edition']?.topics?.[Number(id)];
                if(!topic)return [];
                return [{icon:'edit',label:'修改趋势话题',disabled:busy,run:()=>openEditor({kind:'trend',id})},
                    {icon:'inject',label:topic.injected?'取消注入这个趋势':'注入这个趋势',active:topic.injected===true,
                        disabled:busy,run:()=>api.action('trend-inject',id)}];
            }
            if(kind==='x-message'){
                const message=state.x?.[id],account=state.x?.[message?.accountId];
                if(message?.type!=='message'||account?.type!=='account')return [];
                return [
                    {icon:'edit',label:'修改私信',disabled:busy,run:()=>openEditor({kind:'message',id})},
                    {icon:'delete',label:'删除私信',danger:true,disabled:busy,run:()=>api.action('delete-message',id)},
                ];
            }
            return [];
        },
        async submit(el) {
            const data=Object.fromEntries(new FormData(el)),kind=el.dataset.xForm,base=key(''),token=epoch;let result;
            if(kind==='edit-page'&&editor){
                const editing=editor,edits=editing.fields.flatMap((f,i)=>data['f'+i]===f.value?[]:[{id:f.id,path:f.path,before:f.value,value:data['f'+i]}]);
                result=await perform('editPage',[editing.scope,edits],'已保存修改');
                if(token===epoch&&result?.ok&&editor===editing)editor=null;
            }
            if(kind==='profile')result=await perform('saveProfile',[data],'已保存');
            if(kind==='search'){result=await perform('discover',[data.query]);if(token===epoch&&result?.ok)results=result.value.ids;}
            if(kind==='post'){result=await perform('publish',[data.post],'已发布');if(token===epoch&&result?.ok)delete drafts[base+'post'];}
            if(kind==='comment'){result=await perform('comment',[page.slice(5),data.comment,replyTarget]);if(token===epoch&&result?.ok){delete drafts[base+'comment'];replyTarget=null;}}
            if(kind==='message'){
                const before=new Set(xItems(getView(),'message').map(m=>m.id));result=await perform('send',[selected,data.message]);
                if(token===epoch&&(result?.ok||xItems(getView(),'message').some(m=>!before.has(m.id)&&m.role==='user')))delete drafts[base+'message'];
            }
            redraw();
        },
    };
    return api;
}
