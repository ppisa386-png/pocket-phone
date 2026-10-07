export const MODULE_KEY = 'personal_pocket_phone';
export const LAUNCHER_SIZE = 36;
export const VERSION = '0.4.0';
export const APPS = [
    { id: 'phone', name: '电话', color: '#25ad75', dock: true },
    { id: 'messages', name: '短信', color: '#3289d9', dock: true },
    { id: 'snapchat', name: 'Snapchat', color: '#ffe34d' },
    { id: 'x', name: 'X', color: '#252733' },
    { id: 'amazon', name: 'Amazon', color: '#e89947' },
];
export const PROMPTS = {
    contacts: { name: '联系方式识别', text: '仅记录正文中 user 已实际获得的电话号码或明确完成的交换号码事件。只有索取意图、尚未给出的请求、他人的私密号码、char 单方面得知 user 号码均不符合。给出连续的逐字正文证据，证据应同时指明对方身份和号码归属，不得仅摘一个号码。不同人物各只有一个电话号码，不编造获取渠道。' },
    general: { name: '通用', text: '这是 user 的个人手机，所有互动均为文字扮演。继承酒馆当前角色卡、相关世界书、有效剧情与预设中的内容语言要求。界面标签使用中文。不得替 user 编造消息或决定。仅使用对应角色有依据获知的信息；未获知的私人内容不得跨角色、跨平台传播。' },
    phone: { name: '电话', text: '通过文字表现电话交流，只描写对白、可听见的语气、停顿和背景声音。不得描写通话另一端不可见的表情、动作、服装或内心活动。电话对应真实身份。user 仅能拨打在有效剧情中已获得的号码。char 发起来电必须有获取 user 号码的有效途径和依据。' },
    messages: { name: '短信', text: '以短信内容进行交流，继承角色的表达习惯及酒馆预设的语言要求。短信号码与真实身份绑定。仅依据有效剧情中获取的联系方式互动，不凭空补全号码。不得替 user 发送短信。' },
    snapchat: { name: 'Snapchat', text: '生成 Snapchat 内的文字互动，区分好友邀请、私聊、Snap 与 Stories。遵守好友及内容可见范围。知道账号不代表知道真实身份；不得因为后台存在对应关系而认出匿名 user。已在有效剧情中确认的身份不会因改名而遗忘。' },
    x: { name: 'X', text: '生成 X 的帖子、回复或私信，遵循角色设定和酒馆预设的内容语言。char 默认使用真名账号。公开帖子可以被发现并互动，发现账号不等于知道账号背后的真实身份。私信遵守联系与可见范围。禁止把私人谈话直接当作公众已知信息。' },
    amazon: { name: 'Amazon', text: '生成故事世界中的虚拟商品及订单内容，使用已确定的剧情背景、商品和货币信息。所有订单均为故事内模拟，不进行真实购买。订单和地址是私人信息，未获知的角色不得自动知晓。' },
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeSettings(value) {
    const raw = isRecord(value) ? value : {};
    const oldApps = isRecord(raw.apps) ? raw.apps : {};
    const oldPrompts = isRecord(raw.prompts) ? raw.prompts : {};
    return {
        ...raw,
        schemaVersion: 1,
        launcherVisible: typeof raw.launcherVisible === 'boolean' ? raw.launcherVisible : true,
        position: isRecord(raw.position) ? { x: numeric(raw.position.x, 0, 1, 1), y: numeric(raw.position.y, 0, 1, 0.8) } : null,
        theme: ['dark', 'light'].includes(raw.theme) ? raw.theme : 'dark',
        wallpaper: ['violet', 'ocean', 'sand', 'graphite'].includes(raw.wallpaper) ? raw.wallpaper : 'violet',
        fontSize: Math.round(numeric(raw.fontSize, 14, 20, 15)),
        phoneWidth: Math.round(numeric(raw.phoneWidth, 300, 420, 360)),
        retries: Math.round(numeric(raw.retries, 0, 15, 2)),
        apps: Object.fromEntries(APPS.map(app => [app.id, typeof oldApps[app.id] === 'boolean' ? oldApps[app.id] : true])),
        prompts: Object.fromEntries(Object.entries(PROMPTS).map(([id, prompt]) => [id, typeof oldPrompts[id] === 'string' ? oldPrompts[id] : prompt.text])),
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
