import { localizedPerson, sameNamedPerson } from './names.js?v=1.2';
import { readStoryClock, storyTime, dateDay, dayDate } from './story-clock.js?v=1.2';
import { xComments, xCommentKey, xUserReplyContext } from './x-comments.js?v=1.2.66';
import { xAudience } from './x-audience.js?v=1.2';
import { commRecordPatch, commMetaOrInfer } from './comm-context.js?v=1.2.66';
import { withinCommunicationWeek } from './communication-time.js?v=1.2.66';
import { xPublicHistoryRecords } from './x-history.js?v=1.2.70';

// Publication dates are anchored to story time, never the wall clock or
// A/B expiry. This function describes the seven-day public-history window.
export function xPostTiming(post, now = null, meta = null) {
    const day=Number.isInteger(post?.postedAtStory?.day)?post.postedAtStory.day:
        (dateDay(post?.storyTime?.date)??dateDay(meta?.anchor?.date));
    if(!Number.isInteger(day)||day < -719162||day > 2932896)
        return {postedDate:'',postDaysAgo:null,stale:false};
    const postedDate=dayDate(day),today=dateDay(now?.date);
    const postDaysAgo=today!==null&&today>=day?today-day:null;
    const hour=post?.postedAtStory?.hour;
    const minute=Number.isFinite(hour)&&hour>=0&&hour<24?Math.floor(hour*60):null;
    const sent={date:postedDate,time:minute===null?'':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')};
    return {postedDate,postDaysAgo,stale:!!now&&!withinCommunicationWeek(sent,now)};
}

export function xStoryPrompt(state, now = null) {
    // Existing publication IDs are needed for narrative annotations and metrics.
    // Full original posts and user reply chains live exclusively in continuity.
    const ids=new Set();
    for(const row of xPublicHistoryRecords(state,now)){
        if(row.data.postId)ids.add(row.data.postId);
    }
    const references=[...ids].map(id=>{
        const post=state.x?.[id];
        if(post?.type!=='post')return null;
        const timing=xPostTiming(post,now,commMetaOrInfer(state,'x',post.id,post));
        return {id:post.id,author:post.author,postedAtStory:post.postedAtStory,
            ...(timing.postedDate?{postedDate:timing.postedDate}:{}),
            ...(timing.postDaysAgo!==null?{storyDaysAgo:timing.postDaysAgo}:{})};
    }).filter(Boolean);
    return '\nX 正文同步：仅当本楼明确写出 user 已在 X/Twitter 发布新推文，在正文末尾按顺序每帖附一条隐藏 HTML 注释，不用代码块：' +
        '<!--durian-x:{"action":"published","author":"user","text":"推文逐字原文","imageDescription":"仅单张照片时填写其描述","images":["仅多张照片时填写第1张描述","第2张描述，依次填写"],"replies":[{"name":"实际回复者的姓名或网名","text":"公开回复逐字原文"}],"category":"可选A或B：日常闲聊为A，约定/仍在发展的具体事件为B","shown":true}-->。' +
        '分别抄录文字和配图，不补写；一条推文有多张照片时必须仍输出一条 durian-x 标记，用 images 字符串数组按顺序逐张记录每张照片，不拆成多条推文，也不能因为有多图就省略标记。单张照片只填 imageDescription 字符串，不填 images；多张只填 images，不填 imageDescription；纯图片帖 text 可为空；无配图两个字段均省略。照片画面仅记正文实际明确写出的描述，不凭空推断。发布或回复若明确写出时刻，可附 time（HH:mm）；否则沿用本楼剧情时间。回复只收录正文已经写出的他人公开回复，保留顺序，无回复省略 replies。' +
        '若本楼只新增对既有 user 推文的回复，每条附 <!--durian-x:{"action":"reply","postId":"对应已有帖子ID","name":"实际回复者","text":"回复原文","category":"可选A或B：日常闲聊为A，约定/持续事件为B","shown":true}-->。' +
        '正文明确写出既有 user 或 NPC 推文的累计互动数时，另附 <!--durian-x:{"action":"metrics","postId":"准确的已保存帖子ID","postText":"帖子原文或准确文字片段","metrics":{"replies":{"value":4000}}}-->。' +
        'metrics 仅填正文明确提供的 likes、reposts、replies；每项各含 value 非负整数，未提及的项省略。达到4236填4236，突破四千或四千多填4000，点赞破两万填20000，不把下限推成虚构精确值。已经发布的新帖标记也可附同样 metrics。' +
        '已有 X 通信与公开活动在独立历史资料中按剧情时间提供；它们不是本楼刚发生的事项，不得为让记录出场而再次描写首次发帖、首次收到私信、重新查看旧帖或重复社交操作。已保存记录无论此前是否被正文描写，都不是待展示清单；不因资料存在而安排 user 打开 X。' +
        '根据帖子原文、作者、发布时间和本楼指代确认目标，postId 和 postText 必须对应同一帖，不能只凭作者选最新一条；指代有歧义就不记。数字不能来自预期、假设、草稿、他帖或旧数的回忆，不因同步数字编写可见评论或粉丝变化。' +
        '回忆、转述旧帖、草稿、打算发布、转发他人帖子、私信均不记。没有发生就不输出，不为标记安排发帖或回复。已有帖子定位索引仅含ID与时间，不重复注入帖文、评论或私信；正文需要原文时仅参照统一七天历史：' +
        JSON.stringify(references).replace(/\{\{/g,'\\u007b\\u007b') + '\n';
}

const quoted = (prose, value) => typeof value === 'string' && !!value.trim() && prose.includes(value);
const unfinished = /(?:打算|准备|正要|计划|想要|没有|还没|并未|取消)(?:在\s*(?:X|推特)\s*上?)?(?:发布|发帖|发推|发出|发这条|回复)|存为草稿|回忆起|回想起|重读旧帖|\b(?:draft(?:ed)?|unsent|recalled|remembered|about to (?:post|publish|reply)|did(?:n't| not) (?:post|publish|reply))\b/i;

export function xStoryChanges(state, rows, chat, index, eventId, context) {
    const prefix = chat.slice(0,index+1);
    const anchor = {sourceIndex:index, storyTime:storyTime(prefix), postedAtStory:readStoryClock(prefix,null,{exact:true})};
    function eventAnchor(row) {
        if (typeof row.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)) return anchor;
        const [h,m] = row.time.split(':').map(Number);
        return {...anchor,storyTime:{...anchor.storyTime,time:row.time},postedAtStory:{...anchor.postedAtStory,hour:h+m/60}};
    }
    const now = Date.parse(chat[index].send_date) || Date.now();
    const alias = state.x.profile?.alias || context.name1 || 'user';
    const own = value => typeof value === 'string' && ['user',context.name1,alias].some(n => n && n.toLowerCase() === value.trim().toLowerCase());
    const accounts = Object.values(state.x).filter(a => a.type === 'account');
    const changes = [], posts = new Map(), replies = new Set(), updatedPosts = new Map();
    const save = value => {
        changes.push({collection:'x',key:value.id,value});
        if(value.type==='post')updatedPosts.set(value.id,value);
    };
    function addMetrics(row,postId) {
        const post=updatedPosts.get(postId)||state.x[postId];
        if(post?.type!=='post'||!row.metrics||typeof row.metrics!=='object')return;
        const original=post.text||post.imageDescription;
        if(row.action==='metrics'){
            const hasPostText=typeof row.postText==='string'&&!!row.postText.trim();
            // Shown posts no longer provide text to quote; their exact ID can
            // still identify cumulative engagement updates.
            if((!hasPostText&&commMetaOrInfer(state,'x',postId,post).shown!==true)||
                (hasPostText&&row.postText!==original&&row.postText!==original?.slice(0,160)))return;
        }
        const metrics={...post.metrics};
        let changed=false,includesReplies=false;
        for(const key of ['likes','reposts','replies']){
            const data=row.metrics[key];
            if(!data||!Number.isSafeInteger(data.value)||data.value<0)continue;
            if(data.value>(metrics[key]||0)){metrics[key]=data.value;changed=true;if(key==='replies')includesReplies=true;}
        }
        if(!changed)return;
        const updated={...post,metrics};
        if(includesReplies){
            const records={...state.x,...Object.fromEntries(changes.map(c=>[c.key,c.value]))};
            updated.includedDirectReplies=xComments({x:records}).filter(c=>c.postId===postId&&!c.ambient).length;
        }
        save(updated);
    }
    function addReply(reply, postId, prose, id) {
        if (!reply || typeof reply.name !== 'string' || !reply.name.trim() ||
            typeof reply.text !== 'string' || !reply.text.trim() || own(reply.name) ||
            (typeof reply.evidence === 'string' && unfinished.test(reply.evidence.replace(reply.text || '', '')))) return;
        const name = reply.name.trim();
        const matches = accounts.filter(a => sameNamedPerson(a,{name}) || (a.handle && '@'+a.handle === name));
        if (matches.length > 1 || matches[0]?.blocked) return;
        let account = matches[0];
        if (!account) {
            const person = localizedPerson({name},context,accounts);
            account = {id:id+':account',type:'account',name:person.name,aliases:person.aliases,characterId:person.cardId,
                handle:name.startsWith('@')?name.slice(1):'',dmPolicy:'requests',identityKnown:false,createdAt:now};
            accounts.push(account);
            save(account);
        }
        const key = xCommentKey(postId,account.id,reply.text);
        if (replies.has(key)) return;
        replies.add(key);
        save({id,type:'comment',postId,author:account.id,replyTo:null,text:reply.text,read:false,createdAt:now,...eventAnchor(reply)});
        // The narrative presented this public reply; the marker may classify it.
        changes.push(...commRecordPatch('x', id, null, reply.category, reply.shown, state));
    }
    for (const [n,row] of rows.entries()) {
        const id = eventId+':'+n;
        if (row.action === 'metrics') {
            addMetrics(row,row.postId);
            continue;
        }
        if (row.action === 'reply') {
            const post = state.x[row.postId];
            if (post?.type === 'post' && post.author === 'user') addReply(row,post.id,row.prose,id);
            continue;
        }
        if (row.action !== 'published' || !own(row.author)) continue;
        const {text=''} = row;
        // Single-photo markers use the legacy string; multi-photo markers keep
        // each description separately. Accept older model array field variants.
        const rawImages=row.images??row.imageDescriptions??row.imageDescription??'';
        const images=Array.isArray(rawImages)?rawImages:
            typeof rawImages==='string'?(rawImages.trim()?[rawImages]:[]):null;
        if(typeof text!=='string'||!images||
            images.some(image=>typeof image!=='string'||!image.trim())||
            (!text.trim()&&!images.length))continue;
        const imageDescription=images.join('\n');
        // Old evidence-bearing annotations retain their original strict checks.
        // New annotations explicitly describe the completed post; their text and
        // image metadata need not be duplicated verbatim elsewhere in the prose.
        // In particular, a picture description is not a quoted part of the post.
        if (typeof row.evidence === 'string' &&
            ((!text || quoted(row.prose,text)) === false ||
             (images.some(image=>!quoted(row.prose,image))) ||
             unfinished.test(row.evidence.replace(text,'')))) continue;
        const key = JSON.stringify([text,images,row.evidence||'']);
        let postId = posts.get(key);
        if (!postId) {
            postId = id;
            posts.set(key,id);
            save({id,type:'post',author:'user',alias,text,...(imageDescription?{imageDescription}:{}),
                ...(images.length>1?{images}:{}),createdAt:now+n,...eventAnchor(row),
                followersAtPublication:xAudience(state)?.followers??null,includedDirectReplies:0,liked:false,reposted:false});
            // A narrative import was presented by this floor; the marker may
            // classify it into the unified timing sidecar.
            changes.push(...commRecordPatch('x', id, null, row.category, row.shown, state));
        }
        if (Array.isArray(row.replies)) row.replies.forEach((reply,i) => addReply(reply,postId,row.prose,id+':reply:'+i));
        addMetrics(row,postId);
    }
    return changes;
}
