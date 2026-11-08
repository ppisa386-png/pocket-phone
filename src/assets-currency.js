import { assetSet, cashBalance } from './assets-core.js?v=1.2';
import { walletCurrency, unitScale } from './currency.js?v=1.2';

// Re-denominate a settled wallet only at a rate explicitly supplied by the
// player. The journal keeps the previous projection and rolls back the batch.
export function changeWalletCurrency(state, residence, rawRate) {
    const from=walletCurrency(state), to=residence.currency;
    if (!from || from===to) throw Error('账本币种没有变化。');
    const rate=Number(rawRate);
    if (!/^\d{1,10}(?:\.\d{1,10})?$/.test(String(rawRate).trim()) || !(rate>0)) throw Error('请输入有效换算比例。');
    if (['snapchat','whatsapp','wechat'].some(app=>Object.values(state[app]||{}).some(t=>t.type==='transfer' && t.currency===from && t.status==='pending' && t.direction==='outgoing')))
        throw Error('请先处理旧币种的待收转账，再换币。');
    const [whole,fraction='']=String(rawRate).trim().split('.');
    const numerator=BigInt(whole+fraction)*BigInt(unitScale(to));
    const denominator=10n**BigInt(fraction.length)*BigInt(unitScale(from));
    const convert=value=>{
        const units=(BigInt(Math.abs(value))*numerator+denominator/2n)/denominator;
        const n=Math.sign(value)*Number(units);
        if (!Number.isSafeInteger(n)) throw Error('换算金额超出账本范围。');
        return n;
    };
    const changes=[], oldBalance=cashBalance(state), wallet=state.assets.wallet;
    let includedTotal=0;
    const included=new Set(wallet.included||[]);
    for (const record of Object.values(state.assets)) {
        if (record.id==='wallet') continue;
        if (record.currency && record.currency!==from) {
            if (record.type==='cash_transaction') included.add(record.id);
            continue;
        }
        const value={...record};
        const fields=Object.keys(value).filter(k=>k.endsWith('Minor')&&Number.isSafeInteger(value[k]));
        if (!fields.length && record.type!=='story_event') continue;
        for (const key of fields) value[key]=convert(value[key]);
        value.currency=to;
        if (value.type==='cash_transaction') {
            value.originalMoney ??= {currency:from,deltaMinor:record.deltaMinor};
            if (!included.has(value.id)) includedTotal+=value.deltaMinor;
        }
        changes.push(assetSet(value));
    }
    const openingMinor=convert(oldBalance)-includedTotal;
    if (!Number.isSafeInteger(openingMinor) || !Number.isSafeInteger(includedTotal)) throw Error('换算金额超出账本范围。');
    const settlement=wallet.settlement?{...wallet.settlement}:null;
    if(settlement)for(const key of Object.keys(settlement))if(key.endsWith('Minor'))settlement[key]=convert(settlement[key]);
    changes.push(assetSet({...wallet,currency:to,region:residence.region,personaStamp:residence.personaStamp,openingMinor,settlement,included:[...included],
        currencyChanges:[...(wallet.currencyChanges||[]),{from,to,rate,balanceBeforeMinor:oldBalance,day:wallet.lastDay}]}));
    return changes;
}
