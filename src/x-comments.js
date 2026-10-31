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
