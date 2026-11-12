import { localizedPerson, sameNamedPerson } from './names.js?v=1.2';
import { readStoryClock, storyTime, dateDay, dayDate } from './story-clock.js?v=1.2';
import { xComments, xCommentKey, xUserReplyContext } from './x-comments.js?v=1.2.55';
import {xFeedArea} from './x-feed.js?v=1.2';
import { xAudience } from './x-audience.js?v=1.2';
import { commRecordPatch, commExpired, commMetaOrInfer } from './comm-context.js?v=1.2.50';

// Publication dates are anchored to story time, never device time.
export function xPostTiming(post, now = null, meta = null) {
    const day=Number.isInteger(post?.postedAtStory?.day)?post.postedAtStory.day:
        (dateDay(post?.storyTime?.date)??dateDay(meta?.anchor?.date));
    if(!Number.isInteger(day)||day < -719162||day > 2932896)
        return {postedDate:'',postDaysAgo:null,stale:false};
    const postedDate=dayDate(day),today=dateDay(now?.date);
    const postDaysAgo=today!==null&&today>=day?today-day:null;
    const clock=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(now?.time||'');
    const publishedHour=post?.postedAtStory?.hour;
    const beyond72h=postDaysAgo>3||(postDaysAgo===3&&clock&&Number.isFinite(publishedHour)&&
        (+clock[1]+(+clock[2])/60)>publishedHour);
    // Classification remains pending. Only old public post content stops
    // entering every narrative prompt after the longest 72-hour window.
    return {postedDate,postDaysAgo,stale:!!beyond72h};
}

export function xStoryPrompt(state, now = null) {
    const allPosts = Object.values(state.x || {}).filter(p => p.type === 'post' && p.author === 'user');
    const targets = allPosts.slice(-10)
        .map(p=>{
            const meta=commMetaOrInfer(state,'x',p.id,p);
            const timing=xPostTiming(p,now,meta);
            const reference={id:p.id,author:p.author,postedAtStory:p.postedAtStory,sourceIndex:p.sourceIndex,
                ...(timing.postedDate?{postedDate:timing.postedDate}:{}),
                ...(timing.postDaysAgo!==null?{storyDaysAgo:timing.postDaysAgo}:{})};
            if(xFeedArea(state,p)==='square')return reference;
            // Keep old and shown IDs for matching without re-sending the post.
            if(now){
                if(commExpired(meta,now)||timing.stale)return reference;
                if(meta.shown===true)return {...reference,name:p.author==='user'?state.x.profile?.alias:state.x[p.author]?.name,
                    metrics:p.metrics,shown:true};
            }
            return {...reference,name:p.author==='user'?state.x.profile?.alias:state.x[p.author]?.name,
                text:p.text?.slice(0,160),imageDescription:p.imageDescription?.slice(0,160),metrics:p.metrics,userReplies:xUserReplyContext(state,p.id)};
        });
    return '\nX 正文同步：仅当本楼明确写出 user 已在 X/Twitter 发布新推文，在正文末尾按顺序每帖附一条隐藏 HTML 注释，不用代码块：' +
        '<!--durian-x:{"action":"published","author":"user","text":"推文逐字原文","imageDescription":"正文写明的配图描述原文","replies":[{"name":"实际回复者的姓名或网名","text":"公开回复逐字原文"}],"category":"可选A或B：日常闲聊为A，约定/仍在发展的具体事件为B","shown":true}-->。' +
        '分别抄录文字和配图，不补写；纯图片帖 text 可为空，无配图省略 imageDescription。发布或回复若明确写出时刻，可附 time（HH:mm）；否则沿用本楼剧情时间。回复只收录正文已经写出的他人公开回复，保留顺序，无回复省略 replies。' +
        '若本楼只新增对既有 user 推文的回复，每条附 <!--durian-x:{"action":"reply","postId":"对应已有帖子ID","name":"实际回复者","text":"回复原文","category":"可选A或B：日常闲聊为A，约定/持续事件为B","shown":true}-->。' +
        '正文明确写出既有 user 或 NPC 推文的累计互动数时，另附 <!--durian-x:{"action":"metrics","postId":"准确的已保存帖子ID","postText":"未展示的帖子填目录文字片段或配图描述，已展示的帖子可省略。广场必须由本楼提供原帖内容","metrics":{"replies":{"value":4000}}}-->。' +
        'metrics 仅填正文明确提供的 likes、reposts、replies；每项各含 value 非负整数，未提及的项省略。达到4236填4236，突破四千或四千多填4000，点赞破两万填20000，不把下限推成虚构精确值。已经发布的新帖标记也可附同样 metrics。' +
        '已保存帖子目录仅用于核对，不代表本楼新消息。postedDate 是原帖剧情发布日期，storyDaysAgo 是距离当前剧情日期的日历天数；据此判断“昨天”等说法，日期缺失时不猜。没有新的剧情进展或公开互动时，不反复提及同一帖。' +
        '正文第一次明确展示或提及手机中已有、尚未在正文展示的 X 帖子时，末尾附 <!--durian-message-shown:{"platform":"x","id":"该帖准确的已有ID"}-->；已经展示过的不重复标记。' +
        '目录中 shown 为 true 的帖子仅保留定位与互动元数据，不再注入正文或配图，也不得再次作为新发布内容出现；没有 text 且未标记 shown 的旧帖仅作定位引用，不再同步其互动数。' +
        '根据原帖内容、作者、发布时间和本楼指代确认目标，postId 和 postText 必须对应同一帖，不能只凭作者选最新一条；指代有歧义就不记。数字不能来自预期、假设、草稿、他帖或旧数的回忆，不因同步数字编写可见评论或粉丝变化。' +
        '回忆、转述旧帖、草稿、打算发布、转发他人帖子、私信均不记。没有发生就不输出，不为标记安排发帖或回复。已保存的 user 本人帖子（仅附 user 参与的公开评论及其被回复链，不提供无关评论、NPC 帖子、广场、趋势及私信）：' +
        JSON.stringify(targets).replace(/\{\{/g,'\\u007b\\u007b') + '\n';
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
        const {text='',imageDescription=''} = row;
        if (typeof text !== 'string' || typeof imageDescription !== 'string' ||
            (!text.trim() && !imageDescription.trim())) continue;
        // Old evidence-bearing annotations retain their original strict checks.
        // New annotations explicitly describe the completed post; their text and
        // image metadata need not be duplicated verbatim elsewhere in the prose.
        // In particular, a picture description is not a quoted part of the post.
        if (typeof row.evidence === 'string' &&
            ((!text || quoted(row.prose,text)) === false ||
             (imageDescription && !quoted(row.prose,imageDescription)) ||
             unfinished.test(row.evidence.replace(text,'')))) continue;
        const key = JSON.stringify([text,imageDescription,row.evidence||'']);
        let postId = posts.get(key);
        if (!postId) {
            postId = id;
            posts.set(key,id);
            save({id,type:'post',author:'user',alias,text,...(imageDescription?{imageDescription}:{}),createdAt:now+n,...eventAnchor(row),
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
