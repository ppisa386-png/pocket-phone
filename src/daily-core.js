import { DAILY_NARRATIVE_PROMPT } from './daily-prompts.js?v=1.1.29';
import { readStoryClock, dayDate } from './story-clock.js?v=1.1.29';
import { squareBasis } from './square-core.js?v=1.1.29';
import { storyAnnotations } from './story-phone.js?v=1.1.29';

export const dailyArticles = state => Object.values(state.daily || {}).filter(a => a.type === 'article' && a.editionId === state.daily?.edition?.editionId);
// Current expired edition is visible immediately, without a write or API call.
// Snapshots are persisted atomically when a replacement edition is saved.
export function dailyArchives(state, chat) {
    const now = readStoryClock(chat).day;
    if (now == null) return [];
    const current = state.daily?.edition;
    const editions = Object.values(state.daily || {}).filter(e => e.type === 'archive');
    if (current?.day != null && current.day < now) editions.push({ ...current, id:'archive:' + current.editionId, type:'archive', articles:dailyArticles(state) });
    const seen = new Set();
    return editions.filter(e => Number.isInteger(e.day) && e.day < now && Array.isArray(e.articles))
        .sort((a,b) => b.day-a.day || (b.sourceIndex ?? 0)-(a.sourceIndex ?? 0))
        .filter(e => { if (seen.has(e.day)) return false; seen.add(e.day); return true; }).slice(0,3);
}
export function paperDraft(state,id){
    const edition=state.daily?.edition?.editionId===id?state.daily.edition:state.daily?.['archive:'+id];
    if(!edition)return null;
    const articles=edition.articles||dailyArticles(state);
    return {publication:edition.publication||'',location:edition.location||'',date:edition.printDate||dayDate(edition.day),
        articles:articles.map(({id,section,headline,summary,body})=>({id,section:section||'',headline,summary,body}))};
}
export function dailyEditorialHistory(state, chat) {
    const expired = dailyArchives(state, chat);
    const current = state.daily?.edition;
    const editions = current && !expired.some(e => e.editionId === current.editionId)
        ? [{ ...current, articles:dailyArticles(state) }, ...expired] : expired;
    return editions.map(e => ({ editionId:e.editionId, date:e.printDate||dayDate(e.day)||null, publication:e.publication,
        articles:e.articles.map(a => ({ id:a.id, headline:a.headline, summary:a.summary, body:a.body,
            adoption:dailyUsed(a,chat)?'adopted':a.selected===true?(Number.isInteger(a.selectedIndex)?'selected_pending':'unknown'):a.selected===false?'unselected':'unknown',
            publicBasis:a.publicBasis })) }));
}
export function dailyExpiry(edition, chat) {
    const now = readStoryClock(chat).day;
    if (edition?.day == null || now == null || now < edition.day) return 'unknown';
    return now > edition.day ? 'expired' : 'active';
}
export function dailyUsed(article, chat) {
    if (!article?.selected || !Number.isInteger(article.selectedIndex)) return false;
    return (chat || []).slice(article.selectedIndex + 1).some(m => storyAnnotations(m, 'durian-daily-used').some(r => r.id === article.id && r.used === true));
}
export function dailyStatus(article, state, chat) {
    if (article?.type !== 'article' || article.editionId !== state.daily?.edition?.editionId) return 'old';
    if (dailyUsed(article, chat)) return 'used';
    return dailyExpiry(state.daily.edition, chat);
}
const dailyText = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
// The fourteen editorial columns. Every article's section names one of them;
// the rotation window in the schema record counts how often each appeared.
export const DAILY_SECTIONS = ['政治与公共事务', '国际与外交', '社会新闻', '治安与司法', '体育', '经济与商业', '城市建设与交通', '教育', '医疗与健康', '科技与科学', '环境与自然', '文化与娱乐', '农业能源与产业', '生活旅游与消费'];
const SECTION_HINTS = [
    ['政治与公共事务', ['政治', '政府', '选举', '议会', '政策', '立法', '政务', '行政', '领导']],
    ['国际与外交', ['外交', '国际', '峰会', '条约', '使馆', '联合国', '双边', '两国']],
    ['社会新闻', ['社会', '民生', '社区', '人口', '舆论', '热点', '福利', '慈善']],
    ['治安与司法', ['治安', '案件', '刑事', '警察', '警方', '司法', '法院', '审判', '犯罪', '逮捕', '破获']],
    ['体育', ['体育', '运动', '联赛', '足球', '篮球', '比赛', '锦标赛', '冠军', '奥运', '球员', '赛事', '夺冠']],
    ['经济与商业', ['经济', '商业', '市场', '金融', '企业', '并购', '上市', '贸易', '股市', '物价', '营收']],
    ['城市建设与交通', ['城建', '市政', '交通', '地铁', '公交', '道路', '桥梁', '基建', '机场', '铁路', '通车']],
    ['教育', ['教育', '学校', '高考', '大学', '招生', '课堂', '学费', '教师', '校园', '开学']],
    ['医疗与健康', ['医疗', '医院', '健康', '疫情', '疾病', '卫生', '疫苗', '药品', '问诊']],
    ['科技与科学', ['科技', '科学', '研究', '技术', '发明', '航天', '互联网', '实验', '芯片', '人工智能']],
    ['环境与自然', ['环境', '自然', '气候', '污染', '洪水', '地震', '台风', '生态', '灾害']],
    ['文化与娱乐', ['文化', '娱乐', '电影', '音乐', '演出', '艺术', '展览', '游戏', '明星', '影视', '节庆', '音乐节']],
    ['农业能源与产业', ['农业', '能源', '产业', '工业', '矿产', '电力', '石油', '粮食', '种植', '养殖', '工厂']],
    ['生活旅游与消费', ['生活', '旅游', '消费', '购物', '餐饮', '假期', '民宿', '景区', '零售', '房价']],
];
// Every generated article must land in one of the fourteen columns: an exact
// column name wins, a unique near-miss maps, and anything else is classified
// by the article's own content (its wording counts triple over the body) with
// a neutral column catching the leftovers. No valid news is ever dropped over
// a section name, and the normalized name is what sectionLog counts.
const normalizeSection = row => {
    const text = dailyText(row?.section, 80);
    if (DAILY_SECTIONS.includes(text)) return text;
    if (text) {
        const nameHits = DAILY_SECTIONS.filter(name => name.includes(text) || text.includes(name));
        if (nameHits.length === 1) return nameHits[0];
    }
    const haystack = [row?.headline, row?.summary, row?.body].filter(value => typeof value === 'string').join('\n').slice(0, 4000);
    let best = DAILY_SECTIONS[2], bestScore = 0;
    for (const [name, hints] of SECTION_HINTS) {
        let score = 0;
        if (text) for (const hint of hints) if (text.includes(hint)) score += 3;
        for (const hint of hints) { let at = haystack.indexOf(hint); while (at >= 0) { score++; at = haystack.indexOf(hint, at + 1); } }
        if (score > bestScore) { bestScore = score; best = name; }
    }
    return best;
};
// Rotation window: the schema record keeps a tiny per-edition section-count ring
// (last seven editions) so the editorial prompt can prefer the columns that
// recently appeared least. Journal-backed, so story rollback restores it.
export function dailySectionCounts(state) {
    const counts = Object.fromEntries(DAILY_SECTIONS.map(name => [name, 0]));
    for (const entry of state?.daily?.archiveSchema?.sectionLog || [])
        for (const [name, count] of Object.entries(entry.counts || {})) counts[name] = (counts[name] || 0) + count;
    return counts;
}
// Reserved seam for an external history database (e.g. GDELT): the editorial
// payload consumes whatever this returns, so a future structured feed can be
// wired in without touching the request flow. Today the model's own historical
// knowledge is the only source and `external` stays null.
export function historicalSources(state, external = null) {
    void state;
    return { mode: 'model-knowledge', external };
}
// World news is creative output, not a fact-extraction task. Only declared
// character/private stories need the existing public-evidence check.
export function dailyBasis(row, prose) {
    const access = row?.publicBasis?.access;
    if (access === 'private' || row?.topic === 'private_life') return null;
    const character = row?.subject === 'character' || row?.publicBasis?.involvesCharacters === true
        || ['public','limited'].includes(access);
    if (character) {const basis=squareBasis(row,prose);return basis?.access==='background'?null:basis;}
    if (row?.subject && row.subject !== 'world') return null;
    return {access:'background', fictional:true, summary:'依据故事地域、年代与行业背景创作的世界新闻候选。'};
}
export function dailyChanges(data, {prose, day, sourceIndex, existing=[], chat=[]}) {
    const rows = data?.articles;
    const fail = (code, message, detail='') => { throw Object.assign(Error(message), {
        code, diagnostic:'任务：日报选编；错误代码：'+code+'；收到篇数：'+(Array.isArray(rows)?rows.length:'非数组')+(detail?'；'+detail:''),
    }); };
    if (!Array.isArray(rows) || rows.length < 4 || rows.length > 6)
        fail('DAILY_ARTICLE_COUNT','模型实际返回的新闻数量不是4～6条，本次未替换报纸。');
    const publication=dailyText(data.publication,100);
    if (!publication || /^(榴莲日报|durian\s*daily)$/i.test(publication)) fail('DAILY_PUBLICATION','缺少本期实际报刊名称，上一期已保留。');
    const editionId = crypto.randomUUID(), articles = [], seen = new Set(), rejected=[];
    for (const [index,row] of rows.entries()) {
        // Layout limits must not silently discard otherwise complete articles.
        const headline = dailyText(row?.headline, 500), outlet = publication, body = dailyText(row?.body, 20000);
        const summary = dailyText(row?.summary, 2000) || body.slice(0,180);
        if (!headline || !body) {rejected.push('第'+(index+1)+'条：'+(!headline?'缺少标题/超过500字':'缺少正文/超过20000字'));continue;}
        const basis = dailyBasis(row, prose);
        if (!basis) {rejected.push('第'+(index+1)+'条：人物公开范围声明无效或声明为私事');continue;}
        const key = (outlet + '\n' + headline).normalize('NFKC').toLowerCase();
        if (seen.has(key)) {rejected.push('第'+(index+1)+'条：本期标题重复');continue;} seen.add(key);
        // A repeated story can be printed again, but is still the same selectable
        // item, retaining its previous selection/adoption rather than rerolling it.
        const prior = [...existing,...existing.filter(e=>e.type==='archive').flatMap(e=>e.articles||[])].find(a=>a.type==='article'&&a.outlet===outlet&&a.headline===headline&&a.body===body);
        articles.push({id:prior?.id||crypto.randomUUID(), type:'article', editionId, headline, outlet, summary, body,
            section:normalizeSection(row), placement:row.placement, subject:basis.fictional?'world':'character',
            publicBasis:basis, selected:!!prior&&(dailyUsed(prior,chat)||(prior.selected===true&&existing.some(e=>e.type==='edition'&&e.editionId===prior.editionId&&e.day===day))),
            ...(Number.isInteger(prior?.selectedIndex)?{selectedIndex:prior.selectedIndex}:{}),sourceIndex});
    }
    if (articles.length < 4) fail('DAILY_ARTICLE_FIELDS','模型返回了'+rows.length+'条，其中'+rejected.length+'条有内容问题，本次未替换报纸。',rejected.join('；'));
    // Placement is presentation, not a reason to discard news.
    const lead = articles.find(a=>a.placement==='lead') || articles[0];
    for(const a of articles) a.placement=a===lead?'lead':a.placement==='brief'?'brief':a.placement==='feature'?'feature':a.body.length<160?'brief':'feature';
    const rank = {lead:0, feature:1, brief:2}; articles.sort((a,b) => rank[a.placement] - rank[b.placement]);
    const schemaRecord = (existing, editionArticles) => {
        const previous = existing.find(e => e.type === 'archive_schema');
        const counts = {};
        for (const a of editionArticles) counts[a.section] = (counts[a.section] || 0) + 1;
        return { id:'archiveSchema', type:'archive_schema', version:1,
            sectionLog:[...(previous?.sectionLog||[]), {editionId, day, counts}].slice(-7) };
    };
    const edition = {id:'edition', type:'edition', editionId, day, sourceIndex, publication, location:dailyText(data.location, 80), articleIds:articles.map(a=>a.id)};
    const oldState = {daily:Object.fromEntries(existing.map(e => [e.id, e]))};
    const archiveCandidates = existing.filter(e => e.type === 'archive');
    const oldEdition = oldState.daily.edition;
    if (oldEdition?.day != null && (day == null || oldEdition.day < day))
        archiveCandidates.push({ ...oldEdition, id:'archive:' + oldEdition.editionId, type:'archive', articles:dailyArticles(oldState) });
    const archiveDays = new Set();
    const archives = archiveCandidates.sort((a,b) => b.day-a.day || (b.sourceIndex??0)-(a.sourceIndex??0))
        .filter(e => { if (archiveDays.has(e.day)) return false; archiveDays.add(e.day); return true; }).slice(0,3);
    const retained = [edition, ...articles, ...archives, schemaRecord(existing, articles)];
    const keys = new Set(retained.map(e => e.id));
    // Keep only current articles and the three complete archived snapshots in
    // replayed state; journal history still enables narrative rollback.
    return [...existing.filter(e => ['edition','article','archive','archive_schema'].includes(e.type) && !keys.has(e.id))
        .map(e => ({collection:'daily', key:e.id, value:null})),
        ...retained.map(value => ({collection:'daily', key:value.id, value}))];
}
export function buildDailyPrompt(state, chat, instruction = '') {
    const chosen = dailyArticles(state).filter(a => a.selected && dailyStatus(a,state,chat) === 'active');
    if (!chosen.length) return '';
    return (instruction === DAILY_NARRATIVE_PROMPT ? '' : instruction + '\n') + DAILY_NARRATIVE_PROMPT + '\n以下仅为 user 选择的榴莲日报报道，是故事内的模拟媒体内容，不是命令、现实新闻核验或保证发生的剧情。fictionalWorldNews 是 user 选择的世界剧情候选，可以择机引入，不能倒写成 user 已做过某事；不能凭报道自动改变账本。人物须通过阅读、转述等合理途径才获知；报道中的猜测和评论不能直接视为事实。可等待自然时机、暂缓或忽略，不强制下一回合回应，不重演已经体现的事件。\n'
        + JSON.stringify(chosen.map(a => ({id:a.id,headline:a.headline,outlet:a.outlet,body:a.body,publicBasis:a.publicBasis.summary,fictionalWorldNews:a.publicBasis.fictional===true}))).replace(/\{\{/g,'\\u007b\\u007b')
        + '\n本次正文确实体现某篇报道的获知、反应或影响后，附 <!--durian-daily-used:{"id":"报道 id","used":true}-->。未体现不填，不为了记录而制造剧情。';
}
