// Independent OpenAI-compatible requests go through the existing ST backend.
// Never overwrite the host's connection settings or borrow its provider keys.
export function normalizeApiUrl(value) {
    let url;
    try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('请填写完整 API 地址，例如 https://example.com/v1'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址仅支持 HTTP/HTTPS，不要在地址里填写密钥或查询参数。');
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '') || '/v1';
    return url.toString().replace(/\/$/, '');
}

export function createKeyStore(storage) {
    if (arguments.length === 0) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    const prefix = 'durian_phone_api_key:';
    return {
        get(url) { try { return storage?.getItem(prefix + normalizeApiUrl(url)) ?? ''; } catch { return ''; } },
        set(url, key) {
            if (!storage) throw new Error('当前浏览器不能保存密钥，请检查浏览器存储设置。');
            const name = prefix + normalizeApiUrl(url);
            try { key ? storage.setItem(name, key) : storage.removeItem(name); }
            catch { throw new Error('密钥保存失败，请检查浏览器存储空间或权限。'); }
        },
    };
}

function failure(message, retryable = false) { return Object.assign(new Error(message), { retryable }); }
export function apiError(status, data) {
    const code = String(data?.error?.code || data?.error?.type || '').toLowerCase();
    if (status === 401 || status === 403 || /authentication|invalid_api_key/.test(code)) return failure('认证失败，请检查这个地址对应的 API 密钥和访问权限。');
    if (status === 429 || /quota|rate_limit/.test(code)) return failure('服务额度不足或请求过于频繁，请稍后重试。', status === 429);
    if (status === 404 || /model_not_found/.test(code)) return failure('找不到接口或模型，请检查 API 地址及模型 ID。');
    if (/context_length/.test(code)) return failure('请求超出模型上下文，请减少读取的正文楼数。');
    return failure('API 请求失败' + (status ? '（HTTP ' + status + '）' : '') + '，请检查服务地址、模型与酒馆服务端连接。', status >= 500);
}

export function extractApiText(data) {
    if (data?.error) throw apiError(0, data);
    if (data?.choices?.[0]?.finish_reason === 'length') throw failure('模型输出被截断，请提高回复 token 上限。');
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text).join('') : '';
    if (!text.trim()) throw failure('模型没有返回文字，请检查模型是否支持 Chat Completions，或提高回复 token 上限。');
    return text.trim();
}

export function createApiClient({ getContext, getSettings, getKey, buildContext, fetchImpl = globalThis.fetch }) {
    const active = new Set();
    async function post(path, config, key, extra, isCurrent = () => true) {
        const endpoint = normalizeApiUrl(config.baseUrl);
        const host = getContext();
        if (typeof host?.getRequestHeaders !== 'function') throw failure('当前酒馆缺少请求接口，请更新酒馆后使用独立 API。');
        if (/\r|\n/.test(key)) throw failure('密钥不能包含换行，请重新粘贴。');
        if (!isCurrent()) throw failure('本次操作已取消。');
        const controller = new AbortController(); active.add(controller);
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeout * 1000);
        const watcher = setInterval(() => { if (!isCurrent()) controller.abort(); }, 150);
        try {
            const response = await fetchImpl('/api/backends/chat-completions/' + path, {
                method: 'POST', headers: host.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                body: JSON.stringify({ chat_completion_source: 'openai', reverse_proxy: endpoint, proxy_password: key, ...extra }),
            });
            if (!isCurrent()) throw failure('聊天或 API 配置已变化，本次操作已取消。');
            let data;
            try { data = await response.json(); } catch { throw failure('接口没有返回有效 JSON，请检查 API 地址和酒馆版本。'); }
            if (controller.signal.aborted || !isCurrent()) throw failure('本次操作已取消。');
            if (!response.ok || data?.error) throw apiError(response.status, data);
            return data;
        } catch (error) {
            if (timedOut) throw failure('API 请求超时，可调整超时时间后重试。', true);
            if (controller.signal.aborted || !isCurrent()) throw failure('本次操作已取消。');
            if (error && typeof error === 'object' && 'retryable' in error) throw error;
            // Provider error bodies can echo credentials: never display them.
            throw failure('无法连接 API，请检查酒馆服务端网络与服务地址。', true);
        } finally { clearTimeout(timeout); clearInterval(watcher); active.delete(controller); }
    }
    async function complete(config, key, messages, isCurrent) {
        if (!config.model?.trim()) throw failure('请先填写或选择模型 ID。');
        return extractApiText(await post('generate', config, key, { model: config.model.trim(), messages, stream: false,
            max_tokens: config.maxTokens }, isCurrent));
    }
    return {
        async generate(prompt, contact, isCurrent) {
            const config = structuredClone(getSettings().api);
            const key = getKey(config.baseUrl);
            const fingerprint = JSON.stringify(config);
            const current = () => isCurrent() && fingerprint === JSON.stringify(getSettings().api) && key === getKey(config.baseUrl);
            const messages = await buildContext(getContext(), prompt, contact, config, current);
            if (!current()) throw failure('聊天或 API 配置已变化，本次操作已取消。');
            return complete(config, key, messages, current);
        },
        async models(config, key, isCurrent) {
            const data = await post('status', config, key, {}, isCurrent);
            if (!Array.isArray(data?.data)) throw failure('服务没有返回模型列表，请手动填写模型 ID。');
            return [...new Set(data.data.map(item => item?.id).filter(id => typeof id === 'string' && id.length < 300))].sort();
        },
        test(config, key, isCurrent) {
            return complete({ ...config, maxTokens: Math.max(128, Math.min(config.maxTokens, 1024)) }, key,
                [{ role: 'user', content: 'Connection test. Reply only: OK' }], isCurrent);
        },
        cancel() { for (const controller of active) controller.abort(); },
    };
}
