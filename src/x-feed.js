// Legacy classification is a display projection. Never manufacture a square
// publication, clock or injection evidence for a post moved by this rule.
export function xAccountKind(account) {
    if (!account) return null;
    if (account.authorKind) return account.authorKind;
    if (account.characterId) return 'npc';
    if (account.crowd) return 'public';
    return institutionName(account.name) ? 'organization' : null;
}
export function institutionName(name) {
    return /(?:资讯号|新闻社|新闻中心|赛事速报|赛事报道|官方账号|官方通知|官方公告|品牌宣传号|新闻媒体|赛事资讯|树洞精选|快讯|大学公告|校园资讯|大学|学校|集团|电视台|博物馆)$|\b(?:university|news agency|newsroom|official news|school bulletin)\b/i.test(String(name||'').trim());
}
export function xFeedArea(state,post) {
    if (post.author==='user') return 'home';
    if (post.feed==='square') return 'square';
    if(Object.values(state.business||{}).some(deal=>deal?.accountId===post.author))return 'square';
    return ['organization','public'].includes(xAccountKind(state.x?.[post.author])) ? 'square' : 'home';
}
export function squareFeedPost(state,post) {
    return xFeedArea(state,post)==='square' && (post.feed!=='square'||!state.x['square-edition']||
        post.publication?.editionId===state.x['square-edition'].editionId);
}
