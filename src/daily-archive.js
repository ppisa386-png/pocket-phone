import { readJournal, replayJournal, appendChange } from './journal.js?v=1.0.9';

// Older versions kept past edition changes in the journal but no folder.
// Recover only recorded dates and complete editions, never infer a date.
export function migrateDailyArchives(journal, revisions) {
    const state = replayJournal(journal);
    if (state.daily.archiveSchema || !state.daily.edition || !revisions.length) return {journal, changed:false};
    const daily = {}, past = new Map();
    for (const event of readJournal(journal).events) {
        for (const change of event.changes) {
            if (change.collection !== 'daily') continue;
            const next = change.value, old = daily.edition;
            if (next?.type === 'edition' && old?.day != null && next.day != null && old.day < next.day) {
                const articles = (old.articleIds || []).map(id=>daily[id]).filter(a=>a?.type==='article' && a.editionId===old.editionId);
                if (articles.length && articles.length === old.articleIds.length)
                    past.set(old.day, {...old, id:'archive:' + old.editionId, type:'archive', articles:structuredClone(articles)});
            }
            if (next === null) delete daily[change.key]; else daily[change.key]=structuredClone(next);
        }
    }
    const archives = [...past.values()].sort((a,b)=>b.day-a.day).slice(0,3);
    const changes = [...archives, {id:'archiveSchema',type:'archive_schema',version:1}].map(value=>({collection:'daily',key:value.id,value}));
    return {journal:appendChange(journal,revisions,changes),changed:true};
}
