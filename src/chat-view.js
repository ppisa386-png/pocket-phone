import { walletCurrency, majorAmount, unitScale } from './currency.js?v=1.2';
import { CHAT_APPS, chatItems } from './chat-apps.js?v=1.2.57';
import { displayStoryTime } from './story-clock.js?v=1.2';
import { icon } from './icons.js?v=1.2.57';
import { wxMoments,wxFriends,canViewWxMoment } from './wechat-moments.js?v=1.2.49';

const chatEsc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const chatKinds={text:'文字',voice:'语音',image:'照片',video:'视频',music:'音乐'};
const chatCallLabels={connected:'通话中',ended:'已结束',no_answer:'未接听'};

export function createChatPanel({app,adapter,getView,redraw,notice,assetBase='assets/wechat/'}) {
    const label=CHAT_APPS[app],wc=app==='wechat';
    let tab='chats',accountId=null,page='',editingId=null,status='',epoch=0,posting=false,reading=false;
    let momentDraft={text:'',imageDescription:'',visibility:'all',audienceIds:[]},momentMenuId=null,momentCommentText='',momentReplyTo=null,plusMenu=false;
    let drafts=Object.create(null);
    const records=type=>chatItems(getView(),app,type);
    const account=()=>getView()[app]?.[accountId];
    const profile=()=>getView()[app]?.profile||{alias:adapter.userName?.()||'user',currency:walletCurrency(getView())};
    const key=name=>[tab,accountId||'',page,name].join(':');
    const value=(name,fallback='')=>drafts[key(name)]??fallback;
    const disabled=()=>getView().busy||posting?' disabled':'';
    const avatar=name=>'<span class="pp-chat-avatar'+(wc?'':' pp-wa-avatar-tone-'+([...String(name||'')].reduce((sum,char)=>sum+char.codePointAt(0),0)%5))+'" aria-hidden="true">'+chatEsc(Array.from(name||'?')[0])+'</span>';
    const button=(action,title,id='',glyph='',extra='')=>'<button type="button" class="pp-chat-button '+(glyph?'is-icon':'')+'" data-chat-action="'+action+'" data-chat-id="'+chatEsc(id)+'" aria-label="'+chatEsc(title)+'" title="'+chatEsc(title)+'"'+extra+'>'+ (glyph?icon(glyph):chatEsc(title))+'</button>';
    const field=(name,title,fallback='',type='text')=>'<label class="pp-chat-field"><span>'+title+'</span><input data-chat-field="'+name+'" name="'+name+'" type="'+type+'" value="'+chatEsc(value(name,fallback))+'" maxlength="'+(name==='name'&&!wc?6000:100)+'"'+(type==='number'?' min="0" step="'+(1/unitScale(walletCurrency(getView())||'USD'))+'"':'')+'></label>';
    const textarea=(name,title)=>'<textarea name="'+name+'" data-chat-field="'+name+'" aria-label="'+title+'" placeholder="'+title+'" rows="2" maxlength="6000" enterkeyhint="enter">'+chatEsc(value(name))+'</textarea>';
    const form=(name,body,title,sendIcon=false)=>'<form class="pp-chat-form" data-chat-form="'+name+'">'+body+'<button class="pp-chat-primary'+(sendIcon?' pp-wa-send':'')+'" type="submit"'+(sendIcon?' aria-label="'+chatEsc(title)+'"':'')+disabled()+'>'+(sendIcon?icon('send'):title)+'</button></form>';
    const empty=(title,copy)=>'<div class="pp-chat-empty">'+icon('messages')+'<strong>'+title+'</strong><p>'+copy+'</p></div>';
    const threadItems=id=>Object.values(getView()[app]||{}).filter(i=>i.accountId===id&&['message','call','transfer'].includes(i.type)).sort((a,b)=>a.createdAt-b.createdAt);
    const parseMusic=i=>{if(i?.kind!=='music')return null;try{const x=JSON.parse(i.text);return typeof x.title==='string'&&typeof x.artist==='string'&&x.title&&x.artist?x:null;}catch{return null;}};
    const preview=i=>!i?'点击开始聊天':i.kind==='music'?'[音乐] '+(parseMusic(i)?.title||'分享音乐'):i.type==='call'?'['+chatKinds[i.mode]+'通话] '+(chatCallLabels[i.status]||''):i.type==='transfer'?'[转账] '+i.currency+' '+majorAmount(i.amountMinor,i.currency):(i.status==='queued'?'[未发送] ':'')+(i.kind!=='text'?'['+chatKinds[i.kind]+'] ':'')+i.text;
    function row(a,contacts=false) {
        const latest=threadItems(a.id).at(-1),unread=records('message').filter(m=>m.accountId===a.id&&m.role==='assistant'&&!m.read).length;
        return '<button type="button" class="pp-chat-row'+(wc?'':' pp-wa-conversation')+'" data-chat-action="thread" data-chat-id="'+chatEsc(a.id)+'">'+avatar(a.name)+'<span class="pp-chat-row-copy"><strong>'+chatEsc(a.name)+'</strong><span>'+chatEsc(a.blocked?'已拉黑':contacts?(a.number||'好友'):preview(latest))+'</span></span><span class="pp-chat-row-meta"><time>'+chatEsc(latest?displayStoryTime(latest):'')+'</time>'+(unread?'<b class="pp-chat-badge">'+(unread>99?'99+':unread)+'</b>':'')+'</span></button>';
    }
    function listHTML() {
        const q=value('filter').trim().toLocaleLowerCase();
        let friends=records('account').filter(a=>(a.friend==='friends'||tab==='chats'&&['incoming','unsaved'].includes(a.friend))&&(!q||[a.name,...(a.aliases||[]),a.number].some(n=>String(n||'').toLocaleLowerCase().includes(q))));
        friends.sort(tab==='contacts'?(a,b)=>a.name.localeCompare(b.name,'zh'):(a,b)=>(threadItems(b.id).at(-1)?.createdAt||0)-(threadItems(a.id).at(-1)?.createdAt||0));
        const search='<label class="pp-chat-search">'+icon('search')+'<input data-chat-field="filter" aria-label="搜索好友" placeholder="搜索" value="'+chatEsc(value('filter'))+'"></label>';
        const actions=wc?'<div class="pp-chat-add-actions pp-wx-quick-actions"><div class="pp-wx-quick-item">'+button('add','添加好友','','plus')+'<span>添加好友</span></div><div class="pp-wx-quick-item">'+button('bulk','一键添加好友','','people',disabled())+'<span>一键添加好友</span></div></div>':'<div class="pp-wa-shortcuts"><span>'+(tab==='contacts'?'好友列表':'最近聊天')+'</span><button type="button" class="pp-wa-bulk" data-chat-action="bulk"'+disabled()+'>'+icon('people')+'一键添加好友</button></div>';
        const rows=friends.length?friends.map(a=>row(a,tab==='contacts')).join(''):empty(q?'没有找到好友':'与朋友开始聊天',q?'试试其他姓名。':wc?'点击上方 + 按姓名添加，或一键添加已有好友。':'点击右上角 + 添加好友，或使用一键添加。');
        return search+actions+(wc?rows:'<div class="pp-wa-list">'+rows+'</div>');
    }

    const wxRow=(glyph,title,action='')=>
        (action?'<button type="button" class="pp-wx-shell-row" data-chat-action="'+action+'">':'<div class="pp-wx-shell-row is-inert">')+
        '<span class="pp-wx-shell-icon">'+icon(glyph)+'</span><span>'+title+'</span><span class="pp-wx-row-arrow">'+icon('chevron')+'</span>'+
        (action?'</button>':'</div>');
    function wxContactsHTML() {
        const header='<div class="pp-wx-contact-shortcuts">'+wxRow('person','新的朋友','add')+wxRow('people','群聊')+wxRow('bookmark','标签')+wxRow('messages','公众号')+'</div>';
        return header+listHTML();
    }
    function wxDiscoverHTML() {
        return '<div class="pp-wx-discover">'+
            '<div class="pp-wx-shell-group">'+wxRow('image','朋友圈','moment-feed')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('scan','扫一扫')+wxRow('smartphone','摇一摇')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('map','附近的人')+wxRow('mail','漂流瓶')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('cart','购物')+wxRow('gamepad','游戏')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('apps','小程序')+'</div></div>';
    }
    function wxMeHTML(p) {
        return '<div class="pp-wx-me"><div class="pp-wx-me-profile">'+avatar(p.alias)+
            '<div><strong>'+chatEsc(p.alias)+'</strong><small>微信号：'+chatEsc(p.alias)+'</small></div>'+
            button('wx-profile','个人信息','','chevron')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('cash','钱包')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('heart','收藏')+wxRow('image','相册','moment-feed')+
            wxRow('parcel','卡包')+wxRow('stories','表情')+'</div>'+
            '<div class="pp-wx-shell-group">'+wxRow('settings','设置')+'</div></div>';
    }
    const audienceLabel=mode=>({all:'公开',private:'私密',include:'部分可见',exclude:'不给谁看'})[mode||'all']||'公开';
    function wxFeedHTML(){
        const state=getView(),friendIds=new Set(wxFriends(state).map(a=>a.id));
        const rows=wxMoments(state).filter(m=>m.authorId==='user'||friendIds.has(m.authorId))
            .sort((a,b)=>b.createdAt-a.createdAt);
        return '<div class="pp-wx-moments"><div class="pp-wx-cover"><div class="pp-wx-cover-name">'+chatEsc(profile().alias)+'</div>'+avatar(profile().alias)+'</div>'+
            (rows.length?rows.map(m=>{
                const own=m.authorId==='user',liked=(m.likes||[]).includes('user');
                const author=own?profile().alias:(state.wechat?.[m.authorId]?.name||m.authorName);
                const likes=(m.likes||[]).filter(id=>id==='user'||canViewWxMoment(m,id))
                    .map(id=>id==='user'?profile().alias:state.wechat?.[id]?.name).filter(Boolean);
                return '<article class="pp-wx-moment" data-wx-moment="'+chatEsc(m.id)+'">'+
                    '<div class="pp-wx-moment-avatar">'+avatar(author)+'</div><div class="pp-wx-moment-main">'+
                    '<strong class="pp-wx-moment-author">'+chatEsc(author)+'</strong>'+
                    (m.text?'<p class="pp-wx-moment-body">'+chatEsc(m.text)+'</p>':'')+
                    (m.imageDescription?'<div class="pp-wx-moment-picture">'+icon('image')+'<span>'+chatEsc(m.imageDescription)+'</span></div>':'')+
                    '<div class="pp-wx-moment-foot"><time>'+chatEsc(displayStoryTime(m))+'</time>'+
                    (own?'<span class="pp-wx-moment-privacy">'+audienceLabel(m.visibility)+'</span>':'')+
                    '<button type="button" data-chat-action="moment-actions" data-chat-id="'+chatEsc(m.id)+'" aria-label="朋友圈操作">'+icon('more')+'</button></div>'+
                    (momentMenuId===m.id?'<div class="pp-wx-moment-menu">'+button('moment-like',liked?'取消赞':'赞',m.id,'heart')+button('moment-comment-open','评论',m.id,'messages')+'</div>':'')+
                    (likes.length||(m.comments||[]).length?'<div class="pp-wx-moment-comments">'+
                    (likes.length?'<p class="pp-wx-like">'+icon('heart')+' '+chatEsc(likes.join('、'))+'</p>':'')+
                    (m.comments||[]).map(c=>{
                        const parent=c.replyTo?(m.comments||[]).find(x=>x.id===c.replyTo):null;
                        const label=parent?' 回复 '+(parent.name||'user'):'';
                        return '<p><b>'+chatEsc(c.name||'user')+chatEsc(label)+'：</b>'+chatEsc(c.text)+
                            '<button type="button" class="pp-wx-comment-reply" data-chat-action="moment-comment-reply" data-chat-id="'+chatEsc(c.id)+'" aria-label="回复 '+chatEsc(c.name||'user')+'">回复</button></p>';
                    }).join('')+'</div>':'')+
                    (momentMenuId==='comment:'+m.id?'<form data-chat-form="moment-comment" class="pp-wx-comment-form">'+
                    '<input name="comment" data-chat-field="momentComment" aria-label="评论" placeholder="'+chatEsc(momentReplyTo?'回复 '+((m.comments||[]).find(c=>c.id===momentReplyTo)?.name||'评论'):'评论')+'" maxlength="500" value="'+chatEsc(momentCommentText)+'">'+
                    '<input type="hidden" name="momentId" value="'+chatEsc(m.id)+'"><button type="submit">发送</button></form>':'')+
                    '</div></article>';
            }).join(''):'<div class="pp-wx-moment-empty">还没有朋友圈动态</div>')+
            '<div class="pp-wx-feed-refresh">'+button('moment-refresh','刷新好友朋友圈','','retry',disabled())+'</div></div>';
    }
    function wxComposeHTML(){
        return '<form id="pp-wx-moment-compose" data-chat-form="moment-publish" class="pp-wx-compose">'+
            '<label class="pp-wx-compose-media"><span>'+icon('image')+'</span>'+
            '<textarea name="imageDescription" data-chat-field="momentImage" rows="2" maxlength="1500" aria-label="图片描述" placeholder="图片描述，不带也可以～">'+chatEsc(momentDraft.imageDescription)+'</textarea></label>'+
            '<label class="pp-wx-compose-text"><textarea name="text" data-chat-field="momentText" rows="6" maxlength="6000" aria-label="朋友圈正文" placeholder="这一刻的想法…">'+chatEsc(momentDraft.text)+'</textarea></label>'+
            '<div class="pp-wx-compose-empty"></div>'+
            '<div class="pp-wx-shell-group">'+wxRow('map','所在位置')+'</div>'+
            '<div class="pp-wx-shell-group"><button type="button" data-chat-action="moment-audience" class="pp-wx-shell-row">'+
            '<span class="pp-wx-shell-icon">'+icon('globe')+'</span><span>谁可以看</span><small class="pp-wx-audience-summary">'+audienceLabel(momentDraft.visibility)+'</small>'+
            '<span class="pp-wx-row-arrow">'+icon('chevron')+'</span></button>'+wxRow('people','提醒谁看')+'</div></form>';
    }
    function wxAudienceHTML(){
        const options=[['all','公开','所有微信好友可见'],['private','私密','仅自己可见'],['include','部分可见','只允许选中的好友'],['exclude','不给谁看','排除选中的好友']];
        return '<div class="pp-wx-audience"><div class="pp-wx-shell-group">'+options.map(([mode,title,description])=>
            '<button type="button" class="pp-wx-audience-option" data-chat-action="moment-mode" data-chat-id="'+mode+'" aria-pressed="'+(momentDraft.visibility===mode)+'"><span><strong>'+title+'</strong><small>'+description+'</small></span><i></i></button>').join('')+'</div>'+
            (['include','exclude'].includes(momentDraft.visibility)?'<div class="pp-wx-audience-list"><h3>选择微信好友</h3>'+
            (wxFriends(getView()).map(a=>'<button type="button" class="pp-wx-audience-friend" data-chat-action="moment-friend" data-chat-id="'+chatEsc(a.id)+'" aria-pressed="'+momentDraft.audienceIds.includes(a.id)+'">'+avatar(a.name)+'<span>'+chatEsc(a.name)+'</span><i></i></button>').join('')||
            '<p class="pp-wx-no-friends">还没有可选择的好友</p>')+'</div>':'')+
            '<div class="pp-wx-audience-done">'+button('moment-audience-done','完成')+'</div></div>';
    }
    function wxMusicForm(){
        return '<form data-chat-form="music" class="pp-wx-music-form"><div class="pp-wx-music-preview"><img src="'+chatEsc(assetBase+'optical_disk_flat.svg')+'" alt="彩色 CD">'+
            '<span><b>分享音乐</b><small>歌曲资料会发送到当前聊天</small></span></div>'+
            field('musicTitle','歌曲名称')+field('musicArtist','歌手')+field('musicNote','分享语（选填）')+
            '<button class="pp-chat-primary" type="submit"'+disabled()+'>发送音乐</button></form>';
    }
    function callsHTML() {
        const calls=records('call').slice().reverse();
        if(!wc){
            const start='<div class="pp-wa-shortcuts"><span>最近通话</span>'+button('contacts','发起通话','','phone')+'</div>';
            const rows=calls.map(c=>{
                const a=getView()[app]?.[c.accountId];if(!a)return '';
                return '<button type="button" class="pp-chat-row pp-wa-call-row" data-chat-action="thread" data-chat-id="'+chatEsc(a.id)+'">'+avatar(a.name)+'<span class="pp-chat-row-copy"><strong>'+chatEsc(a.name)+'</strong><span>'+icon(c.mode==='video'?'video':'phone')+chatKinds[c.mode]+' · '+chatCallLabels[c.status]+'</span></span><time class="pp-wa-call-time">'+chatEsc(displayStoryTime(c))+'</time></button>';
            }).join('');
            return start+'<div class="pp-wa-list">'+(rows||empty('暂无通话','打开好友聊天，点击顶部的语音或视频按钮。'))+'</div>';
        }
        return '<div class="pp-chat-add-actions">'+button('contacts','发起通话','','phone')+'<span>选择好友，语音或视频通话</span></div>'+(calls.length?calls.map(c=>{const a=getView()[app]?.[c.accountId];return a?'<button type="button" class="pp-chat-row" data-chat-action="thread" data-chat-id="'+chatEsc(a.id)+'">'+avatar(a.name)+'<span class="pp-chat-row-copy"><strong>'+chatEsc(a.name)+'</strong><span>'+chatKinds[c.mode]+' · '+chatCallLabels[c.status]+'</span></span>'+icon(c.mode==='video'?'video':'phone')+'</button>':'';}).join(''):empty('暂无通话','打开好友聊天，点击顶部的电话或视频图标。'));
    }
    function transferHTML(t,blocked) {
        if(wc)return '<article class="pp-chat-transfer '+(t.direction==='outgoing'?'is-user':'')+'">'+icon('cash')+'<strong>'+chatEsc(t.currency)+' '+majorAmount(t.amountMinor,t.currency)+'</strong><p>'+chatEsc(t.memo||'转账')+'</p><small>'+({pending:'待收款',accepted:'已收款',declined:'已退还／取消'})[t.status]+'</small>'+(t.status==='pending'?'<div>'+(!blocked?button('settle',t.direction==='incoming'?'收款':'查看收款回应',t.id,'',disabled()):'')+button('cancel','退还／取消',t.id,'',disabled())+'</div>':'')+'</article>';
        const outgoing=t.direction==='outgoing';
        const states={
            pending:{label:'待领取',detail:outgoing?'等待对方领取':'等待你领取',glyph:'history'},
            accepted:{label:'已领取',detail:'转账已完成',glyph:'unblock'},
            declined:{label:'已退还',detail:'款项已退回',glyph:'retry'}
        };
        const stage=states[t.status]||{label:'交易状态未知',detail:'请查看转账记录',glyph:'cash'};
        const amount=chatEsc(t.currency)+' '+chatEsc(majorAmount(t.amountMinor,t.currency));
        const actions=t.status==='pending'
            ? '<div class="pp-wa-payment-actions">'+(!blocked?button('settle',outgoing?'查看收款回应':'领取转账',t.id,'',disabled()):'')
                +button('cancel',outgoing?'取消转账':'退还转账',t.id,'',disabled())+'</div>' : '';
        return '<article class="pp-chat-transfer pp-wa-payment '+(outgoing?'is-user':'is-incoming')+' is-'+chatEsc(t.status)+'" aria-label="WhatsApp 转账：'+stage.label+'">'+
            '<div class="pp-wa-payment-card"><div class="pp-wa-payment-face">'+
                '<small>'+(outgoing?'你转给对方':'对方转给你')+'</small><strong>'+amount+'</strong>'+
                '<div class="pp-wa-payment-summary"><span class="pp-wa-payment-icon">'+icon('cash')+'</span><span><b>'+stage.label+'</b><small>'+stage.detail+'</small></span></div>'+
            '</div>'+(t.memo?'<p class="pp-wa-payment-memo">'+chatEsc(t.memo)+'</p>':'')+
            '<div class="pp-wa-payment-footer"><span>'+icon(stage.glyph)+stage.label+'</span><time>'+chatEsc(displayStoryTime(t))+'</time></div></div>'+
            actions+'</article>';
    }
    function threadHTML(a) {
        const items=threadItems(a.id);
        return items.map(i=>{
            if(i.type==='transfer')return transferHTML(i,a.blocked);
            if(i.type==='call')return '<article class="pp-chat-call">'+icon(i.mode==='video'?'video':'phone')+'<strong>'+chatKinds[i.mode]+'通话 · '+chatCallLabels[i.status]+'</strong>'+i.turns.map(t=>'<p><b>'+chatEsc(t.role==='user'?'你':a.name)+'：</b>'+chatEsc(t.text)+'</p>').join('')+'</article>';
            const own=i.role==='user';
            const editing=editingId===i.id?form('edit',textarea('editText','修改消息'),'保存')+button('cancel-edit','取消修改'):'';
            const stateText={sent:wc?'':'已发送',queued:'未发送',pending:'等待回复',failed:'发送失败',no_reply:'对方暂未回复'}[i.status]||'';
            const music=wc?parseMusic(i):null;
            if(music){return '<article class="pp-chat-message is-user pp-wx-music-message" data-press="chat-message" data-chat-id="'+chatEsc(i.id)+'">'+avatar(profile().alias)+'<div class="pp-wx-music-card"><img src="'+chatEsc(assetBase+'optical_disk_flat.svg')+'" alt="彩色 CD"><div><strong>'+chatEsc(music.title)+'</strong><span>'+chatEsc(music.artist)+'</span><small>音乐分享</small></div>'+(music.note?'<p>'+chatEsc(music.note)+'</p>':'')+'<time>'+chatEsc(displayStoryTime(i))+'</time></div></article>';}
            return '<article class="pp-chat-message '+(own?'is-user':'')+'" data-press="chat-message" data-chat-id="'+chatEsc(i.id)+'">'+(wc?avatar(own?profile().alias:a.name):'')+'<div class="pp-chat-bubble">'+(i.kind!=='text'?'<small class="pp-chat-kind">'+icon(i.kind==='voice'?'voice':i.kind==='video'?'video':'image')+chatKinds[i.kind]+'</small>':'')+'<p>'+chatEsc(i.text)+'</p><div class="pp-chat-message-meta"><time>'+chatEsc(displayStoryTime(i))+'</time>'+(stateText?'<span>'+stateText+'</span>':'')+(!wc&&own&&i.status==='answered'?'<span class="pp-chat-checks" aria-label="已回复">✓✓</span>':'')+'</div>'+editing+(wc&&['failed','pending'].includes(i.status)?button('retry','重试回复',i.id,'',disabled()):'')+'</div></article>';
        }).join('')||'<p class="pp-chat-thread-start">'+chatEsc(a.name)+'</p>';
    }
    function composerHTML(a) {
        if(a.blocked)return '<div class="pp-chat-composer"><p>已拉黑，不能发送消息或通话。</p>'+button('unblock','解除拉黑',a.id,'',disabled())+'</div>';
        if(a.friend==='unsaved')return button('add','添加联系人');
        if(a.friend==='incoming')return button('accept-request','接受联系人',a.id)+button('later-request','暂不处理',a.id)+button('decline-request','拒绝',a.id)+button('block','拉黑',a.id);
        const call=threadItems(a.id).find(i=>i.type==='call'&&i.status==='connected');
        if(call)return '<div class="pp-chat-composer">'+form('call',textarea('call','通话内容'),'说话')+button('hangup','挂断',call.id,'',disabled())+'</div>';
        if(!wc){
            const selectedKind=value('kind','text');
            const kindGlyph={text:'plus',voice:'voice',image:'image',video:'video',transfer:'cash'}[selectedKind]||'plus';
            const picker='<span class="pp-wa-kind-picker">'+icon(kindGlyph)+'<select name="kind" data-chat-field="kind" aria-label="消息类型">'+Object.entries({...chatKinds,transfer:'转账'}).map(([id,title])=>'<option value="'+id+'"'+(selectedKind===id?' selected':'')+'>'+title+'</option>').join('')+'</select></span>';
            return '<div class="pp-chat-composer pp-wa-composer">'+form('message','<div class="pp-chat-compose-input">'+picker+textarea('message','消息')+'</div>','发送',true)+'</div>';
        }
        return '<div class="pp-chat-composer">'+form('message','<div class="pp-chat-compose-input">'+
            (wc?button('wx-plus','更多功能','','plus'):'')+
            '<select name="kind" data-chat-field="kind" aria-label="消息类型">'+Object.entries(wc?chatKinds:{...chatKinds,transfer:'转账'}).filter(([id])=>id!=='music').map(([id,title])=>
            '<option value="'+id+'"'+(value('kind','text')===id?' selected':'')+'>'+title+'</option>').join('')+'</select>'+
            textarea('message','发送消息')+'</div>','发送')+
            (wc?'<div class="pp-chat-compose-extra">'+button('cash','转账',a.id,'cash',disabled())+'<small>换行暂存 · 点击发送</small></div>'+
                (plusMenu?'<div class="pp-wx-plus-grid"><div class="pp-wx-plus-item is-inert">'+icon('image')+'<span>照片</span></div>'+
                '<div class="pp-wx-plus-item is-inert">'+icon('video')+'<span>拍摄</span></div>'+
                '<button type="button" class="pp-wx-plus-item" data-chat-action="share-music">'+icon('disc')+'<span>音乐</span></button>'+
                '<div class="pp-wx-plus-item is-inert">'+icon('map')+'<span>位置</span></div></div>':''):'')+'</div>';
    }
    function html() {
        if(accountId&&!account()){accountId=null;page='';editingId=null;}
        const a=account(),p=profile(),thread=!!a&&!page;
        const title=wc?(
            page==='moment-feed'?'朋友圈':page==='moment-compose'?'发表朋友圈':page==='moment-audience'?'谁可以看':
            page==='share-music'?'分享音乐':page==='add'?'添加好友':page==='wx-profile'?'个人信息':
            a?a.name:tab==='contacts'?'通讯录':tab==='discover'?'发现':tab==='me'?'我':'微信'):
            (a?a.name:page==='add'?'添加好友':tab==='contacts'?'联系人':tab==='calls'?'通话':tab==='me'?'设置':'聊天');
        let body='';
        if(wc&&page==='moment-feed')body=wxFeedHTML();
        else if(wc&&page==='moment-compose')body=wxComposeHTML();
        else if(wc&&page==='moment-audience')body=wxAudienceHTML();
        else if(wc&&page==='share-music')body=wxMusicForm();
        else if(wc&&page==='wx-profile')body='<div class="pp-chat-settings"><div class="pp-chat-profile">'+avatar(p.alias)+'<h2>'+chatEsc(p.alias)+'</h2></div>'+form('profile',field('alias','昵称',p.alias),'保存个人设置')+'</div>';
        else if(page==='add')body='<div class="pp-chat-settings">'+form('add',field('name','好友姓名')+(wc?'':'<small>添加多个好友可以用、间隔名字</small>'),'发送好友申请')+button('bulk','一键添加好友','','',disabled())+'</div>';
        else if(a&&page==='info')body='<div class="pp-chat-settings"><div class="pp-chat-profile">'+avatar(a.name)+'<h2>'+chatEsc(a.name)+'</h2>'+(a.number?'<p>'+chatEsc(a.number)+'</p>':'')+'</div>'+(!wc&&!a.blocked&&a.friend==='friends'?button('cash','转账',a.id,'',disabled()):'')+(!a.identityKnown?button('reveal','自我介绍',a.id,'',disabled()):'')+button(a.blocked?'unblock':'block',a.blocked?'解除拉黑':'加入黑名单',a.id,'',disabled())+'</div>';
        else if(a&&page==='cash')body='<div class="pp-chat-settings">'+form('cash',field('amount',wc?'转账金额（'+(walletCurrency(getView())||'先建账')+'）':'转账金额','','number')+field('memo','附言'),'确认转账')+'</div>';
        else if(a)body=threadHTML(a);
        else if(wc&&tab==='discover')body=wxDiscoverHTML();
        else if(wc&&tab==='me')body=wxMeHTML(p);
        else if(wc&&tab==='contacts')body=wxContactsHTML();
        else if(tab==='me')body='<div class="pp-chat-settings"><div class="pp-chat-profile">'+avatar(p.alias)+'<h2>'+chatEsc(p.alias)+'</h2><span>'+label+'</span></div>'+form('profile',field('alias','昵称',p.alias),'保存个人设置')+'</div>';
        else body=tab==='calls'?callsHTML():listHTML();
        const message=getView().busy?'正在处理…':getView().errorKind===app&&getView().error?getView().error:status;
        const tabs=wc?[['chats','微信','wechat'],['contacts','通讯录','people'],['discover','发现','compass'],['me','我','person']]:
            [['chats','聊天','messages'],['contacts','通讯录','people'],['calls','通话','phone'],['me','设置','settings']];
        const showTabs=!a&&!page;
        return '<section class="pp-chat-app pp-'+app+(thread?' is-thread':'')+'" data-chat-tab="'+chatEsc(tab)+'" data-chat-screen="'+(thread?'thread':page?'subpage':'root')+'"><header class="pp-chat-top">'+
            (a||page?button('back','返回','','back'):'')+
            (!wc&&a?avatar(a.name):'')+'<h2>'+chatEsc(title)+'</h2><div>'+
            (wc&&page==='moment-feed'?button('moment-compose','拍摄 / 发表朋友圈','','camera'):
            wc&&page==='moment-compose'?'<button type="submit" class="pp-wx-publish-button" form="pp-wx-moment-compose"'+disabled()+'>发表</button>':
            thread?button('voice','语音通话',a.id,'phone',disabled())+button('video','视频通话',a.id,'video',disabled())+button('info','聊天信息',a.id,'more'):
            !a&&!page&&tab!=='discover'&&tab!=='me'?button('add','添加好友','','plus'):'')+
            '</div></header>'+(message?'<p class="pp-chat-status" role="status">'+chatEsc(message)+'</p>':'')+
            '<div class="pp-chat-scroll" data-chat-page="'+chatEsc([app,tab,accountId||'',page].join(':'))+'" data-chat-count="'+(a?threadItems(a.id).length:0)+'">'+body+'</div>'+
            (thread?composerHTML(a):'')+
            (showTabs?'<nav class="pp-chat-tabs" aria-label="'+label+' 页面">'+tabs.map(([id,text,glyph])=>
            '<button type="button" data-chat-action="tab" data-chat-id="'+id+'" aria-pressed="'+(tab===id)+'">'+icon(glyph)+'<span>'+text+'</span></button>').join('')+'</nav>':'')+'</section>';
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
        if(!wc&&value('kind','text')==='transfer'){drafts[key('kind')]='text';page='cash';redraw();return;}
        if(!text.trim())return;
        const result=await perform('queueMessage',[id,value('kind','text'),text]);
        if(token===epoch&&result?.ok&&drafts[draftKey]===text)delete drafts[draftKey];redraw();return result;
    }
    function back(){
        if(editingId){editingId=null;redraw();return true;}
        if(wc&&page==='moment-audience'){page='moment-compose';redraw();return true;}
        if(wc&&page==='moment-compose'){page='moment-feed';redraw();return true;}
        if(wc&&page==='share-music'){page='';plusMenu=false;redraw();return true;}
        if(page){page='';redraw();return true;}
        if(accountId){accountId=null;redraw();return true;}
        return false;
    }
    async function bulk(){const token=epoch,result=await perform('addEstablished');if(token===epoch&&result?.ok){status='已添加 '+result.value.added+' 位好友'+(result.value.updated?'，更新 '+result.value.updated+' 位':'')+'。';redraw();}}
    const api={html,back,queueCurrent,
        reset(){epoch++;posting=false;reading=false;tab='chats';accountId=null;page='';editingId=null;status='';drafts=Object.create(null);momentDraft={text:'',imageDescription:'',visibility:'all',audienceIds:[]};momentMenuId=null;momentCommentText='';momentReplyTo=null;plusMenu=false;},
        input(target){const name=target.dataset.chatField;if(name){
            if(wc&&name==='momentImage'){momentDraft.imageDescription=target.value;return;}
            if(wc&&name==='momentText'){momentDraft.text=target.value;return;}
            if(wc&&name==='momentComment'){momentCommentText=target.value;return;}
            const changed=value(name)!==target.value;drafts[key(name)]=target.value;
            if(name==='kind'&&!wc&&target.value==='transfer'&&accountId){drafts[key(name)]='text';page='cash';editingId=null;redraw();return;}
            if((name==='filter'||name==='kind'&&!wc)&&changed)redraw();}},
        async readVisible(){if(reading||posting||getView().busy||page||!accountId||!adapter[app]||!records('message').some(m=>m.accountId===accountId&&m.role==='assistant'&&!m.read))return;const token=epoch;reading=true;try{await adapter[app].markRead(accountId);}finally{if(token===epoch)reading=false;}},
        async action(action,id){
            if(action==='back'){back();return;}
            if(action==='tab'||action==='contacts'){tab=action==='contacts'?'contacts':id;accountId=null;page='';editingId=null;status='';plusMenu=false;redraw();return;}
            if(action==='thread'){accountId=id;page='';editingId=null;status='';plusMenu=false;redraw();return;}
            if(wc&&action==='wx-plus'){plusMenu=!plusMenu;redraw();return;}
            if(wc&&action==='share-music'){page='share-music';plusMenu=false;redraw();return;}
            if(wc&&action==='wx-profile'){page='wx-profile';redraw();return;}
            if(wc&&action==='moment-feed'){tab='discover';accountId=null;page='moment-feed';momentMenuId=null;redraw();return;}
            if(wc&&action==='moment-compose'){page='moment-compose';redraw();return;}
            if(wc&&action==='moment-audience'){page='moment-audience';redraw();return;}
            if(wc&&action==='moment-mode'){momentDraft.visibility=id;momentDraft.audienceIds=[];redraw();return;}
            if(wc&&action==='moment-friend'){const ids=momentDraft.audienceIds,ix=ids.indexOf(id);if(ix>=0)ids.splice(ix,1);else ids.push(id);redraw();return;}
            if(wc&&action==='moment-audience-done'){
                if(['include','exclude'].includes(momentDraft.visibility)&&!momentDraft.audienceIds.length){
                    status='请至少选择一位好友。';redraw();return;
                }
                status='';page='moment-compose';redraw();return;
            }
            if(wc&&action==='moment-refresh'){await perform('refreshMoments',[],'已刷新朋友圈');return;}
            if(wc&&action==='moment-actions'){momentMenuId=momentMenuId===id?null:id;redraw();return;}
            if(wc&&action==='moment-comment-open'){momentMenuId='comment:'+id;momentCommentText='';momentReplyTo=null;redraw();return;}
            if(wc&&action==='moment-comment-reply'){
                const moment=wxMoments(getView()).find(m=>(m.comments||[]).some(c=>c.id===id));
                if(!moment)return;
                momentMenuId='comment:'+moment.id;momentCommentText='';momentReplyTo=id;redraw();return;
            }
            if(wc&&action==='moment-like'){momentMenuId=null;await perform('likeMoment',[id]);redraw();return;}
            if(['add','info','cash'].includes(action)){page=action;editingId=null;redraw();return;}
            if(action==='edit'){editingId=id;drafts[key('editText')]=getView()[app]?.[id]?.text||'';redraw();return;}
            if(action==='cancel-edit'){editingId=null;redraw();return;}
            if(action==='later-request'){accountId=null;page='';redraw();return;}
            if(action==='delete'){
                if(!window.confirm('删除这条消息？删除后不会再出现在聊天记录中。'))return;
                await perform('deleteMessage',[id],'已删除消息');return;
            }
            if(action==='bulk'){await bulk();return;}
            const handlers={'accept-request':['accept',[id,true]],'decline-request':['accept',[id,false]],reroll:['rerollMessage',[id]],retry:['retryMessage',[id]],block:['block',[id,true]],unblock:['block',[id,false]],reveal:['reveal',[id]],voice:['call',[id,'voice']],video:['call',[id,'video']],hangup:['hangup',[id]],settle:['settle',[id,true]],cancel:['settle',[id,false]]};
            if(handlers[action])await perform(...handlers[action]);
        },
        async submit(element){
            const data=Object.fromEntries(new FormData(element)),name=element.dataset.chatForm,token=epoch,id=accountId,prefix=key('');
            if(name==='add'){const result=await perform('addByName',[data.name]);if(token===epoch&&result?.ok){status=result.value.details?result.value.details.map(r=>r.name+'：'+r.status).join('；'):result.value.added?'已添加 '+result.value.added+' 位好友。':result.value.already?'对方已经是好友。':'对方未通过好友申请。';redraw();}return;}
            if(wc&&name==='moment-publish'){
                const result=await perform('publish',[momentDraft.text,momentDraft.imageDescription,momentDraft.visibility,[...momentDraft.audienceIds]],'朋友圈已发表');
                if(token===epoch&&result?.ok){momentDraft={text:'',imageDescription:'',visibility:'all',audienceIds:[]};page='moment-feed';momentMenuId=null;redraw();}
                return;
            }
            if(wc&&name==='moment-comment'){
                const result=await perform('commentMoment',[data.momentId,data.comment,momentReplyTo],'已评论');
                if(token===epoch&&result?.ok){momentMenuId=null;momentCommentText='';momentReplyTo=null;redraw();}
                return;
            }
            if(wc&&name==='music'){
                const result=await perform('shareMusic',[id,data.musicTitle,data.musicArtist,data.musicNote],'已分享音乐');
                if(token===epoch&&result?.ok){delete drafts[key('musicTitle')];delete drafts[key('musicArtist')];delete drafts[key('musicNote')];page='';plusMenu=false;redraw();}
                return;
            }
            if(name==='profile'){const result=await perform('saveProfile',[{...profile(),alias:data.alias}],'已保存个人设置');if(wc&&result?.ok){page='';redraw();}return;}
            if(name==='edit'){const result=await perform('editMessage',[editingId,data.editText]);if(token===epoch&&result?.ok)editingId=null;redraw();return;}
            if(name==='message'){
                if(!wc&&value('kind','text')==='transfer'){drafts[key('kind')]='text';page='cash';redraw();return;}
                const text=value('message');
                if(text.trim()){const queued=await perform('queueMessage',[id,value('kind','text'),text]);if(token!==epoch||!queued?.ok)return;if(drafts[prefix+'message']===text)delete drafts[prefix+'message'];}
                await perform('flushMessages',[id]);redraw();return;
            }
            if(name==='call'){const call=threadItems(id).find(i=>i.type==='call'&&i.status==='connected');if(call){const result=await perform('call',[id,call.mode,data.call,call.id]);if(token===epoch&&result?.ok)delete drafts[prefix+'call'];}redraw();return;}
            if(name==='cash'){const result=await perform('transfer',[id,data.amount,wc?walletCurrency(getView()):null,data.memo]);if(token===epoch&&result?.ok){delete drafts[prefix+'amount'];delete drafts[prefix+'memo'];page='';await perform('settle',[result.value,true]);}redraw();}
        },
        press(element){
            const id=element.dataset.chatId,item=getView()[app]?.[id];
            if(!item||item.type!=='message')return [];
            const busy=!!(posting||getView().busy),actions=[];
            if(item.role==='assistant'){
                actions.push({icon:'edit',label:'修改消息',disabled:busy,run:()=>api.action('edit',id)});
                actions.push({icon:'refresh',label:'重新生成消息',disabled:busy,run:()=>api.action('reroll',id)});
            }
            actions.push({icon:'delete',label:'删除消息',danger:true,disabled:busy,run:()=>api.action('delete',id)});
            return actions;
        },
    };
    return api;
}
