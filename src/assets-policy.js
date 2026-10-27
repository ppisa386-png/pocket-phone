// One boundary for narrative capture and manual assessment; no occupation rules.
export const ASSET_CATEGORY_RULES = '资产只登记 user 已经拥有的财产。fixed 是房产、商铺产权、汽车等大件财产，不是所有耐用品；撬棍等普通工具、日用品、普通衣物和消耗品不列资产，真实消费仍按收支规则记录。luxury 是有依据的高档首饰、名表、名牌鞋包、高定礼服及贵重收藏品；investment 是经营中的产业、股权证券及持续经济权益。商铺产权与店铺经营权益分清，不重复登记。获赠给 user 的合格财产也应登记，只记 asset、不扣余额；金额未知可为 null。新取得的具体财产保留具体名称，不能因旧账有“衣物首饰收藏”等笼统条目就漏掉新物品；同一批物品不同时按整套和单件重复登记。';

const normalize = value => String(value ?? '').normalize('NFKC')
    .replace(/&(?:quot|#34);/g, '"').replace(/&(?:apos|#39);/g, "'").replace(/&amp;/g, '&').replace(/&(?:nbsp|#160);/g, ' ')
    .replace(/<[^>]*>/g, '').replace(/[\s*_`“”‘’"']/g, '');

// Presentation normalization only. Ellipses may join substantial, ordered
// verbatim excerpts; every excerpt must still exist in the same source floor.
export function financialEvidenceMatches(prose, evidence) {
    if (typeof evidence !== 'string') return false;
    const source = normalize(prose), quote = normalize(evidence);
    if (quote.length < 4) return false;
    if (source.includes(quote)) return true;
    const parts = quote.split(/(?:\.{3,}|…+|⋯+)/u);
    if (parts.length < 2 || parts.some(p => p.length < 8) || parts.join('').length < 24) return false;
    let cursor = 0;
    for (const part of parts) {
        const at = source.indexOf(part, cursor);
        if (at < 0) return false;
        cursor = at + part.length;
    }
    return true;
}
