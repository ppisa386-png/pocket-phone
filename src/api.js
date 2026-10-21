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
        get(url, profileId = '') { try { return storage?.getItem(prefix + (profileId ? 'profile:' + profileId + ':' : '') + normalizeApiUrl(url)) ?? ''; } catch { return ''; } },
        secrets() {
            try { return Array.from({length: storage?.length || 0}, (_, i) => storage.key(i)).filter(k => k?.startsWith(prefix)).map(k => storage.getItem(k)).filter(Boolean); } catch { return []; }
        },
        set(url, key, profileId = '') {
            if (!storage) throw new Error('当前浏览器不能保存密钥，请检查浏览器存储设置。');
            const name = prefix + (profileId ? 'profile:' + profileId + ':' : '') + normalizeApiUrl(url);
            try { key ? storage.setItem(name, key) : storage.removeItem(name); }
            catch { throw new Error('密钥保存失败，请检查浏览器存储空间或权限。'); }
        },
    };
}

function failure(message, retryable = false) { return Object.assign(new Error(message), { retryable }); }
export function apiError(status, data) {
    // ST's OpenAI proxy may wrap upstream failures as HTTP 200 and keep only
    // error.message (HTTP statusText) plus quota_error. Do not discard those.
    // Classify locally; never echo arbitrary provider text, codes or credentials.
    const raw = data?.error;
    const nested = raw && typeof raw === 'object' ? raw : {};
    const code = [nested.code, nested.type, nested.status].filter(v => typeof v === 'string').join(' ').slice(0, 1000).toLowerCase();
    const message = (typeof raw === 'string' ? raw : typeof nested.message === 'string' ? nested.message : typeof data?.message === 'string' ? data.message : '').slice(0, 4000).toLowerCase();
    const labels = { 'bad request':400, unauthorized:401, forbidden:403, 'not found':404, 'request timeout':408,
        'request entity too large':413, 'payload too large':413, 'unprocessable entity':422, 'too many requests':429,
        'internal server error':500, 'bad gateway':502, 'service unavailable':503, 'gateway timeout':504 };
    const declared = Number(nested.status ?? nested.status_code ?? nested.code);
    const reported = Number.isInteger(declared) && declared >= 400 && declared <= 599 ? declared : Object.hasOwn(labels, message.trim()) ? labels[message.trim()] : null;
    const effective = reported || status;
    let reason = '未识别', hint = '请核对酒馆服务端同一时刻的错误记录（分享前去除密钥和正文）。';
    if (data?.quota_error === true || /insufficient_quota|quota_exceeded|resource_exhausted/.test(code)) { reason='额度不足';hint='请检查服务额度。'; }
    else if ([401,403].includes(effective) || /authentication|invalid_api_key/.test(code)) { reason='认证失败';hint='请检查这个地址对应的 API 密钥和访问权限。'; }
    else if (effective===429 || /rate_limit/.test(code)) { reason='请求过于频繁';hint='请稍后手动重试。'; }
    else if (effective===404 || /model_not_found/.test(code)) { reason='找不到接口或模型';hint='请检查 API 地址及模型 ID。'; }
    else if (effective===413 || /context_length|max_tokens|token_limit/.test(code) || /context length|context window|too many tokens/.test(message)) { reason='上下文或输出长度超限';hint='请核对模型长度限制与预设参数。'; }
    else if (effective===408 || effective===504 || /timeout|timed.?out/.test(code+' '+message)) { reason='上游等待超时';hint='请核对中转或执行器记录，再手动重试。'; }
    else if (effective===503 || /overloaded|server_busy|no available.*executor|executor.*offline/.test(code+' '+message)) { reason='服务繁忙或执行器不可用';hint='请检查服务或执行器状态，再手动重试。'; }
    else if (effective===502 || /econnrefused|econnreset|enotfound/.test(code+' '+message)) { reason='转发连接失败';hint='请检查中转服务或执行器的对应请求记录，再手动重试。'; }
    else if (effective===400 || effective===422 || /invalid_request|invalid_argument/.test(code)) { reason='请求被接口拒绝';hint='请核对服务支持的模型与预设参数；具体拒绝原因需查看酒馆服务端记录。'; }
    else if (effective>=500) { reason='服务内部错误';hint='请核对中转服务记录，再手动重试。'; }
    const prefix = status>=200&&status<300 ? '酒馆接口已响应（HTTP '+status+'），但返回了错误结果，未取得模型回复。' : 'API 请求失败'+(status?'（HTTP '+status+'）':'')+'。';
    const error = failure(prefix+(reason==='未识别'?'':reason+'。')+hint, status===429 && data?.quota_error!==true);
    error.diagnostic = '错误分类：'+reason+'；错误体报告状态：'+(reported??'未提供')
        +'；错误结构：'+(raw===null?'null':Array.isArray(raw)?'array':typeof raw)
        +'；含错误说明：'+(message?'是':'否')+'；额度标记：'+(data?.quota_error===true?'是':'否');
    return error;
}

