import { messageSignatures, isMemoryHidden } from './journal.js?v=1.2.57';

// Kept for external callers; phone requests no longer enter Quiet/Generate.
export function phoneQuietOptions(context, prompt, contact) {
    return { quietPrompt: prompt, quietToLoud: false, skipWIAN: false,
        forceChId: context.groupId != null && context.groupId !== '' ? contact?.characterId ?? null : null };
}
const fail = message => Object.assign(new Error(message), { retryable: false });
const cancelled = () => fail('聊天或 API 配置已变化，本次操作已取消。');
const storyTypes = [undefined, 'normal', 'regenerate', 'swipe', 'continue', 'impersonate'];
const copy = value => structuredClone(value);
const chatKey = c => JSON.stringify([c.groupId ?? null, c.characterId ?? null, c.getCurrentChatId?.() ?? c.chatId]);
const fingerprint = c => JSON.stringify([c.mainApi, c.characters, c.powerUserSettings, c.chatCompletionSettings, c.name1, c.name2]);
// Context freshness includes visibility, unlike journal revision stability.
const contextSignatures = chat => messageSignatures(chat).map((s,i) => JSON.stringify([s,!!chat[i].is_system,isMemoryHidden(chat[i])]));
const portable = ['temperature','frequency_penalty','presence_penalty','top_p','top_k','min_p','top_a','typical_p',
    'max_tokens','max_completion_tokens','stop','seed','logit_bias','logprobs','top_logprobs',
    'include_reasoning','reasoning_effort','verbosity','custom_prompt_post_processing','user_name','char_name','group_names'];

// Capture a task's settled story BEFORE asynchronous memory/world-book reads.
// Methods remain host methods; no host objects or chat messages are modified.
export function freezePhoneContext(context, sourceIndex = context.chat?.length - 1) {
    const frozen = { ...context, chat: copy((context.chat || []).slice(0, sourceIndex + 1)) };
    for (const key of ['characters','groups','powerUserSettings','chatCompletionSettings','extensionPrompts']) {
        // extension prompt filters can be functions, so copy only their data.
        if (key === 'extensionPrompts') frozen[key] = Object.fromEntries(Object.entries(context[key] || {})
            .map(([id, item]) => [id, { ...item }]));
        else if (context[key] !== undefined) frozen[key] = copy(context[key]);
    }
    return frozen;
}

function storyMessages(chat) {
    return chat.filter(m => !m.is_system && !isMemoryHidden(m) && typeof m.mes === 'string' && m.mes.trim())
        .map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.name ? `${m.name}: ${m.mes}` : m.mes }));
}

// Fallback expands stable identity/card macros only. Arbitrary state-changing
// macros must not execute a second time in a concurrent phone task. A processed
// story snapshot retains the host's already-expanded macros verbatim.
function expand(text, c, card) {
    const data = card?.data || card || {};
    const values = { user: c.name1 || 'user', char: card?.name || c.name2 || 'char',
        description: data.description || '', personality: data.personality || '', scenario: data.scenario || '',
        persona: c.powerUserSettings?.persona_description || '' };
    return String(text || '').replace(/\{\{\s*(user|char|description|personality|scenario|persona)\s*\}\}/gi, (_, k) => values[k.toLowerCase()]);
}

function selectedCards(c, contact) {
    if (c.groupId != null && c.groupId !== '') {
        if (Number.isInteger(contact?.characterId)) return [c.characters?.[contact.characterId]].filter(Boolean);
        const members = c.groups?.find(g => String(g.id) === String(c.groupId))?.members || [];
        return (c.characters || []).filter(card => members.includes(card.avatar));
    }
    return [c.characters?.[c.characterId]].filter(Boolean);
}

