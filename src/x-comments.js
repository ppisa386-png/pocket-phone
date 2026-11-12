// Missing replyTo (older direct replies) and null (ambient samples) both
// mean the post itself. Distinct parents, authors and intentional user posts
// keep their own IDs. A child of an old duplicate follows the surviving row.
export function xCommentKey(postId, author, text, parent = null) {
    return JSON.stringify([postId, author, parent || null, String(text || '').trim().normalize('NFC').replace(/\s+/gu, ' ')]);
}

export function xComments(state) {
    const comments = [], first = new Map(), redirects = new Map();
    for (const row of Object.values(state.x || {})) {
        if (row.type !== 'comment') continue;
        const parent = redirects.get(row.replyTo) || row.replyTo || null;
        const key = xCommentKey(row.postId, row.author, row.text, parent);
        if (row.author !== 'user' && first.has(key)) {
            redirects.set(row.id, first.get(key));
            continue;
        }
        first.set(key, row.id);
        comments.push(parent === (row.replyTo || null) ? row : {...row, replyTo: parent});
    }
    return comments;
}

export const X_COMMENT_LIMIT=15;
// Public context for a post includes user's own comments and the ancestor
// comments they replied to. Never pull in unrelated threads or private DMs.
export function xUserReplyContext(state, postId) {
    const rows=xComments(state).filter(c=>c.postId===postId);
    const byId=new Map(rows.map(c=>[c.id,c])),selected=new Set();
    for(const row of rows.filter(c=>c.author==='user')){
        const visited=new Set();
        for(let c=row;c&&!visited.has(c.id);c=byId.get(c.replyTo)){
            visited.add(c.id);selected.add(c.id);
        }
    }
    return rows.filter(c=>selected.has(c.id)).map(c=>({id:c.id,author:c.author,
        name:c.author==='user'?state.x?.profile?.alias||'user':state.x?.[c.author]?.name||c.name||c.author,
        text:c.text,replyTo:c.replyTo||null,...(c.storyTime?{storyTime:c.storyTime}:{})}));
}

export function visibleXComments(comments) {
    if(comments.length<=X_COMMENT_LIMIT)return comments;
    const byId=new Map(comments.map(c=>[c.id,c])),selected=new Set();
    // Keep recent direct conversations visible together with their parents.
    const recent=[...comments].reverse();
    for(const comment of [...recent.filter(c=>!c.ambient),...recent.filter(c=>c.ambient)]){
        if(selected.size===X_COMMENT_LIMIT)break;
        const chain=new Set();
        for(let c=comment;c&&!selected.has(c.id)&&!chain.has(c.id);c=byId.get(c.replyTo))chain.add(c.id);
        if(selected.size+chain.size<=X_COMMENT_LIMIT)for(const id of chain)selected.add(id);
    }
    return comments.filter(c=>selected.has(c.id));
}