export function extractApiText(data) {
    if (data?.error) throw apiError(0, data);
    const choices = Array.isArray(data?.choices) ? data.choices : [];
    const choice = choices[0], message = choice?.message, content = message?.content;
    const shape = value => value === undefined ? '缺失' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const nonempty = value => typeof value === 'string' ? !!value.trim() : Array.isArray(value) && value.length > 0;
    const reasoning = nonempty(message?.reasoning_content) || nonempty(message?.reasoning) || nonempty(message?.reasoning_details);
    const tools = Array.isArray(message?.tool_calls) ? message.tool_calls.length : message?.function_call ? 1 : 0;
    const refusal = nonempty(message?.refusal);
    const finish = ['stop','length','content_filter','tool_calls','function_call'].includes(choice?.finish_reason) ? choice.finish_reason : choice?.finish_reason == null ? '未提供' : '其他';
    const textParts = Array.isArray(content) ? content.filter(p => p?.type === 'text' && typeof p.text === 'string') : [];
    const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : '未提供';
    const fail = (code, reason) => {
        const error = failure(reason);
        error.code = code;
        // Only known shapes/counts/enums: no response excerpts, reasoning or arbitrary field names.
        error.diagnostic = '错误代码：'+code+'；响应结构：'+shape(data)+'；choices：'+shape(data?.choices)+'；候选数：'+choices.length
            +'；message：'+shape(message)+'；content：'+shape(content)+'；文本片段数：'+textParts.length+'；旧式text：'+shape(choice?.text)
            +'；结束原因：'+finish+'；含推理内容：'+(reasoning?'是':'否')+'；工具调用数：'+tools+'；含拒答标记：'+(refusal?'是':'否')
            +'；含流式片段：'+(choice?.delta?'是':'否')+'；输出token用量：'+tokenCount(data?.usage?.completion_tokens)
            +'；推理token用量：'+tokenCount(data?.usage?.completion_tokens_details?.reasoning_tokens);
        throw error;
    };
    if (finish === 'length') fail('API_OUTPUT_TRUNCATED','接口标记模型输出被截断，本次未保存回复。');
    if (finish === 'content_filter' || refusal) fail('API_OUTPUT_FILTERED','接口返回内容过滤或拒答标记，本次未取得可用回复。');
    if (finish === 'tool_calls' || finish === 'function_call') fail('API_OUTPUT_TOOLS','接口返回了工具调用，未完成本次所需的文字回复。');
    // Support the legacy completion text used by compatible gateways, but never
    // treat reasoning, tool arguments or an unfinished streaming delta as a reply.
    let text = typeof content === 'string' ? content : textParts.map(p => p.text).join('');
    if (!text.trim() && content == null && !reasoning && !tools && typeof choice?.text === 'string') text = choice.text;
    if (!text.trim()) {
        if (!choices.length || !choice || typeof choice !== 'object') fail('API_RESPONSE_SHAPE','接口返回中没有有效的回复候选，无法读取文字；需核对返回格式。');
        if (reasoning) fail('API_REASONING_ONLY','模型没有返回文字：接口只提供了推理内容，没有最终回复。本次未保存。');
        if (tools) fail('API_OUTPUT_TOOLS','接口只提供了工具调用，没有最终文字回复。');
        if (choice.delta) fail('API_UNEXPECTED_DELTA','非流式请求收到了流式片段，无法确认完整回复；需核对中转返回格式。');
        if (content != null && typeof content !== 'string' && !(Array.isArray(content) && content.every(p => p?.type==='text' && typeof p.text==='string'))) {
            fail('API_CONTENT_SHAPE','接口返回了无法识别的内容格式，未读取到回复文字。');
        }
        fail('API_EMPTY_OUTPUT','接口返回的最终回复文字为空。本次未保存；空回复本身不能说明是 token 上限问题。');
    }
    return text.trim();
}

