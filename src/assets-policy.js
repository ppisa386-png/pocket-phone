// One boundary for narrative capture and manual assessment; no occupation rules.
export const ASSET_CATEGORY_RULES = '资产只登记 user 已经拥有的财产。fixed 是房产、商铺产权、汽车等大件财产，不是所有耐用品；撬棍等普通工具、日用品、普通衣物和消耗品不列资产，真实消费仍按收支规则记录。luxury 是有依据的高档首饰、名表、名牌鞋包、高定礼服及贵重收藏品；investment 是经营中的产业、股权证券及持续经济权益。商铺产权与店铺经营权益分清，不重复登记。获赠给 user 的合格财产也应登记，只记 asset、不扣余额；金额未知可为 null。新取得的具体财产保留具体名称，不能因旧账有“衣物首饰收藏”等笼统条目就漏掉新物品；同一批物品不同时按整套和单件重复登记。';

export const ASSET_ITEM_RULES = '实物财产按独立物品登记：一件物品一个条目、一个名称、一个单独估值；一双鞋/一副眼镜等自然成对物品算一件。手袋、鞋、香水、礼服即使同店同单购买也必须分开，不写“手袋与其余两只手袋”“太阳镜及高跟鞋与香水”等合并名称，不用一笔总估值代表不同物品。正文明确有多个同类物品时分别列条目，可用原文颜色/款式区分；未给细节用编号区分，不编造型号材质。只提购物袋且未说明内容的，不据袋数虚构物品。'
    + '品牌结合连续购物上下文判断，追踪进店、换店、试用、结账和物品指代：明确在某品牌专卖店或单一品牌专柜买下的物品，未出现换店或其他品牌信息时沿用该品牌，不因后句省略品牌就写成泛称，也不凭空更换品牌。例如在品牌甲专卖店买手袋并买高跟鞋，分别登记“品牌甲手袋”“品牌甲高跟鞋”。换店后不继续套用上一家品牌。商场、机场免税区、百货或多品牌集合店本身不代表同一品牌；明确商品品牌优先，确实无法判断才保留未知，不猜牌子、具体系列或型号。'
    + '品牌判断可参考前后文，但evidence必须保留实际取得事实的原文，不为补品牌改写引文；已知品牌及推断依据可记入details。整体交易现金只记一次，拆分物品不等于拆出多笔相同总价支出；只有总付款金额时保留一条消费，财产按独立asset且amount:null登记，各自marketValue按正常价值估算，不把整单金额复制给每件。正文阶段不自行估价，未知金额留null，单件估价交给一键更新。获赠仅登记资产、不扣余额。已有整组与单件不得重复登记，不用新增单件绕过既有合并资产的防重规则。';


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
