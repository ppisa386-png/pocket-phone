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
export const RESIDENCE_RULE = '根据 user 人设及正文里 user 长期居住、定居、工作学习和日常生活的地点确定常住地区和当地通货。当前真实定居情况优先于过时设定；短期旅游、出差、国籍、char 所在地、姓名、正文语言、界面语言均不是判据。香港、澳门、台湾等按各自地区的货币处理。无法确定就返回 residence:null，不猜美元或人民币。能够确定则返回顶层 residence:{region:两位地区代码,currency:当地三位货币代码,place:依据原文中常住的城市或地区原名,evidence:人设或正文中支持 user 常住地的逐字原句}。';
export function resolveResidence(value, persona, prose) {
    if (value == null) return null;
    const region=String(value.region||'').trim().toUpperCase(), currency=String(value.currency||'').trim().toUpperCase();
    const evidence=typeof value.evidence==='string'?value.evidence.trim():'';
    if (!Object.hasOwn(territories,currency) || !region || !territories[currency].split(' ').includes(region))
        throw Error('常住地区与当地币种不匹配，本次未保存。');
    if (evidence.length<2 || ![persona,...prose.map(p=>p.text)].some(text=>typeof text==='string'&&text.includes(evidence)))
        throw Error('无法在 user 人设或正文中核对常住地依据，本次未保存。');
    // A sentence written in a particular language is not a location.
    // Accept an omitted place only if the cited text itself names the region.
    const names=['zh-Hans','zh-Hant','en'].map(locale=>new Intl.DisplayNames(locale,{type:'region'}).of(region));
    const shortNames={HK:['香港','Hong Kong'],MO:['澳门','澳門','Macau','Macao'],TW:['台湾','台灣','Taiwan']};
    const place=typeof value.place==='string' ? value.place.trim() : [...names,...(shortNames[region]||[])].find(name=>evidence.includes(name));
    if (!place || !evidence.includes(place) || /^(?:中文|汉语|日语|英语|普通话|Chinese|Japanese|English)$/i.test(place))
        throw Error('常住地依据中缺少可核对的地点，请提供人设或正文中的城市或地区原名。');
    // Reject citations that only describe a language, nationality or visit.
    // Mixed evidence is allowed when it actually describes where user lives.
    if (/(?:旅行|旅游|出差|度假|说中文|中文写作|使用中文|国籍|speaks? (?:Chinese|Japanese)|on vacation|business trip)/i.test(evidence) &&
        !/(?:常住|居住|生活在|定居|搬家|迁居|住所|家住|长住|工作地|就读|通勤|租住|租房|lives? in|resides?|based in|moved to|home is)/i.test(evidence))
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
