// Modern legal tender by territory, from Unicode CLDR supplemental currencyData
// (2026-11-01). Several territories have more than one local currency.
const territories = {
    AED: 'AE',
    AFN: 'AF',
    ALL: 'AL',
    AMD: 'AM',
    AOA: 'AO',
    ARS: 'AR',
    AUD: 'AU CC CX HM KI NF NR TV',
    AWG: 'AW',
    AZN: 'AZ',
    BAM: 'BA',
    BBD: 'BB',
    BDT: 'BD',
    BHD: 'BH',
    BIF: 'BI',
    BMD: 'BM',
    BND: 'BN',
    BOB: 'BO',
    BRL: 'BR',
    BSD: 'BS',
    BTN: 'BT',
    BWP: 'BW',
    BYN: 'BY',
    BZD: 'BZ',
    CAD: 'CA',
    CDF: 'CD',
    CHF: 'CH LI',
    CLP: 'CL',
    CNY: 'CN',
    COP: 'CO',
    CRC: 'CR',
    CUP: 'CU',
    CVE: 'CV',
    CZK: 'CZ',
    DJF: 'DJ',
    DKK: 'DK FO GL',
    DOP: 'DO',
    DZD: 'DZ',
    EGP: 'EG',
    ERN: 'ER',
    ETB: 'ET',
    EUR: 'AD AT AX BE BG BL CY DE EA EE ES EU FI FR GF GP GR HR IC IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT',
    FJD: 'FJ',
    FKP: 'FK',
    GBP: 'GB GG GS IM JE TA',
    GEL: 'GE',
    GHS: 'GH',
    GIP: 'GI',
    GMD: 'GM',
    GNF: 'GN',
    GTQ: 'GT',
    GYD: 'GY',
    HKD: 'HK',
    HNL: 'HN',
    HTG: 'HT',
    HUF: 'HU',
    IDR: 'ID',
    ILS: 'IL PS',
    INR: 'BT IN',
    IQD: 'IQ',
    IRR: 'IR',
    ISK: 'IS',
    JMD: 'JM',
    JOD: 'JO PS',
    JPY: 'JP',
    KES: 'KE',
    KGS: 'KG',
    KHR: 'KH',
    KMF: 'KM',
    KPW: 'KP',
    KRW: 'KR',
    KWD: 'KW',
    KYD: 'KY',
    KZT: 'KZ',
    LAK: 'LA',
    LBP: 'LB',
    LKR: 'LK',
    LRD: 'LR',
    LSL: 'LS',
    LYD: 'LY',
    MAD: 'EH MA',
    MDL: 'MD',
    MGA: 'MG',
    MKD: 'MK',
    MMK: 'MM',
    MNT: 'MN',
    MOP: 'MO',
    MRU: 'MR',
    MUR: 'MU',
    MVR: 'MV',
    MWK: 'MW',
    MXN: 'MX',
    MYR: 'MY',
    MZN: 'MZ',
    NAD: 'NA',
    NGN: 'NG',
    NIO: 'NI',
    NOK: 'BV NO SJ',
    NPR: 'NP',
    NZD: 'CK NU NZ PN TK',
    OMR: 'OM',
    PAB: 'PA',
    PEN: 'PE',
    PGK: 'PG',
    PHP: 'PH',
    PKR: 'PK',
    PLN: 'PL',
    PYG: 'PY',
    QAR: 'QA',
    RON: 'RO',
    RSD: 'RS',
    RUB: 'RU',
    RWF: 'RW',
    SAR: 'SA',
    SBD: 'SB',
    SCR: 'SC',
    SDG: 'SD',
    SEK: 'SE',
    SGD: 'SG',
    SHP: 'AC SH',
    SLE: 'SL',
    SOS: 'SO',
    SRD: 'SR',
    SSP: 'SS',
    STN: 'ST',
    SYP: 'SY',
    SZL: 'SZ',
    THB: 'TH',
    TJS: 'TJ',
    TMT: 'TM',
    TND: 'TN',
    TOP: 'TO',
    TRY: 'TR',
    TTD: 'TT',
    TWD: 'TW',
    TZS: 'TZ',
    UAH: 'UA',
    UGX: 'UG',
    USD: 'AS BQ DG EC FM GU HT IO MH MP PA PR PW SV TC TL UM US VG VI ZW',
    UYU: 'UY',
    UZS: 'UZ',
    VES: 'VE',
    VND: 'VN',
    VUV: 'VU',
    WST: 'WS',
    XAF: 'CF CG CM GA GQ TD',
    XCD: 'AG AI DM GD KN LC MS VC',
    XCG: 'CW SX',
    XOF: 'BF BJ CI GW ML NE SN TG',
    XPF: 'NC PF WF',
    YER: 'YE',
    ZAR: 'LS NA ZA',
    ZMW: 'ZM',
    ZWG: 'ZW',
};
export const RESIDENCE_RULE = '根据 user 人设及当前酒馆上下文里 user 长期居住、定居、工作学习和日常生活的环境，确定常住地区和当地通货。首次地区判断依据人设、可见剧情与近期正式摘要。明确的当前生活环境优先于过时设定。没有准确的国家或城市名称时，允许结合人物姓名、生活方式、学校与工作制度、社会文化及日常环境智能推断。例如人物普遍使用中国名字，整体生活环境也明显符合中国，即使没有写出中国或具体中国城市名，也可判断为中国；其他国家和地区同理。不能仅因为正文使用中文就判断为中国；明确的国外生活背景优先于姓名线索。旅游、出差或他人所在地不等于user常住地。返回residence:{region:两位地区代码,currency:当地三位货币代码,place:判断出的国家或地区或城市,inferred:是否基于环境推断,reason:简述判断依据,evidence:可选的原文片段数组}。place允许填写推断出的真实地区，不要求该地名逐字出现在原文；可以只确定国家或地区，不必编造具体城市。推断时inferred:true、reason说明所用环境线索，evidence可省略，不把推断结论伪装为原文引文。直接引用明确地点时inferred:false，evidence填写原文片段，可来自人设或近期多轮正文；不要求原文出现国家全名或“常住”二字。综合资料仍无法合理判断时返回residence:null，不按正文语言默认币种。';
// Compare quoted facts, tolerating display markup/spacing but never paraphrase.
function residenceText(value) {
    return String(value||'').normalize('NFKC').replace(/<[^>]*>/g,' ')
        .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
        .replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,'').trim();
}
function residenceQuotes(value, sources) {
    const quotes=Array.isArray(value)?value:[value];
    if(!quotes.length||quotes.length>12) return null;
    const matched=[];
    for(const quote of quotes){
        if(typeof quote!=='string')return null;
        const text=residenceText(quote);
        if(text.length<2)return null;
        if(sources.some(source=>source.includes(text))){matched.push(quote);continue;}
        const parts=quote.split(/(?:…+|\.{3,}|\r?\n)+/).map(residenceText).filter(Boolean);
        if(parts.length<2||parts.some(part=>part.length<2||!sources.some(source=>source.includes(part))))return null;
        matched.push(...parts);
    }
    return matched.join('\n');
}
export function resolveResidence(value, persona, prose, { allowInference = false } = {}) {
    if (value == null) return null;
    const region=String(value.region||'').trim().toUpperCase(), currency=String(value.currency||'').trim().toUpperCase();
    const sources=[persona,...prose.map(p=>p.text)].filter(text=>typeof text==='string').map(residenceText);
    const evidence=residenceQuotes(value.evidence,sources);
    if (!Object.hasOwn(territories,currency) || !region || !territories[currency].split(' ').includes(region))
        throw Error('常住地区与当地币种不匹配，本次未保存。');
    // Initial assessment may infer geography from the overall living setting.
    // Keep inference separate from a purported literal quotation.
    if(allowInference && value.inferred===true){
        if(!sources.some(Boolean) || typeof value.reason!=='string' || !value.reason.trim())throw Error('请说明根据人设与近期生活环境推断常住地区的理由。');
        return {region,currency};
    }
    if (!evidence)
        throw Error('无法在 user 人设或正文中核对常住地依据，本次未保存。');
    // A sentence written in a particular language is not a location.
    // Accept an omitted place only if the cited text itself names the region.
    const names=['zh-Hans','zh-Hant','en'].map(locale=>new Intl.DisplayNames(locale,{type:'region'}).of(region));
    const shortNames={HK:['香港','Hong Kong'],MO:['澳门','澳門','Macau','Macao'],TW:['台湾','台灣','Taiwan']};
    const place=typeof value.place==='string' ? value.place.trim() : [...names,...(shortNames[region]||[])].find(name=>evidence.includes(name));
    if (!residenceText(place) || !residenceText(evidence).includes(residenceText(place)) || /^(?:中文|汉语|日语|英语|普通话|Chinese|Japanese|English)$/i.test(place))
        throw Error('常住地依据中缺少可核对的地点，请提供人设或正文中的城市或地区原名。');
    // Reject citations that only describe a language, nationality or visit.
    // Mixed evidence is allowed when it actually describes where user lives.
    if (/(?:旅行|旅游|出差|度假|说中文|中文写作|使用中文|国籍|Nationality\s*[:：]|speaks? (?:Chinese|Japanese)|on vacation|business trip)/i.test(evidence) &&
        !/(?:常住|居住|生活在|定居|搬家|迁居|住所|家住|长住|工作地|就读|上学|开学|高[一二三]|毕业班|学校|校门|校园|任职|上班|通勤|租住|租房|attends?|school|stud(?:y|ies|ying)|works? in|lives? in|resides?|based in|moved to|home is)/i.test(evidence))
        throw Error('依据只说明语言、国籍或临时停留，请提供 user 常住地。');
    return {region,currency};
}
export const walletCurrency = state => state.assets?.wallet ? state.assets.wallet.currency || 'USD' : null;
export const validCurrency = code => Object.hasOwn(territories,code);
export function currencyDigits(code) {
    return new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits;
}
export const unitScale = code => 10 ** currencyDigits(code);
export const majorAmount = (minor,code) => minor/unitScale(code);
export function formatMoney(minor,code) {
    if (!code) return '—';
    return new Intl.NumberFormat('zh-CN',{style:'currency',currencyDisplay:'narrowSymbol',currency:code}).format(majorAmount(minor,code));
}

// Only an invalidation marker, not another stored copy of the persona.
export function personaStamp(persona='') {
    let hash=2166136261;
    for (let i=0;i<persona.length;i++) hash=Math.imul(hash^persona.charCodeAt(i),16777619);
    return (hash>>>0).toString(36);
}