async function fallbackMessages(c, contact, loadWorldModule, isCurrent) {
    const cards = selectedCards(c, contact), card = cards[0], settings = c.chatCompletionSettings || {};
    const field = key => cards.map(item => (item.data || item)[key]).filter(Boolean).join('\n\n');
    let world = null;
    try { world = await loadWorldModule(); } catch { /* Old hosts still expose card/chat/persona books. */ }
    if (!isCurrent()) throw cancelled();
    const names = new Set([...(world?.selected_world_info || []), c.chatMetadata?.world_info,
        c.powerUserSettings?.persona_description_lorebook].filter(Boolean));
    for (const item of cards) {
        const name = item.data?.extensions?.world;
        if (name) names.add(name);
        const filename = item.avatar?.replace(/\.[^.]+$/, '');
        for (const extra of world?.world_info?.charLore?.find(row => row.name === filename)?.extraBooks || []) names.add(extra);
    }
    const entries = cards.flatMap(item => (item.data || item).character_book?.entries || []);
    for (const name of names) {
        if (typeof c.loadWorldInfo !== 'function') throw fail('当前酒馆无法读取已绑定世界书，请更新酒馆后重试。');
        const book = await c.loadWorldInfo(name);
        if (!isCurrent()) throw cancelled();
        if (!book?.entries) throw fail('读取手机上下文的已绑定世界书失败，本次未发送模型请求。');
        entries.push(...Object.values(book.entries));
    }
    const scan = c.chat.filter(m => !m.is_system && !isMemoryHidden(m)).slice(-(world?.world_info_depth || 2)).map(m => m.mes).join('\n');
    const matches = (key, entry) => {
        const text = entry.caseSensitive ? scan : scan.toLowerCase();
        const needle = entry.caseSensitive ? String(key) : String(key).toLowerCase();
        return !!needle && text.includes(needle);
    };
    const lore = entries.filter(e => {
        if (e.disable || e.enabled === false || e.probability === 0) return false;
        if (e.constant) return true;
        const keys = e.key || e.keys || [], secondary = e.keysecondary || e.secondary_keys || [];
        if (!keys.some(k => matches(k, e))) return false;
        if (!e.selective || !secondary.length) return true;
        const some = secondary.some(k => matches(k, e)), every = secondary.every(k => matches(k, e));
        return [some, !every, !some, every][e.selectiveLogic ?? 0] ?? some;
    }).sort((a,b) => (b.order ?? b.insertion_order ?? 100) - (a.order ?? a.insertion_order ?? 100))
        .map(e => expand(e.content, c, card));
    const messages = [], append = (content, role = 'system') => {
        if (typeof content === 'string' && content.trim()) messages.push({ role: ['system','user','assistant'].includes(role) ? role : 'system', content: expand(content,c,card) });
    };
    const markers = {
        charDescription: field('description'), charPersonality: field('personality'), scenario: field('scenario'),
        personaDescription: c.powerUserSettings?.persona_description || '',
        worldInfoBefore: [...new Set(lore)].join('\n'), worldInfoAfter: '', dialogueExamples: field('mes_example'),
    };
    const prompts = settings.prompts || [];
    const order = settings.prompt_order?.find(o => Number(o.character_id) === Number(c.characterId))?.order
        || settings.prompt_order?.find(o => o.character_id === 100001)?.order || prompts.map(p => ({ identifier:p.identifier, enabled:p.enabled !== false }));
    const used = new Set();
    for (const item of order) {
        used.add(item.identifier);
        if (item.enabled === false) continue;
        if (item.identifier === 'chatHistory') { messages.push(...storyMessages(c.chat)); continue; }
        if (Object.hasOwn(markers,item.identifier)) append(markers[item.identifier]);
        else { const p = prompts.find(p => p.identifier === item.identifier); if (p && !p.marker) append(p.content,p.role); }
    }
    // Hosts without prompt-manager data still keep cards, persona, lore, memory
    // and all settled visible history. Never pull hidden summarized floors back.
    for (const [key, value] of Object.entries(markers)) if (!used.has(key)) append(value);
    for (const item of Object.values(c.extensionPrompts || {})) {
        if (item?.position === -1 || item?.filter === false) continue;
        if (typeof item?.filter === 'function' && !await item.filter()) continue;
        append(item?.value);
    }
    if (!used.has('chatHistory')) messages.push(...storyMessages(c.chat));
    return messages;
}

