// Only the city entered by user long-press may be researched; no automatic geolocation.
import { establishedSources } from './contacts.js?v=1.2';

export const WEATHER_RESEARCH_TYPES = Object.freeze([
    'sunny','partly','overcast','fog','drizzle','rain','heavy','storm',
    'thunder','severe','sleet','lightsnow','snow','heavysnow','blizzard',
    'windy','dust','heat','cold','typhoon','hail',
]);
const CLIMATE_CODES = new Set(['af','am','aw','bwh','bsh','csa','cfa','cfb','dfa','dfb','dwa','et','h']);
const ORIGINS = new Set(['real_knowledge','fictional_worldbook','fictional_random']);
// Enumerate the actual task fields: an unconstrained object also accepts {},
// and gateways may drop additionalProperties when converting provider schemas.
export function weatherResearchSchema(city = null) {
    const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
    const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
    const months = (minimum, maximum) => ({ type: 'array', items: number(minimum, maximum), minItems: 12, maxItems: 12 });
    return { name: 'phone_weather', strict: false, value: {
        type: 'object', additionalProperties: false,
        properties: {
            city: { type: 'string', ...(city ? { enum: [city] } : {}), description: '仅回显手动地点，不从剧情改写位置。' },
            origin: { type: 'string', enum: [...ORIGINS] },
            climate: object({
                archetype: { type: 'string', enum: [...CLIMATE_CODES] },
                monthlyTemp: months(-80, 70), monthlyRainChance: months(0, 1),
                typicalWind: number(0, 12), typicalHumidity: number(0, 100), diurnal: number(0, 28),
                south: { type: 'boolean' }, arid: { type: 'boolean' },
                typhoon: { type: 'boolean' }, alwaysNight: { type: 'boolean' },
            }),
            weather: object({ type: { type: 'string', enum: [...WEATHER_RESEARCH_TYPES] },
                temp: number(-80, 70), wind: number(0, 12), humidity: number(0, 100) }),
        },
        required: ['city', 'origin', 'climate', 'weather'],
    } };
}

export const WEATHER_OUTPUT_CONTRACT = '天气研究只针对 user 在手机天气 App 长按手动保存的地点；最终 JSON 的 city 必须原样回显该地点，不许通过正文、状态栏、人设或剧情自动定位、改名、迁移。必须返回 city、origin、climate、weather；climate 含完整12个月温度与降水日概率及风湿、季节布尔字段；weather 含 type、temp、wind、humidity。架空地点先依据实际收到的设定判断气候，若没有则使用本次指定的随机气候代码。最终正文是唯一完整 JSON 对象，不是 {}，不提供 locationChange、解释、Markdown 或剧情。';
const validCity = city => typeof city === 'string' && !!city.trim() && city.trim().length <= 60 && !/[\r\n<>]/.test(city);
// Used only to compare city identity: never supplies a climate or classifies a place.
// Unknown cities must match exactly after punctuation and case normalization.
const cityToken = value => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
const CITY_ALIAS_GROUPS = [
    ['芝加哥', 'Chicago', 'Chicago IL', 'Chicago Illinois', 'Chicago USA', 'Chicago United States', 'City of Chicago'],
    ['纽约', 'New York', 'New York City', 'NYC', 'New York NY', 'New York New York'],
    ['洛杉矶', 'Los Angeles', 'Los Angeles CA', 'Los Angeles California'],
    ['旧金山', 'San Francisco', 'San Francisco CA', 'San Francisco California'],
    ['上海', 'Shanghai'], ['北京', 'Beijing', 'Peking'],
    ['东京', 'Tokyo'], ['伦敦', 'London'], ['巴黎', 'Paris'],
].map(group => group.map(cityToken));
const cityAliases = city => CITY_ALIAS_GROUPS.find(group => group.includes(cityToken(city))) || [cityToken(city)];
export const sameWeatherCity = (a, b) => !!cityToken(a) && !!cityToken(b) &&
    cityAliases(a).some(token => cityAliases(b).includes(token));

const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const invalid = msg => Object.assign(Error(msg), { retryable: false, code: 'WEATHER_RESEARCH_INVALID' });
// A model that omits required output can be asked once to supply it; invalid
// geography, bad enums and out-of-range values remain hard failures.
const incomplete = fields => Object.assign(
    Error(fields.some(field => field.startsWith('climate'))
        ? 'AI 返回的12个月气候档案不完整，原有天气已保留。'
        : 'AI 返回的天气必需字段不完整，原有天气已保留。'),
    { retryable: true, code: 'PHONE_DATA_MISSING', missingFields: fields },
);

