// Trends are ordered story-world topics, not estimates of platform statistics.
export const X_TRENDS_RULES = '当前任务：X 刷新趋势。每次生成10～15个不同的公共话题，按你判断的热度从高到低排列。结合当前世界书、人物设定、有效剧情、年代、地区和生活环境，不查询现实新闻。'
    + '允许原创合理的娱乐、体育、新闻、校园、地区生活、行业事件和网络文化话题，不要求每件世界背景事件已在正文出现。不得编造 user 或已有重要 NPC 未曾发生的私人经历，不让整榜围绕 user 或当前人物。'
    + '逐一考察候选 user 最近推文，结合实际公开文字、配图和发布背景判断是否足以形成公共热门话题。普通人也可以因特殊内容上榜，知名人物的普通日常也可不上榜；不设置粉丝或互动门槛，不给 user 预留名额或排名优先权。'
    + '匿名账号不能继承真人名气，私人经历、内心、私信、未公开关系和匿名身份不能成为公众已知。正文仅帮助理解已公开内容，不编造名人转发或官方确认来证明热度。'
    + '同一事件合并为一个话题，可关联多条候选推文；来源只能填写候选真实 ID，每条上榜推文归属一个话题，其余公共话题 sourcePostIds 为[]。结合现有话题与剧情进展保持连续，不因刷新就把旧事当成新事件。'
    + '直接返回话题和是否采用各候选的判断，不模拟真实趋势算法，不估算讨论数量、不提供统计或排名依据。趋势不改写推文本身的点赞、转发、回复和粉丝数据。';

export const X_TRENDS_OUTPUT = '只输出一个 JSON 对象：{"topics":[{"title":"话题名称","summary":"简短介绍","scope":"可选地区或圈层","sourcePostIds":[]}],"evaluations":[{"postId":"候选ID","eligible":false}]}。topics 必须10～15条且互不重复，按热度顺序排列。evaluations 恰好覆盖候选ID，各一次，eligible 为布尔值；true 的ID仅归属一条话题，false 不得出现于话题中。没有候选时 evaluations 为[]，仍生成10～15个世界内公共话题。无需 postCount、rank、reason 或其他统计字段。';

export function validateTrends(data, candidates) {
    const fail = () => { throw Error('X 趋势返回格式或推文关联不正确，本次未保存。'); };
    const text = (value, max) => {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail();
        return value.trim();
    };
    if (!Array.isArray(data?.topics) || data.topics.length < 10 || data.topics.length > 15 || !Array.isArray(data.evaluations) || data.evaluations.length !== candidates.length) fail();
    const ids = new Set(candidates.map(p => p.id)), decisions = new Map(), linked = new Set(), titles = new Set();
    const evaluations = data.evaluations.map(row => {
        if (!row || !ids.has(row.postId) || decisions.has(row.postId) || typeof row.eligible !== 'boolean') fail();
        decisions.set(row.postId, row.eligible);
        return {postId:row.postId, eligible:row.eligible};
    });
    const topics = data.topics.map(row => {
        if (!row || !Array.isArray(row.sourcePostIds) || row.sourcePostIds.length > candidates.length) fail();
        const title=text(row.title,160), key=title.normalize('NFKC').toLowerCase().replace(/[#＃\s]/g, '');
        if (!key || titles.has(key)) fail();
        titles.add(key);
        for (const id of row.sourcePostIds) {
            if (!ids.has(id) || decisions.get(id) !== true || linked.has(id)) fail();
            linked.add(id);
        }
        return {title,summary:text(row.summary,1500),scope:row.scope == null || row.scope === '' ? '' : text(row.scope,100),sourcePostIds:[...row.sourcePostIds]};
    });
    for (const [id,eligible] of decisions) if (eligible !== linked.has(id)) fail();
    return {topics,evaluations};
}