// Passive observation only: no Generate call, marker, toJSON guard, stop event
// interception, global patch, or persisted story/credential copy.
export function createPhoneContext({ getContext, loadWorldModule = () => import('/scripts/world-info.js') }) {
    const c = getContext(), bus = c.eventSource, types = c.event_types || c.eventTypes || {}, subscriptions = [];
    let snapshot = null, generation = null, closed = false;
    const identity = context => ({ key:chatKey(context), metadata:context.chatMetadata, fingerprint:fingerprint(context) });
    const same = (item, context) => item && item.key === chatKey(context) && item.metadata === context.chatMetadata && item.fingerprint === fingerprint(context);
    const listen = (key, fn) => { if (types[key] && bus?.on) { bus.on(types[key],fn); subscriptions.push([types[key],fn]); } };
    const invalidate = () => { snapshot = null; generation = null; };
    listen('GENERATION_STARTED', (type, _options, dryRun) => {
        generation = !dryRun && storyTypes.includes(type) ? identity(getContext()) : null;
    });
    listen('CHAT_COMPLETION_SETTINGS_READY', data => {
        const now = getContext();
        if (!same(generation,now) || now.mainApi !== 'openai' || !storyTypes.includes(data?.type) || !Array.isArray(data?.messages) || !data.messages.length) return;
        // Hold the event argument until preparation, so later async listeners'
        // edits/replacements are visible. We never mutate it or its descriptors.
        snapshot = { ...identity(now), data, signatures:contextSignatures(now.chat || []) };
    });
    listen('GENERATE_AFTER_DATA', (data, dryRun) => {
        const now = getContext();
        if (dryRun || now.mainApi === 'openai' || !same(generation,now) || typeof data?.prompt !== 'string') return;
        snapshot = { ...identity(now), data, signatures:contextSignatures(now.chat || []) };
    });
    for (const event of ['CHAT_CHANGED','CHAT_LOADED','CHAT_RENAMED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED',
        'MESSAGE_SWIPE_DELETED','MAIN_API_CHANGED','SETTINGS_UPDATED','WORLDINFO_UPDATED','WORLDINFO_SETTINGS_UPDATED','CHARACTER_EDITED','CHATCOMPLETION_SOURCE_CHANGED']) listen(event,invalidate);
    return {
        async prepare(context, prompt, contact, isCurrent = () => true, options = {}) {
            if (closed || !isCurrent()) throw cancelled();
            const source = options.context || freezePhoneContext(context);
            const signatures = contextSignatures(source.chat || []), saved = snapshot;
            const compatible = same(saved,source) && saved.signatures.length <= signatures.length &&
                saved.signatures.every((s,i) => s === signatures[i]) &&
                !(source.groupId != null && source.groupId !== '' && Number.isInteger(contact?.characterId) && contact.characterId !== Number(source.characterId));
            let messages, params = {}, mode;
            if (compatible) {
                const data = saved.data;
                messages = Array.isArray(data.messages) ? copy(data.messages) : [{ role:'system',content:data.prompt }];
                params = Object.fromEntries(portable.filter(k => data[k] !== undefined).map(k => [k,copy(data[k])]));
                messages.push(...storyMessages(source.chat.slice(saved.signatures.length)));
                mode = 'story_snapshot';
            } else {
                messages = await fallbackMessages(source,contact,loadWorldModule,isCurrent);
                const s = source.chatCompletionSettings || {};
                for (const [field,key] of Object.entries({ temperature:'temp_openai',frequency_penalty:'freq_pen_openai',presence_penalty:'pres_pen_openai',top_p:'top_p_openai',top_k:'top_k_openai',min_p:'min_p_openai',top_a:'top_a_openai',seed:'seed',max_tokens:'openai_max_tokens' })) {
                    if (Number.isFinite(Number(s[key])) && s[key] != null) params[field] = Number(s[key]);
                }
                if (typeof s.show_thoughts === 'boolean') params.include_reasoning = s.show_thoughts;
                for (const key of ['reasoning_effort','verbosity','custom_prompt_post_processing']) if (s[key] !== undefined) params[key] = copy(s[key]);
                mode = 'rebuilt_context';
            }
            if (closed || !isCurrent()) throw cancelled();
            messages.push({ role:'system',content:expand(prompt,source,selectedCards(source,contact)[0]) });
            return { ...params, messages, contextMode:mode };
        },
        destroy() { closed = true; invalidate(); for (const [event,fn] of subscriptions) { if (bus.removeListener) bus.removeListener(event,fn); else bus.off?.(event,fn); } },
    };
}

// Compatibility export for integrations that supplied the old prepare function.
// Without a long-lived observer it uses the read-only builder, never Quiet.
export async function captureHostRequest(context, prompt, contact, isCurrent = () => true, options = {}) {
    const reader = createPhoneContext({getContext:() => context});
    try { return await reader.prepare(context,prompt,contact,isCurrent,options); }
    finally { reader.destroy(); }
}

// The official service clones settings and builds a request-local payload; it
// neither calls Generate nor emits SETTINGS_READY/GENERATION_STOPPED. Mapping
// every effective setting avoids silently picking a different saved preset.
export async function hostCompletionPayload(context, messages, load = () => import('/scripts/openai.js')) {
    if (context.mainApi !== 'openai' || typeof context.ChatCompletionService?.presetToGeneratePayload !== 'function')
        throw fail('当前跟随酒馆连接不支持隔离请求。请使用酒馆聊天补全接口并更新酒馆，或选择独立 API。');
    const settings = copy(context.chatCompletionSettings || {}), module = await load();
    if (!module.settingsToUpdate) throw fail('当前酒馆缺少独立请求设置接口，请更新酒馆或使用独立 API。');
    const preset = Object.fromEntries(Object.entries(module.settingsToUpdate).filter(([,row]) => Object.hasOwn(settings,row[1]))
        .map(([key,row]) => [key,copy(settings[row[1]])]));
    if (settings.bias_presets !== undefined) preset.bias_presets = copy(settings.bias_presets);
    const model = (context.getChatCompletionModel || module.getChatCompletionModel)?.(settings);
    if (!model && !(model === null && settings.chat_completion_source === 'openrouter')) throw fail('请先在酒馆选择可用的聊天补全模型。');
    return context.ChatCompletionService.presetToGeneratePayload(preset, {}, {messages:copy(messages),model,stream:false});
}
