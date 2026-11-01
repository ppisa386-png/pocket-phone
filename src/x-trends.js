// Trend candidates come from the current journal projection, never raw saved
// events. Ranking is a story judgment in the existing user-triggered request.
export const X_TRENDS_RULES = '当前任务：X 刷新趋势。趋势是当前故事中 X 上正在传播的话题，按当前热度从高到低排列，最多10条，可以为空。与当前世界、地区、时代一致，不查询现实新闻。'
    + '必须逐一考量候选 user 推文。先结合每条发布时正文理解其实际内容、指代、图片描述及事件意义，再评估是否形成趋势；配文无需重述正文已经交代的人物和经过。'
    + '分别判断 user 的公开知名度及账号可识别身份、现有粉丝与受众、内容的新颖性/公共关联/讨论价值、可能的传播途径、已有互动和剧情经过时间。名气和内容可以分别带来传播，普通人也能因内容引发讨论，知名人物的平常帖子也可以不上榜。没有粉丝数据表示未知，不等于零；刚发表而尚未刷新互动的零计数不构成不上榜的硬门槛，不要求正文先写出已经走红。'
    + '匿名账号不能直接继承真人名气。正文帮助理解公开内容，不使私人经过、未公开关系、内心、私信或未暴露身份变成公众已知；不能编造名人转发、官方确认等已经发生的事实来证明热度。'
    + '同一事件的多条推文合并到一个话题，可与已有公共话题合并；区分圈内、地区和更广泛传播，不把朋友几句回应自动升级为全网热搜。不固定粉丝/点赞门槛，不预留 user 名额，不强行围绕 user 凑榜。'
    + '对照上次趋势及当前剧情进展判断维持、升降和退榜，重复刷新本身不代表时间经过或新增热度。较旧的候选仅有真实持续讨论或新进展时继续考虑，不能把旧事重新当成刚发生。未知发表时间不编造时间。'
    + 'eligible 表示本次进入榜单，reason 简述判断依据；所有候选都须评估，未上榜也应有理由。上榜话题的 sourcePostIds 只能引用给出的候选真实ID，每条上榜推文只归属一个话题。其他世界内公共话题 sourcePostIds 为空。趋势判断不改写原推文、点赞/转发/评论或粉丝数，话题讨论量不等于原推文互动量。';

export const X_TRENDS_OUTPUT = '本次刷新趋势仅输出一个 JSON 对象：{"topics":[{"title":"话题","summary":"公开讨论内容","scope":"地区或圈层","postCount":null,"sourcePostIds":[]}],"evaluations":[{"postId":"候选ID","eligible":false,"reason":"判断依据"}]}。topics 最多10条，按热度排序，不另填 rank；postCount 为估算的当前话题讨论帖数（0到1000000000整数），无法合理估算用 null。evaluations 必须恰好覆盖给出的每条候选ID且无重复，eligible 为布尔值；eligible:true 的ID须出现在且仅出现在一条话题的 sourcePostIds 内，false 不得上榜。没有候选时 evaluations 为[]，没有趋势时 topics 为[]。不返回 posts/replies/accounts/audience，不输出额外对象。';

export function validateTrends(data, candidates) {
    const fail = () => { throw Error('X 趋势返回格式或推文关联不正确，本次未保存。'); };
    const text = (value, max) => {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail();
        return value.trim();
    };
    if (!Array.isArray(data?.topics) || data.topics.length > 10 || !Array.isArray(data.evaluations) || data.evaluations.length !== candidates.length) fail();
    const ids = new Set(candidates.map(p => p.id)), decisions = new Map(), linked = new Set(), titles = new Set();
    const evaluations = data.evaluations.map(row => {
        if (!row || !ids.has(row.postId) || decisions.has(row.postId) || typeof row.eligible !== 'boolean') fail();
        decisions.set(row.postId, row.eligible);
        return {postId:row.postId, eligible:row.eligible, reason:text(row.reason,1000)};
    });
    const topics = data.topics.map(row => {
        if (!row || !Array.isArray(row.sourcePostIds) || row.sourcePostIds.length > candidates.length) fail();
        const title=text(row.title,160), key=title.normalize('NFKC').toLowerCase().replace(/^[#＃]+/, '').trim();
        if (!key || titles.has(key)) fail();
        titles.add(key);
        for (const id of row.sourcePostIds) {
            if (!ids.has(id) || decisions.get(id) !== true || linked.has(id)) fail();
            linked.add(id);
        }
        if (row.postCount !== null && (!Number.isSafeInteger(row.postCount) || row.postCount < 0 || row.postCount > 1000000000)) fail();
        return {title,summary:text(row.summary,1500),scope:text(row.scope,100),postCount:row.postCount,sourcePostIds:[...row.sourcePostIds]};
    });
    for (const [id,eligible] of decisions) if (eligible !== linked.has(id)) fail();
    return {topics,evaluations};
}
