import { localizedPerson, sameNamedPerson } from './names.js?v=1.1.8';
import { readStoryClock, storyTime } from './story-clock.js?v=1.1.12';
import { xCommentKey } from './x-comments.js?v=1.1.8';
import { xAudience } from './x-audience.js?v=1.1.25';

export function xStoryPrompt(state) {
    const targets = Object.values(state.x || {}).filter(p => p.type === 'post' && p.author === 'user').slice(-10)
        .map(({id,text,imageDescription}) => ({id,text:text?.slice(0,160),imageDescription:imageDescription?.slice(0,120)}));
    return '\nX 正文同步：仅当本楼明确写出 user 已在 X/Twitter 发布新推文，在正文末尾按顺序每帖附一条隐藏 HTML 注释，不用代码块：' +
        '<!--durian-x:{"action":"published","author":"user","text":"推文逐字原文","imageDescription":"正文写明的配图描述原文","evidence":"本楼明确完成发布的连续原句","replies":[{"name":"实际回复者的姓名或网名","text":"公开回复逐字原文","evidence":"本楼该人实际回复的连续原句"}]}-->。' +
        '分别抄录文字和配图，不补写；纯图片帖 text 可为空，无配图省略 imageDescription。发布或回复的原句若明确写出时刻，可附 time（逐字 HH:mm）；否则沿用本楼剧情时间。回复只收录正文已经写出的他人公开回复，保留顺序，无回复省略 replies。' +
        '若本楼只新增对既有 user 推文的回复，每条附 <!--durian-x:{"action":"reply","postId":"对应已有帖子ID","name":"实际回复者","text":"回复原文","evidence":"本楼实际回复的原句"}-->。' +
        '回忆、转述旧帖、草稿、打算发布、转发他人帖子、私信均不记。没有发生就不输出，不为标记安排发帖或回复。近期可回复的 user 推文：' +
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
    const changes = [], posts = new Map(), replies = new Set();
    const save = value => changes.push({collection:'x',key:value.id,value});
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
    }
    return changes;
}
