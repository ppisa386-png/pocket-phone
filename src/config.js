export const MODULE_KEY = 'personal_pocket_phone';
export const LAUNCHER_SIZE = 36;
export const VERSION = '0.24.17';
export const APPS = [
    { id: 'phone', name: '电话', color: '#25ad75', dock: true },
    { id: 'messages', name: '短信', color: '#3289d9', dock: true },
    { id: 'snapchat', name: 'Snapchat', color: '#ffe34d' },
    { id: 'x', name: 'X', color: '#252733' },
    { id: 'daily', name: '榴莲日报', color: '#b66b3e' },
    { id: 'assets', name: '小榴莲', color: '#739c45' },
    { id: 'amazon', name: 'Amazon', color: '#e89947' },
];
export const PROMPTS = {
    daily: {name:'榴莲日报 · 新闻选编',text:'按近期剧情的地域、机构与行业线索创作4～6条世界新闻候选，可虚构正文尚未发生的公共事件；不能虚构 user 的行为和经历。选取符合年代的实际报刊名，版面有大小长短；普通人的车、衣着和日常行踪不凑新闻。仅手动选择的报道供正文择机采用，语言跟随预设。'},
    dailyStory: {name:'榴莲日报 · 已选报道与正文',text:'仅把 user 手动选中的有效报道作为参考，人物按合理知情途径择机回应。允许暂缓，不强制反应；媒体观点不等于事实，不重复已采用的内容。'},
    assetStory: {name:'小榴莲 · 正文记账',text:'出行、衣着及新增消费参考当前经济情况，保留人设和历史明确支持的已有财物，不把现金少等同于没有资产。可用资金不足时不写成已付清，确有借贷依据才写欠款。只记录本次正文已发生的 user 收支、财产和工作变化；不为记账添加交易，不估价、不计算盈亏，金额不明留空。有变化才记录，无事不写。'},
    assetAssessment: {name:'小榴莲 · 账本评估',text:'根据人设、性格、年代、地区、剧情日期和有效记忆合理评估财富。普通生活开销包含饮食、交通和有依据的居住费用，节省者少、奢侈者适度多；奢侈品购置单独记账。没有房产不自动认定租房。投资收益不强制为正，不预测当前剧情日期以后的历史。只更新确有变化的项目，避免重复收支。'},
    establishedContacts: {name:'一键新增联系人',text:'批量加入人物设定中在故事开始前就与 user 存在明确关系的具名人物，正面和负面关系一视同仁。不要求交换号码剧情，不审查取号资格；排除无名人物和仅一面之缘的路人。没有提供号码数字时保留空号码，不编造。'},
    xStyle: {name:'X · 欧美表达风格',text:'这是符合故事地域和年代的 X/Twitter 公开表达，不套中国微博博主文案。各作者有自己的年龄、社群、职业和口吻：有人只写半句/一句冷幽默，有人随手吐槽、直接提问或引用回应，有人认真评价或写较长意见；长短、大小写、标点、段落自然错落，不要每帖同一字数、相同句式或都以感叹收尾。多数帖子可以完全没有 emoji，少数作者偶尔自然使用；禁止每条末尾统一缀两三个 emoji 或标签。可以有克制的讽刺、干巴巴的笑话、具体细节和不完整口语，不把所有人写成同一种网络俚语，不强行让各国人说美国年轻人 slang。避开家人们、姐妹们、谁懂啊、狠狠、绝绝子、氛围感拉满等中国平台套话。品牌/机构、乐评人、当地居民与粉丝表达应有区别。地域口语、拼写习惯和时效梗需符合故事设定；不加时代不符的梗。语言仍严格遵循酒馆预设：英文预设写自然英文，中文预设写保留原地域语气的自然中文，不擅自强制英语。生成前检查整批帖子是否像同一人批量写作并自行修正，不展示检查过程。'},
    xOpinion: {name:'X · 已选帖子与正文',text:'只把 user 手动选择且仍有效的广场内容作为参考。人物经合理途径获知后可择机回应，不强制下一轮体现；传闻不是事实，不重复采用。'},
    storyContact: {name:'正文来电与短信',text:'正文决定实际发生的通信，小手机只保存记录。结合人设、关系、世界观、当前场景和已经发生的手机交流判断联系动机与获取号码的合理途径，不限恋人或既有好友，不要求专门的交换号码情节。日常问候、追求、打听消息、分享或事务都可以，也可以不联系。接听或拒接依正文的扮演规则与当前剧情决定，不凭空替 user 作决定。只记录本次 user 确实发出或收到的短信及拨出或接到的电话，不记录其他人物之间的通信，不重演旧记录、不以记录指令代替正文。'},
    contactEvent: { name: '联系事件与后续反应', text: '依据角色设定、当前剧情与 user 的反应，自行决定是否联系、继续联系、等待或结束。没有固定联系间隔，不预设拒接或沉默后必须停止，也不预设任何性格或分手情节必然导致纠缠。每步仅选择一次来电、一条短信、等待或结束；不能绕过拉黑，不替 user 发言，不预生成一串后续。' },
    incomingMessages: { name: '主动短信', text: '依据角色设定、双方关系、当前剧情和已有通信，自行判断是否主动发短信。可以联系，也可以等待或不联系；不设固定间隔，未回复时是否再次联系由角色当下动机决定。不得替 user 发言或绕过拉黑。消息语言与角色表达习惯遵循酒馆预设。' },
    incoming: { name: '主动来电', text: '依据角色性格、双方关系、剧情时间和已有通信决定是否来电。想念、关心、分享生活、异地伴侣的日常联络都是合理动机，不必等危机或新任务；也不因恋人标签强制每次联系。角色必须有已知 user 号码或可用获取途径的依据，可核对正文、人设、当前角色卡及当前聊天的有效记忆。设定中已建立正常电话联络的亲友无需重新交换号码；仅单向知晓、暗恋、匿名关系或知名度不等于已知号码，失联、秘密身份、无法通信等当前设定优先。共友需有依据且确实能提供号码；公开渠道需可访问。不打断面对面交流，不重复正文已发生的联系。' },
    continuity: { name: '通信与正文衔接', text: '以下是 user 手机中已经发生的通信，作为有效剧情事实供后续正文参考。各人物只知道本人参与或有正当途径获知的内容，不能自动知道 user 与其他人的私聊；匿名社交仍须保留身份边界。忠实保留原话、双方身份及顺序，不得篡改或编造 user 既往发言。承接最新通信后的剧情与时间，不重演旧消息、不强制提起。叙事语言仍遵循酒馆预设。' },
    contacts: { name: '联系方式识别', text: '点击新增联系人时，先结合当前剧情、角色设定及可用记忆判断电话是否仍可使用。亲友不能仅凭关系自动加入，已死亡或丧尸化且失去通信能力等应排除；普通暂时未接电话不等于永久不可联系。识别已实际交付的私人号码及地点座机、临时电话和分机，数字仅被叙述而未列出时用 null。地点电话按有依据的区域或机构命名，不冒充目标人物的私人号码，不编造区域名。引用原文验证获取资格，不从社媒或摘要凭空授予号码。' },
    general: { name: '通用', text: '这是 user 的个人手机，所有互动均为文字扮演。继承酒馆当前角色卡、相关世界书、有效剧情与预设中的内容语言要求。界面标签使用中文。不得替 user 编造消息或决定。仅使用对应角色有依据获知的信息；未获知的私人内容不得跨角色、跨平台传播。' },
    phone: { name: '电话', text: '通过文字表现电话交流，只描写对白、可听见的语气、停顿和背景声音。不得描写通话另一端不可见的表情、动作、服装或内心活动。电话对应真实身份。user 仅能拨打已保存的电话联系人，包括正文获得号码或人设中既有亲友。char 发起来电必须有获取 user 号码的有效途径和依据。' },
    messages: { name: '短信', text: '以短信内容进行交流，继承角色的表达习惯及酒馆预设的语言要求。短信号码与真实身份绑定。依据已保存的电话联系人互动，包括正文获得号码或 user 人设中的既有亲友，不凭空补全号码。不得替 user 发送短信。' },
    snapchat: { name: 'Snapchat', text: '生成 Snapchat 内的文字互动，区分好友邀请、私聊、Snap 与 Stories。遵守好友及内容可见范围。知道账号不代表知道真实身份；不得因为后台存在对应关系而认出匿名 user。已在有效剧情中确认的身份不会因改名而遗忘。' },
    x: { name: 'X', text: '生成 X 的帖子、回复或私信，遵循角色设定和酒馆预设的内容语言。char 默认使用真名账号。公开帖子可以被发现并互动，发现账号不等于知道账号背后的真实身份。私信遵守联系与可见范围。禁止把私人谈话直接当作公众已知信息。' },
    xSquare: { name: 'X 广场', text: '生成符合当前世界观、地域和年代的普通网友日常帖子，无需关注，不使用 user、char 或正文已有具名人物作为发帖者。联系近期地点和公开生活，不围绕 user 转；公共场所也不必有目击，私密场所更不应自动被看见，禁止传播私聊、秘密、内心或未公开关系。没有合理公开素材时写普通背景或留空，不制造热搜、舆论任务。帖子长短与语气自然有差异，语言遵循酒馆预设。' },
    xInteractions: { name: 'X 评论与热度', text: '热度结合作者知名度、影响范围、社交关系、事件公开程度及帖子内容判断。名人也有冷帖，普通人的帖子也可能受到关注。评论可来自有依据的亲友、同行或符合世界观的陌生网友，评论者可以互相讨论，但不能编造公众已知的私事或识破匿名 user。作者是否回复、回复谁完全根据人设与当前剧情，可以一条都不回复，不设最低回复数量。观点和语气自然多样，不强行制造争议，不替 user 发言。' },
    amazonShopping: { name: 'Amazon · 商品推荐', text: '依据当前世界观、年代、地区及货币生成购物推荐；不能在旧时代出现尚未问世的商品或品牌。先满足 user 本次输入的分类、用途、预算和具体偏好，再参考人设、有效剧情及已有资产所体现的消费水平。普通收入者默认推荐负担得起的日常商品，富裕人物默认推荐符合生活水准的品质或奢侈商品；不要给普通打工者默认推荐梵克雅宝，也不要给大小姐默认推荐二十元基础 T 恤。但 user 明确找平价、折扣或昂贵商品时尊重其选择。财富不明时提供合理价格梯度，不能擅自认定其有钱或贫穷。奢侈品必须写出时代正确的品牌名、具体系列或款式，说明材质与特色，不能只写高级项链或名牌包。架空世界优先使用世界设定中的品牌；未设定时可生成贴合世界的品牌。推荐同类中有差异的具体商品，价格与货币统一合理，买家评论简短有差异，不全是夸赞；评论与商品说明遵循酒馆预设语言。商品只能推荐，不能替 user 下单、付款或确认收货。' },
    amazonDelivery: { name: 'Amazon · 送货到正文', text: '订单按剧情日期在下单两天后的白天配送，工作时间为 09:00—18:00。到期后结合当下场景，把快递抵达、门铃或投递通知等实际到货事件自然写入正文。日期已跳过配送日则在后续合适的白天送达。礼物送到指定收件人处，不能变成送给 user；人物只能获知其有合理渠道知道的内容。不提前送货，不在半夜配送，不重复已送达的订单，不强迫 user 签收、拆包或作出反应，不接管物品栏。' },
    amazon: { name: 'Amazon', text: '生成故事世界中的虚拟商品及订单内容，使用已确定的剧情背景、商品和货币信息。所有订单均为故事内模拟，不进行真实购买。订单和地址是私人信息，未获知的角色不得自动知晓。' },
};