export function createApiClient({ getContext, getSettings, getKey, prepareRequest, fetchImpl = globalThis.fetch }) {
    const active = new Set();
    let cancelEpoch = 0;
    async function post(path, config, key, extra, isCurrent = () => true, onProgress = () => {}) {
        if (getSettings().enabled === false) throw failure('榴莲手机已停用，请先勾选「启用榴莲手机」。');
        const endpoint = normalizeApiUrl(config.baseUrl);
        const host = getContext();
        if (typeof host?.getRequestHeaders !== 'function') throw failure('当前酒馆缺少请求接口，请更新酒馆后使用独立 API。');
        if (/\r|\n/.test(key)) throw failure('密钥不能包含换行，请重新粘贴。');
        if (!isCurrent()) throw failure('本次操作已取消。');
        const controller = new AbortController(); active.add(controller);
        let timedOut = false;
        const started = Date.now();
        let stage = '提交酒馆转发接口，等待响应', status = null, bodyLength = 0;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeout * 1000);
        const watcher = setInterval(() => { if (!isCurrent()) controller.abort(); }, 150);
        try {
            const body = JSON.stringify({ chat_completion_source: 'openai', reverse_proxy: endpoint, proxy_password: key, ...extra });
            bodyLength = body.length;
            onProgress(stage);
            const response = await fetchImpl('/api/backends/chat-completions/' + path, {
                method: 'POST', headers: host.getRequestHeaders(), credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
                body,
            });
            if (!isCurrent()) throw failure('聊天或 API 配置已变化，本次操作已取消。');
            status = Number.isInteger(response.status) ? response.status : null;
            stage = '酒馆接口已响应，正在读取返回内容';
            onProgress(stage);
            let data;
            try { data = await response.json(); } catch {
                if (!response.ok) throw apiError(response.status, null);
                throw failure('接口没有返回有效 JSON，请检查 API 地址和酒馆版本。');
            }
            if (controller.signal.aborted || !isCurrent()) throw failure('本次操作已取消。');
            if (!response.ok || data?.error) throw apiError(response.status, data);
            if (path === 'generate') {
                stage = '正在读取模型回复文字';
                onProgress(stage);
                return extractApiText(data);
            }
            return data;
        } catch (error) {
            let result;
            if (timedOut) result = failure('等待酒馆转发结果超时（' + config.timeout + ' 秒），本次已停止等待，不会自动重发。请核对中转或执行器记录后手动重试。');
            else if (controller.signal.aborted || !isCurrent()) result = failure('本次操作已取消。');
            else if (error && typeof error === 'object' && 'retryable' in error) result = error;
            // Provider error bodies can echo credentials: never display them.
            else result = failure('未能完成酒馆转发请求，请检查酒馆服务端网络与服务地址；本次不会自动重发。');
            result.diagnostic = (result.diagnostic ? result.diagnostic + '\n' : '') + '请求环节：' + stage + '；等待耗时：' + Math.round((Date.now() - started) / 1000) + ' 秒；超时设置：' + config.timeout + ' 秒'
                + '；HTTP：' + (status ?? '尚未收到') + '；请求字符数：' + bodyLength
                + '；上下文消息数：' + (Array.isArray(extra.messages) ? extra.messages.length : 0)
                + '；回复上限：' + (extra.max_completion_tokens ?? extra.max_tokens ?? '由服务决定')
                + '\n此处记录的是浏览器与酒馆接口的往返，不能据此确认上游执行器已收到请求。';
            throw result;
        } finally { clearTimeout(timeout); clearInterval(watcher); active.delete(controller); }
    }
    async function complete(config, key, messages, isCurrent) {
        if (!config.model?.trim()) throw failure('请先填写或选择模型 ID。');
        return post('generate', config, key, { model: config.model.trim(), messages, stream: false,
            max_tokens: config.maxTokens }, isCurrent);
    }
    return {
        async generate(prompt, contact, isCurrent, onProgress = () => {}) {
            if (getSettings().enabled === false) throw failure('榴莲手机已停用，请先勾选「启用榴莲手机」。');
            const config = structuredClone(getSettings().api);
            normalizeApiUrl(config.baseUrl);
            if (!config.model?.trim()) throw failure('请先填写或选择模型 ID。');
            const key = getKey(config.baseUrl);
            const fingerprint = JSON.stringify(config), epoch = cancelEpoch;
            const current = () => epoch === cancelEpoch && isCurrent() && fingerprint === JSON.stringify(getSettings().api) && key === getKey(config.baseUrl);
            onProgress('正在整理正文、预设与记忆，尚未提交独立 API');
            const prepared = await prepareRequest(getContext(), prompt, contact, current);
            if (!current()) throw failure('聊天或 API 配置已变化，本次操作已取消。');
            return post('generate', config, key, independentPayload(prepared, config), current, onProgress);
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
        cancel() { cancelEpoch++; for (const controller of active) controller.abort(); },
    };
}

// Keep prompt contents and portable preset parameters. Never forward the host's
// URL, authorization headers, custom endpoint configuration or account fields.
export function independentPayload(prepared, config) {
    const fields = ['messages','temperature','frequency_penalty','presence_penalty','top_p','top_k','min_p','top_a','typical_p',
        'max_tokens','max_completion_tokens','stop','seed','logit_bias','logprobs','top_logprobs',
        'include_reasoning','reasoning_effort','verbosity','custom_prompt_post_processing','user_name','char_name','group_names',
        'tools','tool_choice','response_format','json_schema'];
    if (!Array.isArray(prepared?.messages) || !prepared.messages.length) throw failure('酒馆没有提供有效的生成内容。');
    const payload = Object.fromEntries(fields.filter(k => prepared[k] !== undefined).map(k => [k, prepared[k]]));
    return { ...payload, model: config.model.trim(), stream: false, type: 'quiet' };
}
