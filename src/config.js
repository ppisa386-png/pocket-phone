export const MODULE_KEY = 'personal_pocket_phone';
export const LAUNCHER_SIZE = 36;
export const VERSION = '0.17.0';
export const APPS = [
    { id: 'phone', name: '电话', color: '#25ad75', dock: true },
    { id: 'messages', name: '短信', color: '#3289d9', dock: true },
    { id: 'snapchat', name: 'Snapchat', color: '#ffe34d' },
    { id: 'x', name: 'X', color: '#252733' },
    { id: 'amazon', name: 'Amazon', color: '#e89947' },
];
export const PROMPTS = {
    contactEvent: { name: '联系事件与后续反应', text: '依据角色设定、当前剧情与 user 的反应，自行决定是否联系、继续联系、等待或结束。没有固定联系间隔，不预设拒接或沉默后必须停止，也不预设任何性格或分手情节必然导致纠缠。每步仅选择一次来电、一条短信、等待或结束；不能绕过拉黑，不替 user 发言，不预生成一串后续。' },
    incomingMessages: { name: '主动短信', text: '依据角色设定、双方关系、当前剧情和已有通信，自行判断是否主动发短信。可以联系，也可以等待或不联系；不设固定间隔，未回复时是否再次联系由角色当下动机决定。不得替 user 发言或绕过拉黑。消息语言与角色表达习惯遵循酒馆预设。' },
    incoming: { name: '主动来电', text: '只在剧情中有合理动机且角色有可用途径取得 user 号码时发起来电。必须核对正文依据，不能因为 user 知名就凭空知道号码，不能把 user 单方面知道角色号码当成双方交换。共友需要明确存在且确实能提供号码；公开渠道需要正文确认号码可被访问。不强行制造来电，不重复已在正文中完成的电话。' },
    continuity: { name: '通信与正文衔接', text: '以下是当前角色已经亲自参与的手机通信，作为有效剧情记忆供后续正文参考。继续当前剧情，不重演整段通信，不把记录原样贴回正文，不强行让角色提起。保持通信中的约定、已交换的信息和人物关系；措辞、叙事与语言仍遵循酒馆预设和角色设定。短信和电话绑定真实身份；其他角色没有自动获知这些私人交流。不要把电话中未见的画面补成已知事实。' },
    contacts: { name: '联系方式识别', text: '点击新增联系人时，先结合当前剧情、角色设定及可用记忆判断电话是否仍可使用。亲友不能仅凭关系自动加入，已死亡或丧尸化且失去通信能力等应排除；普通暂时未接电话不等于永久不可联系。识别已实际交付的私人号码及地点座机、临时电话和分机，数字仅被叙述而未列出时用 null。地点电话按有依据的区域或机构命名，不冒充目标人物的私人号码，不编造区域名。引用原文验证获取资格，不从社媒或摘要凭空授予号码。' },
    general: { name: '通用', text: '这是 user 的个人手机，所有互动均为文字扮演。继承酒馆当前角色卡、相关世界书、有效剧情与预设中的内容语言要求。界面标签使用中文。不得替 user 编造消息或决定。仅使用对应角色有依据获知的信息；未获知的私人内容不得跨角色、跨平台传播。' },
    phone: { name: '电话', text: '通过文字表现电话交流，只描写对白、可听见的语气、停顿和背景声音。不得描写通话另一端不可见的表情、动作、服装或内心活动。电话对应真实身份。user 仅能拨打已保存的电话联系人，包括正文获得号码或人设中既有亲友。char 发起来电必须有获取 user 号码的有效途径和依据。' },
    messages: { name: '短信', text: '以短信内容进行交流，继承角色的表达习惯及酒馆预设的语言要求。短信号码与真实身份绑定。依据已保存的电话联系人互动，包括正文获得号码或 user 人设中的既有亲友，不凭空补全号码。不得替 user 发送短信。' },
    snapchat: { name: 'Snapchat', text: '生成 Snapchat 内的文字互动，区分好友邀请、私聊、Snap 与 Stories。遵守好友及内容可见范围。知道账号不代表知道真实身份；不得因为后台存在对应关系而认出匿名 user。已在有效剧情中确认的身份不会因改名而遗忘。' },
    x: { name: 'X', text: '生成 X 的帖子、回复或私信，遵循角色设定和酒馆预设的内容语言。char 默认使用真名账号。公开帖子可以被发现并互动，发现账号不等于知道账号背后的真实身份。私信遵守联系与可见范围。禁止把私人谈话直接当作公众已知信息。' },
    amazon: { name: 'Amazon', text: '生成故事世界中的虚拟商品及订单内容，使用已确定的剧情背景、商品和货币信息。所有订单均为故事内模拟，不进行真实购买。订单和地址是私人信息，未获知的角色不得自动知晓。' },
};

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
        launcherVisible: typeof raw.launcherVisible === 'boolean' ? raw.launcherVisible : true,
        position: isRecord(raw.position) ? { x: numeric(raw.position.x, 0, 1, 1), y: numeric(raw.position.y, 0, 1, 0.8) } : null,
        theme: ['dark', 'light'].includes(raw.theme) ? raw.theme : 'dark',
        wallpaper: ['violet', 'ocean', 'sand', 'graphite'].includes(raw.wallpaper) ? raw.wallpaper : 'violet',
        fontSize: Math.round(numeric(raw.fontSize, 14, 20, 15)),
        phoneWidth: Math.round(numeric(raw.phoneWidth, 300, 420, 360)),
        proactiveEnabled: typeof raw.proactiveEnabled === 'boolean' ? raw.proactiveEnabled : true,
        retries: Math.round(numeric(raw.retries, 0, 15, 2)),
        apps: Object.fromEntries(APPS.map(app => [app.id, typeof oldApps[app.id] === 'boolean' ? oldApps[app.id] : true])),
        prompts: Object.fromEntries(Object.entries(PROMPTS).map(([id, prompt]) => [id, typeof oldPrompts[id] === 'string' && oldPrompts[id] !== LEGACY_PROACTIVE_PROMPTS[id] && !(id==='contacts' && [PREVIOUS_CONTACT_PROMPT, REVIEW_CONTACT_PROMPT].includes(oldPrompts[id])) ? oldPrompts[id] : prompt.text])),
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