const PREVIOUS_BRIDGE_PROMPTS = {"xSquare":"生成符合当前世界观、地区和文化的随机网友帖子，不使用已有 char、user 或正文已有具名人物作为发帖者。紧密联系近期剧情涉及的地点、事件、作品和社会环境，体现公共生活与舆论变化，但不围绕 user 转、不复述正文。网友只能谈论有合理渠道知道的事情，不泄露私聊、秘密、内心或未公开关系。公园约会可以对应游客见闻和合理偶遇，目击者未必认识当事人；发行唱片可以对应听众和乐评人的作品评价。热度符合事件公开程度和影响范围，小事不强行变热搜；观点自然有差异，不强行争议或统一吹捧贬低。内容语言遵循酒馆预设。","xOpinion":"区分普通讨论与可能影响后续剧情的公共议题。几条零散游客感想、普通夸赞或吐槽不形成舆情。已有传播、可信报道、集中争议、圈内明显评价转向、公开回应或组织行动等，且有具体受影响对象/事项，才记录实质舆情。影响可以只是本地或小圈子，不以固定点赞门槛强造热搜，不把高赞本身等同危机。只能从已公开信息或有根据的传闻发展，明确不确定性，不泄露私聊、未公开关系或人物内心。记录已经形成的讨论事实及可能影响，后续由正文依人物知情途径和合适时机选择回应，不强制下一回合立即触发，不重复制造已经写过的事件。","continuity": "以下是当前角色已经亲自参与的手机通信，作为有效剧情记忆供后续正文参考。继续当前剧情，不重演整段通信，不把记录原样贴回正文，不强行让角色提起。保持通信中的约定、已交换的信息和人物关系；措辞、叙事与语言仍遵循酒馆预设和角色设定。短信和电话绑定真实身份；其他角色没有自动获知这些私人交流。不要把电话中未见的画面补成已知事实。", "storyContact": "正文决定实际发生的通信，小手机只保存记录。结合人设、关系、世界观、当前场景和已经发生的手机交流判断联系动机与获取号码的合理途径，不限恋人或既有好友，不要求专门的交换号码情节。日常问候、追求、打听消息、分享或事务都可以，也可以不联系。接听或拒接依正文的扮演规则与当前剧情决定，不凭空替 user 作决定。只记录本次确实发生的来电与收到的短信，不重演旧记录、不以记录指令代替正文。"};

