const roster=Array.from({length:15},(_,i)=>'同学'+i+'是校园乐队成员。');
export const fixtureCast=roster.join(' ');
let batch=0;
export function feedResult(data={posts:[]}) {
    const id=++batch,posts=[...(data.posts||[])];
    // Model fixtures use independent authors and fresh content in every batch.
    while(posts.length<10)posts.push({name:'同学'+posts.length,handle:'fixture_'+posts.length,authorKind:'npc',npcEvidence:roster[posts.length],has_account:true,text:'社区原创动态 '+id+' / '+posts.length});
    return {...data,posts};
}
export function worldTopics(first=[],count=8) {
    const names=['夜市新摊位','周末球赛','校园艺术节','本地乐队新专辑','城市步道开放','春季读书会','电影节片单','公交线路调整','社区摄影展','创作者交流会'];
    return [...first,...names.slice(0,count-first.length).map(title=>({title,summary:'故事世界中的公共生活话题',scope:'本地',sourcePostIds:[]}))];
}
