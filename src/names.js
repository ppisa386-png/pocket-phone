// Shared display-name rules. Original names stay as aliases for identity lookup.
export const CHINESE_NAME_RULE = '\n手机姓名显示规则（所有 App 共用）：电话簿、短信联系人、好友、关注列表及账号显示姓名一律用中文。外文姓名优先采用人物设定/人设/世界书中已经使用的中译名，完整照用，不擅自换译名；没有中译名才按原姓名音译成中文。同一人只保留一个中文姓名，不能中英文各返回一个联系人，也不要在显示姓名中附英文括号。人物或地点联系人的 name 填中文显示名，aliases 数组保留原文姓名及设定已有别名，供识别同一人物。地点联系人的名称也用中文。商品名、品牌名不属于此规则。此规则只控制姓名标签，不改变短信、帖子、对白等内容所遵循的酒馆预设语言；handle/@账号、内部 id 和 user 自己设置的网名保持原值，不翻译或改写。';

const key = s => String(s || '').normalize('NFKC').trim().toLowerCase().replace(/[\s·.・'’_-]/g,'');
const han = s => /\p{Script=Han}/u.test(s || '');
export const nameAliases = item => [...new Set([item?.name,...(Array.isArray(item?.aliases) ? item.aliases : [])].filter(n => typeof n === 'string' && n.trim()).map(n => n.trim().slice(0,100)))];
export function sameNamedPerson(a,b) {
    const keys = nameAliases(a).map(key);
    return nameAliases(b).some(n => keys.includes(key(n)));
}
export function localizedPerson(item, context, existing = []) {
    const aliases = nameAliases(item), probe = {aliases};
    const cards = (context.characters || []).map((c,index) => ({c,index})).filter(({c}) => sameNamedPerson(probe,c));
    const card = cards.length === 1 ? cards[0] : null;
    const old = [...new Map(existing.filter(c => sameNamedPerson(probe,c)).map(c => [c.id,c])).values()];
    const known = old.length === 1 ? old[0] : null;
    const material = [context.powerUserSettings?.persona_description,...(context.characters || []).flatMap(c => {
        const d = c.data || c;
        return [c.name,d.description,d.personality,d.scenario,...(d.character_book?.entries || []).filter(e => e.enabled !== false).map(e => e.content)];
    })].filter(Boolean).join('\n');
    const chinese = aliases.filter(han);
    const name = (han(card?.c.name) ? card.c.name : null) || chinese.find(n => material.includes(n)) || (han(known?.name) ? known.name : null) || chinese[0] || aliases[0] || '';
    return {name,aliases:[...new Set([...aliases,...nameAliases(known),...(card ? [card.c.name] : []),name])],cardIndex:card?.index ?? null,cardId:card ? 'card:' + (card.c.avatar || card.c.name) : null,existingId:known?.id ?? null};
}