const PREVIOUS_INCOMING_PROMPT = '只在剧情中有合理动机且角色有可用途径取得 user 号码时发起来电。必须核对正文依据，不能因为 user 知名就凭空知道号码，不能把 user 单方面知道角色号码当成双方交换。共友需要明确存在且确实能提供号码；公开渠道需要正文确认号码可被访问。不强行制造来电，不重复已在正文中完成的电话。';
const LEGACY_PROACTIVE_PROMPTS = {"phone": "通过文字表现电话交流，只描写对白、可听见的语气、停顿和背景声音。不得描写通话另一端不可见的表情、动作、服装或内心活动。电话对应真实身份。user 仅能拨打在有效剧情中已获得的号码。char 发起来电必须有获取 user 号码的有效途径和依据。", "messages": "以短信内容进行交流，继承角色的表达习惯及酒馆预设的语言要求。短信号码与真实身份绑定。仅依据有效剧情中获取的联系方式互动，不凭空补全号码。不得替 user 发送短信。", "contacts": "仅记录正文中 user 已实际获得的电话号码或明确完成的交换号码事件。只有索取意图、尚未给出的请求、他人的私密号码、char 单方面得知 user 号码均不符合。给出连续的逐字正文证据，证据应同时指明对方身份和号码归属，不得仅摘一个号码。不同人物各只有一个电话号码，不编造获取渠道。", "contactEvent": "日常联系保持低频。仅当有效剧情中的具体冲突、紧急事件或正在进行的交流确实需要角色立即反应时，判断是否开启或继续同一联系事件。完全依据角色设定及当下反应，不能看到分手就默认纠缠，不能靠偏执或占有欲标签决定行为。每步只选择一次来电、一条短信、等待或结束；根据 user 的拒接、回复、沉默判断下一步，可改渠道但不得绕过拉黑。解决、放弃或转场时结束事件。不得替 user 发言，不预生成一串后续。", "incomingMessages": "默认不主动发短信。仅在需要兑现具体约定、告知新情况或处理确有时效的问题时，发送一条简洁短信。不以想念、闲聊、刷存在感反复打断正文。避免重复已经说过的内容；未收到回复时不要追发。消息语言与角色表达习惯遵循酒馆预设。"};

