import { xComments } from './x-comments.js?v=1.1.2';
// Followers are story-local. Keep the opening baseline separate from earned
// reach; cumulative per-source high water marks survive a manual reset.
export const xAudience = state => state.x?.audience || null;
const rows = state => Object.values(state.x || {});
export function audienceSources(state) {
    const result = [], comments = xComments(state);
    for (const p of rows(state).filter(p => p.type === 'post')) {
        if (p.author !== 'user' && state.x[p.author]?.blocked) continue;
        const base = { postId: p.id, text: p.text, createdAt: p.createdAt, metrics: p.metrics || {},
            comments: comments.filter(c => c.postId === p.id && !state.x[c.author]?.blocked)
                .slice(-12).map(c => ({ text: c.text, author: c.author, name: state.x[c.author]?.name, followers: state.x[c.author]?.followers })) };
        if (p.author === 'user') result.push({ ...base, sourceId: 'post:' + p.id, kind: 'post' });
        if (p.reposted && p.author !== 'user') result.push({ ...base, sourceId: 'repost:' + p.id, kind: 'repost' });
        if (p.mentionsUser && p.feed !== 'square') result.push({ ...base, sourceId: 'mention:' + p.id, kind: 'mention', author: state.x[p.author]?.name });
    }
    for (const c of comments.filter(c => c.author === 'user')) {
        const p = state.x[c.postId];
        if (p?.type !== 'post' || state.x[p.author]?.blocked) continue;
        result.push({ sourceId: 'comment:' + c.id, kind: 'comment', text: c.text, createdAt:c.createdAt, postId: p.id, postText: p.text,
            replies: comments.filter(r => r.replyTo === c.id && !state.x[r.author]?.blocked).map(r => ({text:r.text, author:state.x[r.author]?.name})) });
    }
    return result.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
}
function count(value, field) {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > 1000000000)
        throw Error('X 粉丝数据无效：' + field + ' 必须为 0 至 1000000000 的整数。');
    return Number(value);
}
export function audienceChanges(state, data) {
    if (data == null) return [];
    if (typeof data !== 'object' || Array.isArray(data)) throw Error('X 粉丝数据需要 audience 对象。');
    let next = xAudience(state) ? structuredClone(xAudience(state)) : null;
    if (!next && data.initialFollowers != null) {
        const initialFollowers = count(data.initialFollowers, 'initialFollowers');
        next = {id:'audience',type:'audience',initialFollowers,followers:initialFollowers,credited:{}};
    }
    if (!next) return [];
    const growth = data.growth ?? [];
    if (!Array.isArray(growth) || growth.length > 50) throw Error('X 粉丝增长 growth 应为最多 50 条的数组。');
    const sources = new Map(audienceSources(state).map(s => [s.sourceId, s]));
    const seen = new Set();
    for (const row of growth) {
        if (!row || !sources.has(row.sourceId) || row.hot !== true || !String(row.basis || '').trim() || seen.has(row.sourceId)) continue;
        seen.add(row.sourceId);
        const total = count(row.totalGain, 'growth.totalGain'), previous = next.credited[row.sourceId] || 0;
        if (total <= previous) continue;
        next.followers = Math.min(1000000000, next.followers + total - previous);
        next.credited[row.sourceId] = total;
    }
    return [{collection:'x',key:'audience',value:next}];
}
export const AUDIENCE_RULES = '粉丝是当前故事里的账号数据。首次 initialFollowers 按 user 初始人设、学校/职业、公开知名度、账号是否公开真实身份估算，普通人可为0或少量，公众人物合理更多；匿名小号不能继承真人全部名气。初始值一旦存在不得改写。'
    + 'growth 只评估给出的 sourceId：user 发帖、转帖、公开评论或被明确@的曝光。只有这些行为本身形成热帖/明显传播才 hot:true，不是点一下就涨粉，也不能因原作者帖子热就认定 user 的转帖也热。'
    + '结合来源对应的发帖时剧情、发言实际含义、受众、传播范围和已发生的公开互动判断新增粉丝，名人评论不保证走红。totalGain 是此来源截至当前累计实际吸引的新粉丝，不是本轮增量或互动次数。相同来源重复评估不能重新计数；多个来源属于同一批传播时只计一次，排除现有粉丝。没有新曝光返回空growth，不为刷新强造热帖。';
