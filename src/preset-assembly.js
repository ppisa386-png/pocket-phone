// Read-only adapter for SillyTavern's Prompt Manager. Never writes host state.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 500;
const fail = message => Object.assign(new Error(message), { retryable: false, code: 'PHONE_PRESET_ASSEMBLY' });
const builtins = new Set(['main','nsfw','jailbreak','enhanceDefinitions','worldInfoBefore','worldInfoAfter','charDescription','charPersonality','scenario','personaDescription','dialogueExamples','chatHistory',
    'quietPrompt','impersonate','groupNudge','bias','summary','authorsNote','vectorsMemory','vectorsDataBank','smartContext',
    'controlPrompts','newMainChat','newChat','continueNudge','continuePrefill','emptyUserMessageReplacement']);
const stable = value => JSON.stringify(value, (_key, item) => record(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export function normalizePresetAssemblies(value, appIds) {
    return Object.fromEntries(Object.entries(record(value) ? value : {}).filter(([app]) => appIds.includes(app)).map(([app, presets]) => [app,
        Object.fromEntries(Object.entries(record(presets) ? presets : {}).filter(([key, rule]) => key.startsWith('["openai",') && record(rule))
            .map(([key, rule]) => [key, { mode: rule.mode === 'custom' ? 'custom' : 'follow',
                choices: Object.fromEntries(Object.entries(record(rule.choices) ? rule.choices : {}).filter(([id, selected]) => validId(id) && typeof selected === 'boolean')) }]))]));
}

export function readCurrentPreset(context, host = {}) {
    const settings = context?.chatCompletionSettings;
    if (context?.mainApi !== 'openai' || !record(settings)) throw fail('当前未使用可读取的聊天补全预设。');
    const presetManager = context.getPresetManager?.('openai');
    const selectedName = presetManager?.getSelectedPresetName?.();
    const name = selectedName || settings.preset_settings_openai;
    if (typeof name !== 'string' || !name.trim()) throw fail('当前聊天补全预设名称不可用，请等待切换完成后刷新。');
    if (selectedName && settings.preset_settings_openai && selectedName !== settings.preset_settings_openai) throw fail('酒馆正在切换预设，请稍后刷新。');
    if (!Array.isArray(settings.prompts) || !Array.isArray(settings.prompt_order)) throw fail('此酒馆版本未提供可识别的预设条目与顺序。');
    const manager = host.promptManager;
    if (manager && manager.serviceSettings !== settings) throw fail('酒馆预设与 Prompt Manager 尚未同步，请稍后刷新。');
    // Use the manager's actual active order (global dummy ID or character ID).
    // Without it, a single order can be displayed, but cannot enable filtering.
    const character = manager?.activeCharacter;
    const orders = character ? settings.prompt_order.filter(item => String(item?.character_id) === String(character.id)) : settings.prompt_order;
    if (orders.length !== 1 || !Array.isArray(orders[0]?.order)) throw fail('无法唯一确定当前预设顺序，未套用任何其他角色的选择。');
    const order = orders[0].order;
    const counts = list => list.reduce((map, item) => map.set(item?.identifier, (map.get(item?.identifier) || 0) + 1), new Map());
    const promptCounts = counts(settings.prompts), orderCounts = counts(order);
    let support = '';
    if (!manager || !Array.isArray(manager.messages?.collection)) support = '此酒馆尚未提供带来源的组装结果，自定义组装暂不可用。';
    if (settings.squash_system_messages) support = '酒馆已开启合并 System 消息，条目来源会丢失，当前不支持自定义组装。';
    const rows = order.map(entry => {
        const id = entry?.identifier;
        const prompt = settings.prompts.find(item => item?.identifier === id);
        let reason = '';
        if (!validId(id) || promptCounts.get(id) !== 1 || orderCounts.get(id) !== 1) reason = '标识缺失或重复，无法独立匹配';
        else if (!prompt) reason = '条目已不存在';
        else if (prompt.marker || builtins.has(id) || prompt.system_prompt !== false) reason = '内置结构或动态上下文，保留酒馆处理';
        else if (prompt.injection_position != null && prompt.injection_position !== 0) reason = '聊天深度注入可能合并内容，暂不支持独立过滤';
        else if (prompt.extension || Object.keys(context.extensionPrompts || {}).some(key => key.replace(/\W/g, '_') === id)) reason = '扩展注入或来源标识冲突，保留原处理';
        else if (/{{\s*(?:setvar|setglobalvar|addvar|addglobalvar|incvar|incglobalvar|decvar|decglobalvar)\b/i.test(prompt.content || '')) reason = '含变量写入宏，可能影响其他条目，暂不支持独立过滤';
        else if (typeof prompt.content !== 'string' || !['system','user','assistant'].includes(prompt.role)) reason = '条目结构不受支持';
        return { id: validId(id) ? id : '', name: typeof prompt?.name === 'string' && prompt.name ? prompt.name : validId(id) ? id : '无有效标识的条目',
            enabled: entry?.enabled === true, controllable: !reason, reason };
    });
    for (const prompt of settings.prompts.filter(item => !order.some(entry => entry?.identifier === item?.identifier))) {
        rows.push({ id: validId(prompt?.identifier) ? prompt.identifier : '', name: prompt?.name || prompt?.identifier || '无有效标识的条目',
            enabled: false, controllable: false, reason: '未加入当前排列，酒馆不发送此条目' });
    }
    return { key: JSON.stringify(['openai', name]), name, rows, support,
        // Private, short-lived comparison only. Never persisted or shown in diagnostics.
        fingerprint: stable([name, character?.id, settings.prompts, order, !!settings.squash_system_messages, rows.map(row => [row.id, row.reason])]) };
}

export function presetRule(settings, app, snapshot) {
    const rule = settings?.presetAssemblies?.[app]?.[snapshot.key];
    return { mode: rule?.mode === 'custom' ? 'custom' : 'follow', choices: { ...(record(rule?.choices) ? rule.choices : {}) } };
}

export function presetRowSelected(row, rule) {
    return row.enabled && (!row.controllable || rule.choices[row.id] !== false);
}

// Reproduce only the official wire projection, not prompt expansion/assembly.
function wireMessage(message) {
    return { role: message.role, content: message.content,
        ...(message.name && { name: message.name }), ...(message.tool_calls && { tool_calls: message.tool_calls }),
        ...(message.role === 'tool' && { tool_call_id: message.identifier }),
        ...(message.signature && { signature: message.signature }), ...(message.reasoning && { reasoning: message.reasoning }) };
}
function sourceMessages(root) {
    if (!Array.isArray(root?.collection)) throw fail('酒馆未提供可核对的条目来源，本次没有提交模型。');
    const result = [];
    const visit = (node, owner = null) => {
        if (!node) return;
        if (Array.isArray(node.collection)) { node.collection.forEach(child => visit(child, node.identifier)); return; }
        if (node.content || node.tool_calls) result.push({ id: node.identifier, owner, message: wireMessage(node) });
    };
    visit(root);
    return structuredClone(result);
}

export function createPresetAssembly({ getContext, getSettings, getHost = () => ({}) }) {
    const diagnostics = new Map();
    let revision = 0, switching = false, disposed = false;
    const hooks = [], context = getContext(), bus = context?.eventSource, types = context?.event_types ?? context?.eventTypes ?? {};
    const watch = (name, handler) => {
        if (types[name] && typeof bus?.on === 'function' && typeof bus?.removeListener === 'function') {
            bus.on(types[name], handler); hooks.push([types[name], handler]);
        }
    };
    // Read-only invalidation: never cancels, alters or intercepts a host request.
    watch('OAI_PRESET_CHANGED_BEFORE', () => { revision++; switching = true; });
    watch('OAI_PRESET_CHANGED_AFTER', () => { revision++; switching = false; });
    watch('CHAT_CHANGED', () => { revision++; });
    const read = () => {
        if (disposed || switching) throw fail('酒馆正在切换预设，请等待完成后刷新。');
        const snapshot = readCurrentPreset(getContext(), getHost());
        if (!types.OAI_PRESET_CHANGED_BEFORE || !types.OAI_PRESET_CHANGED_AFTER || hooks.length < 2)
            snapshot.support = '此酒馆版本缺少预设切换通知，无法安全确认请求中的预设，自定义组装暂不可用。';
        return snapshot;
    };
    return {
        read,
        diagnostic: app => diagnostics.has(app) ? structuredClone(diagnostics.get(app)) : null,
        destroy() { disposed = true; for (const [name, handler] of hooks) bus.removeListener(name, handler); diagnostics.clear(); },
        plan(app) {
            let snapshot;
            try { snapshot = read(); }
            catch (error) {
                if (Object.values(getSettings().presetAssemblies?.[app] || {}).some(rule => rule.mode === 'custom')) throw error;
                return null; // Older settings keep the existing request path.
            }
            const rule = presetRule(getSettings(), app, snapshot);
            const startedRevision = revision;
            const custom = rule.mode === 'custom';
            if (custom && snapshot.support) throw fail(snapshot.support);
            if (custom && snapshot.rows.some(row => row.enabled && !row.controllable && Object.hasOwn(rule.choices, row.id) && rule.choices[row.id] === false))
                throw fail('曾排除的条目现在无法独立匹配或过滤，请刷新组装页面并重新保存。');
            const excluded = new Set(custom ? snapshot.rows.filter(row => row.controllable && row.enabled && rule.choices[row.id] === false).map(row => row.id) : []);
            let sources = null, assembled = false;
            const diagnostic = { app, preset: snapshot.name, mode: rule.mode, status: '尚未提交', included: [], excluded: [], absent: [],
                special: snapshot.rows.filter(row => !row.controllable).map(row => ({ id: row.id, name: row.name, reason: row.reason })),
                note: '仅记录本次请求条目名称与标识，不保存预设正文或剧情。' };
            const current = () => {
                if (!custom) return true;
                try { return revision === startedRevision && read().fingerprint === snapshot.fingerprint; } catch { return false; }
            };
            return {
                current,
                capture(messages) {
                    if (!custom) return;
                    if (!current()) throw fail('请求期间酒馆预设发生变化，本次没有提交模型。');
                    sources = sourceMessages(getHost().promptManager?.messages);
                    if (stable(sources.map(item => item.message)) !== stable(structuredClone(messages))) throw fail('酒馆消息已合并或被扩展改写，无法证明条目来源，本次没有提交模型。');
                    // Duplicate leaf IDs cannot be safely attributed to one preset entry.
                    for (const id of excluded) {
                        const matches = sources.filter(item => item.id === id);
                        if (matches.length > 1 || matches.some(item => item.owner !== id)) throw fail('组装结果来源标识重复或不属于该预设条目，本次没有提交模型。');
                    }
                },
                filter(messages) {
                    if (!custom) return messages;
                    if (!current() || !sources || stable(structuredClone(messages)) !== stable(sources.map(item => item.message)))
                        throw fail('最终请求与可核对的条目来源不一致，本次没有提交模型。');
                    const present = new Set(sources.map(item => item.id));
                    diagnostic.included = []; diagnostic.excluded = []; diagnostic.absent = [];
                    for (const row of snapshot.rows.filter(item => item.controllable)) {
                        const list = !present.has(row.id) ? diagnostic.absent : excluded.has(row.id) ? diagnostic.excluded : diagnostic.included;
                        list.push({ id: row.id, name: row.name });
                    }
                    assembled = true;
                    return messages.filter((_message, index) => !excluded.has(sources[index].id));
                },
                submitted() {
                    if (custom && !assembled) throw fail('自定义组装未完成来源校验，本次没有提交模型。');
                    diagnostic.status = '已发起转发请求（不代表模型已成功回复）';
                    diagnostic.submittedAt = Date.now();
                    if (!custom) diagnostic.note = '跟随酒馆，未执行条目过滤；未逐条核验实际纳入内容。';
                    diagnostics.set(app, structuredClone(diagnostic));
                },
            };
        },
    };
}