const REVIEW_CONTACT_PROMPT = '点击新增联系人时，先结合当前剧情、角色设定及可用记忆判断电话是否仍可使用。亲友不能仅凭关系自动加入，已死亡或丧尸化且失去通信能力等应排除；普通暂时未接电话不等于永久不可联系。识别已实际交付的私人号码及地点座机、临时电话和分机，数字仅被叙述而未列出时用 null。地点电话按有依据的区域或机构命名，不冒充目标人物的私人号码，不编造区域名。复核旧联系人，只凭明确当前依据移除不可联系者。引用原文验证获取资格，不从社媒或摘要凭空授予号码。';
const PREVIOUS_CONTACT_PROMPT = 'user 点击「新增联系人」后，仅从本次提供的可见正文与 user 人设查找。正文需已实际得到号码或明确交换号码，单纯询问而未得到不算；user 人设中明确的既有亲人、朋友或伴侣，即使无交换号码剧情也可加入电话联系人。每项必须提供对应来源的连续逐字依据。未给出具体数字用 null，不编造号码或姓名。电话与短信共用联系人；这些关系不代表拥有任何社媒账号。';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeApiSettings(value) {
    const api = isRecord(value) ? value : {};
    return { memorySource: api.memorySource === 'none' ? 'none' : 'qqj', mode: api.mode === 'independent' ? 'independent' : 'host', baseUrl: typeof api.baseUrl === 'string' ? api.baseUrl : '', model: typeof api.model === 'string' ? api.model : '', maxTokens: Math.round(numeric(api.maxTokens, 128, 32768, 2048)), timeout: Math.round(numeric(api.timeout, 15, 300, 90)), historyLimit: Math.round(numeric(api.historyLimit, 1, 500, 80)), revision: Math.round(numeric(api.revision, 0, Number.MAX_SAFE_INTEGER, 0)) };
}