function recentProse(chat) {
    const rows = [];
    let characters = 0;
    for (let index = (chat || []).length - 1; index >= 0 && rows.length < 50 && characters < 24000; index--) {
        const message = chat[index];
        if (message?.is_system || message?.is_hidden || message?.hidden) continue;
        const line = String(message?.mes || '')
            .replace(/<(think|thinking|analysis|script|style)[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
            .replace(/<!--\s*durian-[\s\S]*?-->/gi, '').trim().slice(0, 850);
        if (!line) continue;
        const row = '#' + index + ' ' + (message.is_user ? 'user' : 'char') + '：' + line;
        rows.unshift(row); characters += row.length;
    }
    return rows.join('\n---\n');
}

export function weatherResearchPrompt({ context, chat, city, storyDate = null, storyHour = null, fictionalFallbackArchetype = 'cfb' }) {
    if (!validCity(city)) throw invalid('请先长按天气地点，手动输入所在地。');
    const who = {
        user: context?.name1 || 'user',
        char: context?.name2 || context?.characters?.[context?.characterId]?.name || 'char',
    };
    const sources = establishedSources(context || {})
        .map(({ source, text }) => ({ source, text }))
        .filter(item => item.text?.trim());
    const sourceText = JSON.stringify(sources);
    if (sourceText.length > 160000) throw invalid('当前角色资料过长，无法安全完整提供给天气研究；请减少当前角色资料。');
    return '当前任务：榴莲天气 App 的一次手动刷新。禁止联网搜索、气象接口和外部工具；仅使用离线地理知识、此次实际发送且激活的世界书、人设、角色卡以及剧情资料。' +
        '\n**唯一有效地点是 user 在天气 App 长按输入并保存的：' + JSON.stringify(city) + '。**只研究这一个地方的气候和天气。不得自动检测当前地点；无论正文、状态栏、Persona 或角色出现在哪里，都不能改动、翻译或迁移 city。最终 JSON 的 city 必须原样回显手动值，其他地名仅可作为世界设定的背景资料。' +
        '\n先确认该手动地点的气候来源：① 真实地点：origin=real_knowledge，使用模型已有离线地理知识估算当地长期气候；② 架空地点且已发送/激活的世界书、Persona、角色卡或剧情中包含此地点的相关气候、地理、地形、季节或特殊环境规则：origin=fictional_worldbook，严格优先遵守设定，未明确的参数合理补全；③ 架空地点且上述已发送资料没有相关设定：origin=fictional_random，使用手机已随机选好的气候类型 ' + JSON.stringify(fictionalFallbackArchetype) + ' 作为 climate.archetype，基于此类型生成完整档案，不能另选气候类型。地点现实/架空的分类只用于气候资料，不能用于重定位。' +
        '\nclimate.monthlyTemp 必须对应公历一至十二月的典型月均温（摄氏度）；climate.monthlyRainChance 是长期平均的每月随机一天出现可测降水（雨或雪）的概率，约等于降水日数除以当月天数，绝非逐小时雨率、阴天率或月降水占比。另输出 typicalWind、typicalHumidity、diurnal、south、arid、typhoon、alwaysNight。真实地点尊重海拔、纬度、季风及干湿季差异，架空地点遵从已给定世界规则。' +
        '\nweather 返回当前剧情时间在此固定地点的具体天气：type、temp、wind、humidity；天气类型代码：' + WEATHER_RESEARCH_TYPES.join(',') + '，气候类型代码：' + [...CLIMATE_CODES].join(',') + '。剧情日期只用于季节定位，不得以现实今天实时天气代替。' +
        '\n手动地点：' + JSON.stringify(city) + '；剧情日期：' + JSON.stringify(storyDate) + '；剧情小时：' + JSON.stringify(storyHour) +
        '；人物：' + JSON.stringify(who) +
        '\n此次直接提供的 User 面具、角色卡和嵌入世界书：' + sourceText +
        '\n近期剧情及状态栏（只供查找该地点的气候设定，不是定位依据）：\n' + recentProse(chat) +
        '\n酒馆本次生成请求中实际激活的全局世界书、聊天世界书、Persona 世界书及其他有效资料，以它们实际发送的内容为准。未注入的资料不得假装已被读取。' +
        '\n最终只输出完整 JSON 对象。city 必须是 ' + JSON.stringify(city) + '。示例数字仅用于展示格式：' +
        '{"city":' + JSON.stringify(city) + ',"origin":"real_knowledge","climate":{"archetype":"cfb","monthlyTemp":[7,8,10,12,15,18,20,20,17,13,10,8],"monthlyRainChance":[0.3,0.3,0.35,0.4,0.35,0.3,0.25,0.3,0.35,0.4,0.4,0.35],"typicalWind":2.5,"typicalHumidity":70,"diurnal":8,"south":false,"arid":false,"typhoon":false,"alwaysNight":false},"weather":{"type":"partly","temp":18,"wind":2,"humidity":65}}。';
}

export function validateWeatherResearch(data, fixedCity = null, { fictionalFallbackArchetype = null } = {}) {
    if (!validCity(fixedCity)) throw invalid('请先长按天气地点，手动输入所在地。');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('天气研究没有返回有效的数据对象。');
    if (Object.keys(data).length === 0) throw Object.assign(invalid('模型最终回复只有空对象 {}，没有返回天气数据；原有天气已保留。'), { code: 'WEATHER_EMPTY_RESULT' });
    if (!validCity(data.city) || !sameWeatherCity(data.city, fixedCity))
        throw invalid('模型返回的地点与手机手动输入的天气地点不一致；原有天气及手动地点已保留。');
    const city = fixedCity.trim();
    const topMissing = ['origin', 'climate', 'weather'].filter(field => data[field] == null);
    if (topMissing.length) throw incomplete(topMissing);
    if (!ORIGINS.has(data.origin)) throw invalid('天气研究没有返回有效的现实/架空地点分类。');
    const profile = data.climate;
    if (typeof profile !== 'object' || Array.isArray(profile))
        throw invalid('AI 返回的12个月气候档案不完整或数值无效，原有天气已保留。');
    const climateMissing = ['archetype', 'monthlyTemp', 'monthlyRainChance', 'typicalWind',
        'typicalHumidity', 'diurnal', 'south', 'arid', 'typhoon', 'alwaysNight']
        .filter(field => profile[field] == null).map(field => 'climate.' + field);
    if (climateMissing.length) throw incomplete(climateMissing);
    const shortMonths = ['monthlyTemp', 'monthlyRainChance']
        .filter(field => Array.isArray(profile[field]) && profile[field].length !== 12)
        .map(field => 'climate.' + field);
    if (shortMonths.length) throw incomplete(shortMonths);
    if (!CLIMATE_CODES.has(profile.archetype)
        || !Array.isArray(profile.monthlyTemp) || profile.monthlyTemp.length !== 12
        || profile.monthlyTemp.some(n => !finite(n, -80, 70))
        || !Array.isArray(profile.monthlyRainChance) || profile.monthlyRainChance.length !== 12
        || profile.monthlyRainChance.some(n => !finite(n, 0, 1))
        || !finite(profile.typicalWind, 0, 12)
        || !finite(profile.typicalHumidity, 0, 100)
        || !finite(profile.diurnal, 0, 28)
        || typeof profile.south !== 'boolean'
        || typeof profile.arid !== 'boolean'
        || typeof profile.typhoon !== 'boolean'
        || typeof profile.alwaysNight !== 'boolean')
        throw invalid('AI 返回的12个月气候档案不完整或数值无效，原有天气已保留。');
    if (data.origin === 'fictional_random' && fictionalFallbackArchetype && profile.archetype !== fictionalFallbackArchetype)
        throw invalid('架空地点缺少已提供的气候设定时，模型必须采用本次指定的随机气候类型。');
    const weather = data.weather;
    if (typeof weather !== 'object' || Array.isArray(weather))
        throw invalid('AI 返回的当前天气数据不完整或数值无效，原有天气已保留。');
    const weatherMissing = ['type', 'temp', 'wind', 'humidity']
        .filter(field => weather[field] == null).map(field => 'weather.' + field);
    if (weatherMissing.length) throw incomplete(weatherMissing);
    if (!WEATHER_RESEARCH_TYPES.includes(weather.type)
        || !finite(weather.temp, -80, 70)
        || !finite(weather.wind, 0, 12)
        || !finite(weather.humidity, 0, 100))
        throw invalid('AI 返回的当前天气数据不完整或数值无效，原有天气已保留。');
    const origin = data.origin, kind = origin === 'real_knowledge' ? 'real' : 'fictional';
    return {
        city, kind, origin,
        climate: {
            archetype: profile.archetype,
            monthlyTemp: [...profile.monthlyTemp],
            monthlyRainChance: [...profile.monthlyRainChance],
            typicalWind: profile.typicalWind,
            typicalHumidity: profile.typicalHumidity,
            diurnal: profile.diurnal,
            south: profile.south, arid: profile.arid,
            typhoon: profile.typhoon, alwaysNight: profile.alwaysNight,
            offset: 0,
            source: 'ai-offline-research',
            origin,
        },
        weather: { type: weather.type, temp: weather.temp, wind: weather.wind, humidity: weather.humidity },
    };
}
