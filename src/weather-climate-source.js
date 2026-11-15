// Network-grounded climate reference for story weather simulations.
// Real places use published Open-Meteo geocoding and historical reanalysis.
// Only a compact monthly climate profile is saved; daily raw data is discarded.
const PERIOD = { start: '2016-01-01', end: '2025-12-31' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const failure = (code, message) => Object.assign(new Error(message), { code, retryable: false });

async function getJson(url, fetcher) {
    let response;
    try { response = await fetcher(url, { headers: { Accept: 'application/json' } }); }
    catch (error) { throw failure('CLIMATE_NETWORK', '气候资料网络请求失败，请检查网络后重试。'); }
    if (!response?.ok) throw failure('CLIMATE_HTTP', '气候资料服务暂时不可用（HTTP ' + (response?.status || '?') + '），原有天气资料已保留。');
    try {
        const json = await response.json();
        if (json?.error) throw Error(json.reason || 'service error');
        return json;
    } catch { throw failure('CLIMATE_DATA', '气候资料接口返回了无效数据，原有天气资料已保留。'); }
}

function classifyClimate(temps, wetDays, rainMm, latitude) {
    const warm = Math.max(...temps), cold = Math.min(...temps);
    const annual = temps.reduce((a, b) => a + b, 0) / 12;
    const totalRain = rainMm.reduce((a, b) => a + b, 0);
    const summerIndices = latitude < 0 ? [11, 0, 1] : [5, 6, 7];
    const winterIndices = latitude < 0 ? [5, 6, 7] : [11, 0, 1];
    const sum = indices => indices.reduce((total, i) => total + rainMm[i], 0);
    const drySummer = sum(summerIndices) < sum(winterIndices) * .34;
    const dryWinter = sum(winterIndices) < sum(summerIndices) * .34;
    if (warm < 10) return 'et';
    if (totalRain < Math.max(170, annual * 11)) return annual >= 18 ? 'bwh' : 'bsh';
    if (cold >= 18) {
        if (Math.min(...rainMm) >= 60) return 'af';
        if (Math.min(...wetDays) >= .13) return 'am';
        return 'aw';
    }
    if (cold <= -3) return dryWinter ? 'dwa' : warm >= 22 ? 'dfa' : 'dfb';
    if (drySummer) return 'csa';
    return warm >= 22 ? 'cfa' : 'cfb';
}

export function climateFromHistorical(data, place) {
    const daily = data?.daily, dates = daily?.time, temps = daily?.temperature_2m_mean;
    const precip = daily?.precipitation_sum;
    if (!Array.isArray(dates) || !Array.isArray(temps) || !Array.isArray(precip)
        || dates.length !== temps.length || dates.length !== precip.length || dates.length < 300)
        throw failure('CLIMATE_DATA', '气候资料不足，无法确定该地点的典型天气；原有资料已保留。');
    const bins = Array.from({ length: 12 }, () => ({ t: 0, wet: 0, rain: 0, wind: 0, humid: 0, n: 0, windN: 0, humidN: 0 }));
    const winds = daily.wind_speed_10m_mean, humidity = daily.relative_humidity_2m_mean;
    for (let i = 0; i < dates.length; i++) {
        const month = Number(String(dates[i]).slice(5, 7)) - 1;
        if (month < 0 || month > 11 || !finite(temps[i]) || !finite(precip[i])) continue;
        const row = bins[month];
        row.t += temps[i]; row.rain += Math.max(0, precip[i]); row.wet += precip[i] >= 1 ? 1 : 0; row.n++;
        if (finite(winds?.[i])) { row.wind += Math.max(0, winds[i]); row.windN++; }
        if (finite(humidity?.[i])) { row.humid += humidity[i]; row.humidN++; }
    }
    if (bins.some(row => row.n < 30)) throw failure('CLIMATE_DATA', '当地部分月份缺乏可信的历史资料，本次未覆盖原有档案。');
    const monthlyTemp = bins.map(row => Math.round(row.t / row.n * 10) / 10);
    const monthlyRainChance = bins.map(row => Math.round(clamp(row.wet / row.n, .015, .9) * 1000) / 1000);
    const monthlyRainMm = bins.map(row => row.rain / row.n * 30.4);
    const knownWind = bins.filter(row => row.windN), knownHumid = bins.filter(row => row.humidN);
    const averageWindKmh = knownWind.length ? knownWind.reduce((s, row) => s + row.wind / row.windN, 0) / knownWind.length : null;
    const averageHumidity = knownHumid.length ? knownHumid.reduce((s, row) => s + row.humid / row.humidN, 0) / knownHumid.length : null;
    // Existing simulator consumes wind on the Beaufort scale (roughly 0–12).
    const wind = averageWindKmh === null ? null : clamp(Math.round(averageWindKmh / 5.5 * 10) / 10, 0, 8);
    const kind = classifyClimate(monthlyTemp, monthlyRainChance, monthlyRainMm, place.latitude);
    return {
        archetype: kind, offset: 0, south: place.latitude < 0,
        monthlyTemp, monthlyRainChance,
        ...(wind === null ? {} : { typicalWind: wind }),
        ...(averageHumidity === null ? {} : { typicalHumidity: clamp(Math.round(averageHumidity), 12, 99) }),
        source: 'open-meteo-historical', locationLabel: [place.name, place.admin1, place.country].filter(Boolean).join(' · '),
        coordinates: { latitude: place.latitude, longitude: place.longitude },
        referencePeriod: PERIOD.start + '/' + PERIOD.end,
    };
}

const plain = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s.,，。·()（）_-]/g, '');
export async function lookupLocationClimate(city, { fetcher = globalThis.fetch } = {}) {
    if (typeof fetcher !== 'function') throw failure('CLIMATE_NETWORK', '当前运行环境无法连接在线气候资料服务。');
    const name = String(city || '').trim();
    if (!name || name.length > 60) throw failure('CLIMATE_LOCATION_NOT_FOUND', '天气地点名称无效。');
    const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name, count: '10', language: 'zh', format: 'json' });
    const result = await getJson(url, fetcher);
    const matches = (result?.results || []).filter(place => finite(place.latitude) && finite(place.longitude));
    if (!matches.length) throw failure('CLIMATE_LOCATION_NOT_FOUND', '在线地理资料中没有找到「' + name + '」。如为架空地点，请检查世界书设定及地点名称。');
    const key = plain(name.split(/[,，]/)[0]);
    const place = matches.find(p => plain(p.name) === key || plain(p.name + '市') === key) || matches[0];
    const query = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude),
        start_date: PERIOD.start, end_date: PERIOD.end,
        daily: 'temperature_2m_mean,precipitation_sum,wind_speed_10m_mean,relative_humidity_2m_mean',
        timezone: 'auto',
    });
    const history = await getJson('https://archive-api.open-meteo.com/v1/archive?' + query, fetcher);
    return climateFromHistorical(history, place);
}