export function normalizeSettings(value) {
    const raw = isRecord(value) ? value : {};
    const { contactInterval, unansweredInterval, contactEvents, contactExceptions, ...current } = raw;
    const oldApps = isRecord(raw.apps) ? raw.apps : {};
    const api = isRecord(raw.api) ? raw.api : {};
    const ids = new Set();
    const apiProfiles = (Array.isArray(raw.apiProfiles) ? raw.apiProfiles : []).filter(p => isRecord(p) && typeof p.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(p.id) && typeof p.name === 'string' && p.name.trim() && !ids.has(p.id) && ids.add(p.id)).map(p => ({ id: p.id, name: p.name.trim().slice(0,80), api: normalizeApiSettings(p.api) }));
    const oldPrompts = isRecord(raw.prompts) ? raw.prompts : {};
    return {
        ...current,
        schemaVersion: 1,
        api: normalizeApiSettings(api),
        apiProfiles,
        apiProfileId: apiProfiles.some(p => p.id === raw.apiProfileId) ? raw.apiProfileId : '',
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
        launcherVisible: typeof raw.launcherVisible === 'boolean' ? raw.launcherVisible : true,
        position: isRecord(raw.position) ? { x: numeric(raw.position.x, 0, 1, 1), y: numeric(raw.position.y, 0, 1, 0.8) } : null,
        theme: ['dark', 'light'].includes(raw.theme) ? raw.theme : 'dark',
        wallpaper: ['violet', 'ocean', 'sand', 'graphite'].includes(raw.wallpaper) ? raw.wallpaper : 'violet',
        fontSize: Math.round(numeric(raw.fontSize, 14, 20, 15)),
        phoneWidth: Math.round(numeric(raw.phoneWidth, 300, 420, 360)),
        proactiveEnabled: typeof raw.proactiveEnabled === 'boolean' ? raw.proactiveEnabled : true,
        retries: Math.round(numeric(raw.retries, 0, 15, 2)),
        apps: Object.fromEntries(APPS.map(app => [app.id, typeof oldApps[app.id] === 'boolean' ? oldApps[app.id] : true])),
        prompts: Object.fromEntries(Object.entries(PROMPTS).map(([id, prompt]) => [id, typeof oldPrompts[id] === 'string' && oldPrompts[id] !== LEGACY_PROACTIVE_PROMPTS[id] && oldPrompts[id] !== PREVIOUS_BRIDGE_PROMPTS[id] && !(id==='incoming' && oldPrompts[id]===PREVIOUS_INCOMING_PROMPT) && !(id==='contacts' && [PREVIOUS_CONTACT_PROMPT, REVIEW_CONTACT_PROMPT].includes(oldPrompts[id])) ? oldPrompts[id] : prompt.text])),
    };
}

export function clampPosition(position, viewport, size = LAUNCHER_SIZE) {
    const margin = 8;
    const maxX = Math.max(margin, viewport.width - size - margin);
    const maxY = Math.max(margin, viewport.height - size - margin);
    return {
        x: Math.min(maxX, Math.max(margin, position?.x ?? maxX)),
        y: Math.min(maxY, Math.max(margin, position?.y ?? Math.max(margin, maxY * 0.8))),
    };
}
