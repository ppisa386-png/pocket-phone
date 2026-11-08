// Curated local artwork from Microsoft Fluent UI Emoji (MIT).
// Only these identifiers are accepted from generated product data.
export const AMAZON_IMAGE_KEYS = Object.freeze([
    'package','mobile','headphone','laptop','shirt','books','lipstick','handbag',
    'dress','game','camera','plant','sunglasses','backpack','shopping',
]);

const hints = [
    ['dress',/连衣裙|长裙|短裙|半身裙|裙装|礼服|晚礼服|\bdress\b|\bskirt\b/i],
    ['backpack',/双肩包|背包|书包|登山包|旅行包|行李箱|拉杆箱|\bbackpack\b|\bsuitcase\b/i],
    ['handbag',/手提包|斜挎包|单肩包|钱包|皮包|托特包|女包|\bhandbag\b|\bpurse\b|\btote\b/i],
    ['headphone',/耳机|耳麦|耳塞|音箱|扬声器|蓝牙音响|\bheadphones?\b|\bearbuds?\b|\bspeakers?\b/i],
    ['laptop',/笔记本电脑|笔记本|台式电脑|显示器|平板电脑|平板|电脑|\blaptop\b|\bmacbook\b|\bmonitor\b|\btablet\b|\bipad\b/i],
    ['mobile',/手机|智能手表|手环|手机壳|充电宝|充电器|数据线|\biphone\b|\bsmartphone\b|\bpixel\b|\bgalaxy\b|\bsmartwatch\b/i],
    ['camera',/相机|摄像机|镜头|拍立得|摄影|数码相机|\bcamera\b|\bgopro\b|\bdslr\b/i],
    ['game',/游戏|游戏机|掌机|手柄|游戏主机|\bconsole\b|\bplaystation\b|\bnintendo\b|\bxbox\b|\bcontroller\b/i],
    ['lipstick',/口红|唇膏|粉底|彩妆|护肤|面霜|精华液|化妆|香水|防晒|\blipstick\b|\bperfume\b|\bskincare\b|\bmakeup\b/i],
    ['sunglasses',/太阳镜|墨镜|眼镜|镜框|\bsunglasses?\b|\beyeglasses\b/i],
    ['plant',/绿植|盆栽|花盆|花卉|园艺|多肉|鲜花|花束|\bplant\b|\bflower\b/i],
    ['books',/书籍|图书|小说|漫画|画册|杂志|教材|文具|钢笔|\bbooks?\b|\bnovel\b|\bnotebook\b/i],
    ['shirt',/T恤|衬衫|卫衣|毛衣|夹克|上衣|外套|牛仔|裤子|服饰|服装|\bt-shirt\b|\bshirt\b|\bhoodie\b|\bjeans\b/i],
    ['shopping',/礼盒|礼物|礼品|套装|杂货|百货|\bgifts?\b|\bbundle\b/i],
];

export function shopImageKey(image, description = '') {
    if (typeof image === 'string' && AMAZON_IMAGE_KEYS.includes(image)) return image;
    const text = String(description || '');
    for (const [key,pattern] of hints) if (pattern.test(text)) return key;
    return 'package';
}

export function shopImageSrc(image) {
    const key = shopImageKey(image);
    return new URL('../assets/amazon-icons/' + key + '.svg', import.meta.url).href;
}
