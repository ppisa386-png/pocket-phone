import { normalizeApiUrl } from './api.js?v=0.17.0';
const apiEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createApiPanel({ adapter, getSettings, persist, redraw }) {
    let selectedProfile = '', profileName = '';
    const profiles = () => getSettings().apiProfiles || [];
    const activeId = () => getSettings().apiProfileId || '';
    let draft = null, key = '', tab = 'connection', models = [], status = '', statusKind = '', busy = false, token = 0;
    function init() { if (!draft) { draft = structuredClone(getSettings().api); key = adapter.keyStore?.get(draft.baseUrl, activeId()) || ''; } }
    function field(id, label, type = 'text', extra = '') {
        const value = id === 'key' ? key : draft[id];
        return '<label class="pp-field"><span>' + label + '</span><input data-api-field="' + id + '" type="' + type + '" value="' + apiEscape(value) + '" ' + extra + (busy ? ' disabled' : '') + '></label>';
    }
    function config(requireModel = true) {
        init();
        const value = { ...draft, baseUrl: normalizeApiUrl(draft.baseUrl), model: draft.model.trim() };
        if (requireModel && !value.model) throw new Error('请填写或选择模型 ID。');
        for (const [id, min, max] of [['timeout', 15, 300]]) {
            if (!Number.isInteger(value[id]) || value[id] < min || value[id] > max) throw new Error('请在参数页填写范围内的整数。');
        }
        if (/\r|\n/.test(key)) throw new Error('密钥不能包含换行。');
        return value;
    }
    return {
        html() {
            init();
            const disabled = busy ? ' disabled' : '';
            let body = '';
            const activeName = profiles().find(p => p.id === activeId())?.name || '未命名配置';
            if (tab === 'connection') {
                body = '<div class="pp-card pp-form"><label class="pp-field"><span>手机模型连接</span><select data-api-field="mode"' + disabled + '><option value="host"' + (draft.mode === 'host' ? ' selected' : '') + '>跟随酒馆</option><option value="independent"' + (draft.mode === 'independent' ? ' selected' : '') + '>独立 API（OpenAI 兼容）</option></select></label>';
                if (draft.mode === 'independent') body += field('baseUrl', 'API 地址', 'url', 'placeholder="https://example.com/v1" autocomplete="off" spellcheck="false"') +
                    field('key', 'API 密钥', 'password', 'autocomplete="off" spellcheck="false" placeholder="无需密钥的本地服务可留空"') +
                    field('model', '模型 ID', 'text', 'autocomplete="off" spellcheck="false" placeholder="填写服务商提供的模型 ID"') +
                    (models.length ? '<label class="pp-field"><span>已获取的模型</span><select data-api-field="modelChoice"' + disabled + '><option value="">选择模型</option>' + models.map(id => '<option value="' + apiEscape(id) + '"' + (draft.model === id ? ' selected' : '') + '>' + apiEscape(id) + '</option>').join('') + '</select></label>' : '') +
                    '<div class="pp-api-actions"><button type="button" class="pp-text-button" data-api-action="models"' + disabled + '>获取模型</button><button type="button" class="pp-text-button" data-api-action="test"' + disabled + '>测试连接</button><button type="button" class="pp-text-button" data-api-action="clear-key"' + disabled + '>清除密钥</button></div>';
                else body += '<p class="pp-footnote">使用酒馆当前模型连接和完整生成流程。</p>';
                body += '</div><p class="pp-footnote">独立 API 不修改酒馆正文连接。支持 OpenAI 兼容的 Chat Completions 接口；原生 Claude/Gemini 接口需使用兼容地址。</p><p class="pp-footnote">密钥按方案和地址仅保存在当前浏览器，不进入聊天记录或插件设置导出。更换浏览器需重新填写。切换地址不会沿用原地址的密钥。</p>';
            } else if (tab === 'profiles') {
                body = '<p class="pp-footnote">当前使用：' + apiEscape(activeName) + '</p><div class="pp-card pp-form"><label class="pp-field"><span>已保存方案</span><select data-api-field="selectedProfile"' + disabled + '><option value="">选择方案</option>' + profiles().map(p => '<option value="' + apiEscape(p.id) + '"' + (selectedProfile === p.id ? ' selected' : '') + '>' + apiEscape(p.name) + '</option>').join('') + '</select></label><div class="pp-api-actions"><button type="button" class="pp-text-button" data-api-action="profile-use"' + disabled + '>使用方案</button><button type="button" class="pp-text-button" data-api-action="profile-delete"' + disabled + '>删除方案</button></div></div>' +
                    '<div class="pp-card pp-form"><label class="pp-field"><span>新方案名称</span><input data-api-field="profileName" maxlength="80" value="' + apiEscape(profileName) + '"' + disabled + '></label><button type="button" class="pp-text-button" data-api-action="profile-save"' + disabled + '>另存为新方案</button></div><p class="pp-footnote">另存当前连接、参数和记忆设置。使用方案后立即生效；修改后点击下方保存，会更新当前方案。各方案密钥分别保存在当前浏览器。</p>';
            } else if (tab === 'parameters') {
                body = '<div class="pp-card pp-form">' + field('timeout', '超时秒数（15—300）', 'number', 'min="15" max="300" step="1"') + '</div><p class="pp-footnote">预设、上下文范围和回复长度跟随酒馆。超时只用于独立 API；失败重试次数在设置的「失败重试」页调整。</p>';
            } else if (tab === 'memory') {
                const source = draft.memorySource || 'qqj';
                const report = adapter.memoryStatus?.({ ...getSettings(), api: draft });
                body = '<div class="pp-card pp-form"><label class="pp-field"><span>记忆来源</span><select data-api-field="memorySource"' + disabled + '><option value="qqj"' + (source === 'qqj' ? ' selected' : '') + '>千千结</option><option value="none"' + (source === 'none' ? ' selected' : '') + '>关闭</option></select></label></div>' +
                    '<p class="pp-footnote" data-memory-status>' + apiEscape(report?.message || '请在酒馆内查看接口状态。') + '</p><button type="button" class="pp-text-button" data-api-action="memory-refresh">刷新状态</button>' +
                    '<p class="pp-footnote">读取当前聊天已准备的召回与前情，不额外调用模型。没有材料时使用正文与手机记录；先完成一次正文召回后可再读。隐藏楼层不等于删除。删改楼层后不用旧材料，待千千结重新准备。</p>';
            } else {
                body = '<div class="pp-card pp-info"><p>两种模式均使用酒馆的完整生成流程；独立 API 只更换接收请求的接口和模型。独立模式需要酒馆使用「聊天补全」连接类型。</p><p>内容语言跟随已启用的预设文本。测试连接仅发送简短测试消息，不携带角色或剧情，会消耗少量 token；获取模型失败时仍可手填模型 ID。</p><p>短信、电话及后续 App 的使用记录继续随聊天保存与删楼回退。API 配置不随删楼改变；聊天变化后旧请求结果不会写入记录。</p><p>允许主动联系时，正文完成和拒接等操作可能调用模型；可在「主动联系」页暂停。</p></div>';
            }
            return '<div class="pp-page"><nav class="pp-api-tabs" aria-label="API 设置分页">' + [['connection','连接'],['profiles','方案'],['parameters','参数'],['memory','记忆'],['help','说明']].map(([id,label]) => '<button type="button" class="pp-text-button" data-api-action="tab:' + id + '" aria-pressed="' + (tab === id) + '">' + label + '</button>').join('') + '</nav>' + body +
                '<div class="pp-api-savebar"><div class="pp-api-actions"><button type="button" class="pp-call-retry" data-api-action="save"' + disabled + '>保存 API 设置</button>' + (busy ? '<button type="button" class="pp-text-button" data-api-action="cancel">取消请求</button>' : '') + '</div><p class="pp-api-status" data-api-status data-kind="' + statusKind + '" role="status">' + apiEscape(status || '修改后点击保存才会用于手机通信。') + '</p></div></div>';
        },
        input(id, value) {
            init();
            if (id === 'selectedProfile') { selectedProfile = value; return; }
            if (id === 'profileName') { profileName = value; return; }
            token++; statusKind = ''; status = '尚未保存。';
            if (id === 'key') key = value.trim();
            else if (id === 'baseUrl') { draft.baseUrl = value; key = adapter.keyStore?.get(value, activeId()) || ''; models = []; }
            else if (id === 'modelChoice') { draft.model = value; redraw(); }
            else draft[id] = ['maxTokens', 'timeout', 'historyLimit'].includes(id) ? Number(value) : value;
            if (id === 'mode' || id === 'memorySource') redraw();
        },
        keyValue: () => key,
        async action(action) {
            init();
            if (action.startsWith('tab:')) { tab = action.slice(4); redraw(); return; }
            if (action === 'memory-refresh') { redraw(); return; }
            if (action === 'cancel') { token++; busy = false; status = '已取消请求。'; redraw(); return; }
            if (busy) return;
            statusKind = '';
            try {
                if (action === 'profile-use') {
                    const saved = profiles().find(p => p.id === selectedProfile);
                    if (!saved) throw new Error('请先选择方案。');
                    if (!persist({api:{...saved.api,revision:getSettings().api.revision+1},apiProfileId:saved.id})) throw new Error('方案切换失败。');
                    draft=structuredClone(getSettings().api);key=adapter.keyStore?.get(draft.baseUrl,saved.id)||'';models=[];token++;statusKind='success';status='已切换到「'+saved.name+'」。';
                } else if (action === 'profile-delete') {
                    const saved=profiles().find(p=>p.id===selectedProfile);
                    if(!saved)throw new Error('请先选择方案。');
                    // Deleting a preset keeps the active connection as an unnamed copy.
                    const wasActive=activeId()===saved.id;
                    const currentApi=getSettings().api;
                    const previousDefault=adapter.keyStore?.get(currentApi.baseUrl)||'';
                    if(wasActive&&currentApi.mode==='independent')adapter.keyStore?.set(currentApi.baseUrl,adapter.keyStore.get(currentApi.baseUrl,saved.id));
                    if(!persist({apiProfiles:profiles().filter(p=>p.id!==saved.id),...(wasActive?{apiProfileId:'',api:{...currentApi,revision:currentApi.revision+1}}:{})})) {
                        if(wasActive&&currentApi.mode==='independent')adapter.keyStore?.set(currentApi.baseUrl,previousDefault);
                        throw new Error('方案删除失败。');
                    }
                    if(saved.api.baseUrl)adapter.keyStore?.set(saved.api.baseUrl,'',saved.id);
                    selectedProfile='';token++;statusKind='success';status='方案已删除。';
                } else if (action === 'save' || action === 'profile-save') {
                    const next = draft.mode === 'independent' ? config() : { ...draft };
                    const creating=action==='profile-save';
                    const name=profileName.trim().slice(0,80);
                    if(creating&&!name)throw new Error('请填写方案名称。');
                    if(creating&&profiles().some(p=>p.name===name))throw new Error('已有同名方案，请换一个名称。');
                    const id=creating?crypto.randomUUID():activeId();
                    const previousKey = next.baseUrl ? adapter.keyStore?.get(next.baseUrl,id) : '';
                    if (draft.mode === 'independent') {
                        if (!adapter.keyStore) throw new Error('离线预览不保存 API 密钥。');
                        adapter.keyStore.set(next.baseUrl, key,id);
                    }
                    const nextApi={...next,revision:getSettings().api.revision+1};
                    const nextProfiles=creating?[...profiles(),{id,name,api:nextApi}]:profiles().map(p=>p.id===id?{...p,api:nextApi}:p);
                    if (!persist({ api: nextApi, apiProfiles:nextProfiles, apiProfileId:id })) {
                        if (draft.mode === 'independent') adapter.keyStore.set(next.baseUrl, previousKey,id);
                        throw new Error('API 设置保存失败。');
                    }
                    draft = structuredClone(getSettings().api); if(creating){selectedProfile=id;profileName='';} token++; statusKind = 'success'; status = '已保存，手机将使用' + (draft.mode === 'independent' ? '独立 API。' : '酒馆当前连接。');
                } else if (action === 'clear-key') {
                    adapter.keyStore?.set(normalizeApiUrl(draft.baseUrl), '',activeId()); key = ''; token++;
                    status = '此地址的本地密钥已清除。';
                } else if (action === 'models' || action === 'test') {
                    if (!adapter.api) throw new Error('离线预览不能连接 API，请在酒馆内测试。');
                    const next = config(action === 'test');
                    const id = ++token; busy = true; status = action === 'models' ? '正在获取模型…' : '正在测试连接…'; redraw();
                    try {
                        const result = await adapter.api[action](next, key, () => token === id);
                        if (token !== id) return;
                        if (action === 'models') { models = result; status = result.length ? '已获取 ' + result.length + ' 个模型，请选择后保存。' : '服务返回空列表，请手动填写模型 ID。'; }
                        else { statusKind = 'success'; status = '连接成功，模型已返回文字。请保存设置后使用。'; }
                    } catch (error) { if (token === id) { adapter.diagnostics?.add(error,'API '+action,[key]); statusKind = 'error'; status = error.message; } }
                    finally { if (token === id) busy = false; }
                }
            } catch (error) { adapter.diagnostics?.add(error,'API 设置',[key]); statusKind = 'error'; status = error.message; }
            redraw();
        },
        destroy() { token++; key = ''; draft = null; },
    };
}
