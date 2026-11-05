import { localizedPerson, sameNamedPerson } from './names.js?v=1.1.8';
import { readStoryClock, storyTime } from './story-clock.js?v=1.1.12';
import { xComments, xCommentKey } from './x-comments.js?v=1.1.28';
import {xFeedArea} from './x-feed.js?v=1.1.28';
import { xAudience } from './x-audience.js?v=1.1.25';

export function xStoryPrompt(state) {
    const allPosts = Object.values(state.x || {}).filter(p => p.type === 'post');
    const targets = [...new Map([...allPosts.slice(-20),...allPosts.filter(p=>p.author==='user').slice(-10)].map(p=>[p.id,p])).values()]
        .map(p=>{
            const reference={id:p.id,author:p.author,postedAtStory:p.postedAtStory,sourceIndex:p.sourceIndex};
            // A catalog reference must not inject unselected square content into narrative.
            if(xFeedArea(state,p)==='square')return reference;
            return {...reference,name:p.author==='user'?state.x.profile?.alias:state.x[p.author]?.name,
                text:p.text?.slice(0,160),imageDescription:p.imageDescription?.slice(0,160),metrics:p.metrics};
        });
    return '\nX 正文同步：仅当本楼明确写出 user 已在 X/Twitter 发布新推文，在正文末尾按顺序每帖附一条隐藏 HTML 注释，不用代码块：' +
        '<!--durian-x:{"action":"published","author":"user","text":"推文逐字原文","imageDescription":"正文写明的配图描述原文","evidence":"本楼明确完成发布的连续原句","replies":[{"name":"实际回复者的姓名或网名","text":"公开回复逐字原文","evidence":"本楼该人实际回复的连续原句"}]}-->。' +
        '分别抄录文字和配图，不补写；纯图片帖 text 可为空，无配图省略 imageDescription。发布或回复的原句若明确写出时刻，可附 time（逐字 HH:mm）；否则沿用本楼剧情时间。回复只收录正文已经写出的他人公开回复，保留顺序，无回复省略 replies。' +
        '若本楼只新增对既有 user 推文的回复，每条附 <!--durian-x:{"action":"reply","postId":"对应已有帖子ID","name":"实际回复者","text":"回复原文","evidence":"本楼实际回复的原句"}-->。' +
        '正文明确写出既有 user 或 NPC 推文的累计互动数时，另附 <!--durian-x:{"action":"metrics","postId":"准确的已保存帖子ID","postText":"复制目标表中该帖文字片段；纯图片帖用配图描述。广场必须由本楼提供原帖内容","evidence":"本楼能确定是哪条帖子及实际互动变化的连续原句","metrics":{"replies":{"value":4000,"evidence":"本楼明确写出评论突破四千的原句"}}}-->。' +
        'metrics 仅填正文明确提供的 likes、reposts、replies；每项各含 value 非负整数及逐字 evidence，未提及的项省略。达到4236填4236，突破四千或四千多填4000，点赞破两万填20000，不把下限推成虚构精确值。已经发布的新帖标记也可附同样 metrics。' +
        '根据原帖内容、作者、发布时间和本楼指代确认目标，postId 和 postText 必须对应同一帖，不能只凭作者选最新一条；指代有歧义就不记。数字不能来自预期、假设、草稿、他帖或旧数的回忆，不因同步数字编写可见评论或粉丝变化。' +
        '回忆、转述旧帖、草稿、打算发布、转发他人帖子、私信均不记。没有发生就不输出，不为标记安排发帖或回复。已保存帖子（reply只用于user帖，metrics可用于user及NPC帖）：' +
        JSON.stringify(targets).replace(/\{\{/g,'\\u007b\\u007b') + '\n';
}

const quoted = (prose, value) => typeof value === 'string' && !!value.trim() && prose.includes(value);
const unfinished = /(?:打算|准备|正要|计划|想要|没有|还没|并未|取消)(?:在\s*(?:X|推特)\s*上?)?(?:发布|发帖|发推|发出|发这条|回复)|存为草稿|回忆起|回想起|重读旧帖|\b(?:draft(?:ed)?|unsent|recalled|remembered|about to (?:post|publish|reply)|did(?:n't| not) (?:post|publish|reply))\b/i;

export function xStoryChanges(state, rows, chat, index, eventId, context) {
    const prefix = chat.slice(0,index+1);
    const anchor = {sourceIndex:index, storyTime:storyTime(prefix), postedAtStory:readStoryClock(prefix,null,{exact:true})};
    function eventAnchor(row) {
        if (typeof row.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) ||
            !row.evidence.replace(row.text || '', '').includes(row.time)) return anchor;
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
        if(row.action==='metrics'&&(typeof row.postText!=='string'||!row.postText.trim()||
            (row.postText!==original&&row.postText!==original?.slice(0,160))))return;
        const metrics={...post.metrics};
        let changed=false,includesReplies=false;
        for(const key of ['likes','reposts','replies']){
            const data=row.metrics[key];
            if(!data||!Number.isSafeInteger(data.value)||data.value<0||!quoted(row.prose,data.evidence))continue;
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
        if (!reply || !quoted(prose,reply.evidence) || !quoted(reply.evidence,reply.text) ||
            !quoted(reply.evidence,reply.name) || own(reply.name) || unfinished.test(reply.evidence.replace(reply.text,''))) return;
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
        if ((!text && !imageDescription) || (text !== '' && !quoted(row.prose,text)) ||
            (imageDescription !== '' && !quoted(row.prose,imageDescription)) || unfinished.test(row.evidence.replace(text,''))) continue;
        const key = JSON.stringify([text,imageDescription,row.evidence]);
        let postId = posts.get(key);
        if (!postId) {
            postId = id;
            posts.set(key,id);
            save({id,type:'post',author:'user',alias,text,...(imageDescription?{imageDescription}:{}),createdAt:now+n,...eventAnchor(row),
                followersAtPublication:xAudience(state)?.followers??null,includedDirectReplies:0,liked:false,reposted:false});
        }
        if (Array.isArray(row.replies)) row.replies.forEach((reply,i) => addReply(reply,postId,row.prose,id+':reply:'+i));
        addMetrics(row,postId);
    }
    return changes;
}
