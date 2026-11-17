// Phone tasks use SillyTavern's real quiet generation, including presets,
// macros, world info and extension interceptors. Never rebuild its context.
export function phoneQuietOptions(context, prompt, contact) {
    return { quietPrompt: prompt, quietToLoud: false, skipWIAN: false,
        forceChId: context.groupId != null && context.groupId !== '' ? contact?.characterId ?? null : null };
}

const unsupported = () => Object.assign(new Error('当前酒馆无法将完整生成内容交给独立 API，请更新酒馆或使用「跟随酒馆」。'), { retryable: false });
const cancelled = () => Object.assign(new Error('聊天或 API 配置已变化，本次操作已取消。'), { retryable: false });

// A request-local serialization handoff: the host finishes its normal prompt
// and request hooks, then yields immediately before its network request. No
// fetch monkey-patch, global settings change, dry run, or paid host-model call.
export async function captureHostRequest(context, prompt, contact, isCurrent = () => true) {
    const bus = context.eventSource, types = context.event_types ?? context.eventTypes ?? {};
    const names = ['GENERATION_STARTED', 'GENERATE_AFTER_DATA', 'CHAT_COMPLETION_SETTINGS_READY'];
    if (context.mainApi !== 'openai' || typeof context.generateQuietPrompt !== 'function' ||
        typeof bus?.on !== 'function' || typeof bus?.removeListener !== 'function' || names.some(n => !types[n])) throw unsupported();
    if (!isCurrent()) throw cancelled();
    const marker = '\n<durian-request-' + crypto.randomUUID() + '/>';
    const handoff = Object.freeze({ durianPhoneTransportHandoff: true });
    let captured = null, failure = null, owner = false;
    const hooks = [], guarded = [];
    const hasMarker = value => typeof value === 'string' ? value.includes(marker.trim()) :
        value && typeof value === 'object' ? Object.values(value).some(hasMarker) : false;
    const clean = value => typeof value === 'string' ? value.split(marker).join('').split(marker.trim()).join('') :
        Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clean(v)])) : value;
    function guard(target, serialize) {
        if (!target || typeof target !== 'object') { failure = unsupported(); return; }
        const previous = Object.getOwnPropertyDescriptor(target, 'toJSON');
        Object.defineProperty(target, 'toJSON', { configurable: true, enumerable: false, value: serialize });
        guarded.push(() => { if (previous) Object.defineProperty(target, 'toJSON', previous); else delete target.toJSON; });
    }
    function listen(name, fn) { bus.on(types[name], fn); hooks.push([types[name], fn]); }
    listen('GENERATION_STARTED', (type, options, dryRun) => {
        if (!dryRun) owner = type === 'quiet' && options?.quiet_prompt?.includes(marker.trim());
    });
    listen('GENERATE_AFTER_DATA', (data, dryRun) => {
        if (dryRun) return;
        const matches = hasMarker(data?.prompt);
        if (!matches && !owner) return;
        // If the host lacks the final settings hook, or another extension has
        // removed the task, serialization still cannot fall through to its API.
        const preventFallback = () => { throw failure || (isCurrent() ? unsupported() : cancelled()); };
        guard(data?.prompt, preventFallback);
        if (Array.isArray(data?.prompt)) for (const message of data.prompt) guard(message, preventFallback);
        if (!matches) failure = unsupported();
    });
    listen('CHAT_COMPLETION_SETTINGS_READY', data => {
        // Inspect entries individually: the prompt array carries a fallback
        // guard until this final hook. Filtering in ST retains these entries.
        const messages = data?.messages;
        if (!Array.isArray(messages) || !messages.some(m => hasMarker(m))) return;
        guard(data, () => {
            if (!isCurrent()) throw cancelled();
            if (failure) throw failure;
            // Clone after ALL request hooks, without serializing our guards.
            captured = clean(Object.fromEntries(Object.entries(data)));
            if (!Array.isArray(captured.messages) || !captured.messages.length) throw unsupported();
            throw handoff;
        });
    });
    try {
        await context.generateQuietPrompt(phoneQuietOptions(context, prompt + marker, contact));
        // Some group wrappers handle the handoff exception themselves.
        if (!captured) throw unsupported();
    } catch (error) {
        if (error !== handoff) throw error;
    } finally {
        for (const [name,fn] of hooks) bus.removeListener(name,fn);
        for (const restore of guarded.reverse()) restore();
    }
    if (!isCurrent()) throw cancelled();
    if (!captured) throw unsupported();
    return captured;
}
