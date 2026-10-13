// Keep narrative-only instructions in the actual request when a preset omits
// extension slots. Callers own preparation, generation lifetime and chat guards.
export function createNarrativePrompt({ getContext, key, depth = 0 }) {
    const c = getContext(), bus = c?.eventSource, types = c?.event_types ?? c?.eventTypes ?? {};
    const hooks = []; let prepared = null;
    function inject(messages, data) {
        if (data?.dryRun || ['quiet', 'impersonate'].includes(data?.type) || !Array.isArray(messages) || !prepared?.current()) return;
        const { text } = prepared;
        if (messages.some(m => typeof m?.content === 'string' && m.content.includes(text))) return;
        const lastUser = messages.findLastIndex(m => m?.role === 'user');
        messages.splice(lastUser < 0 ? messages.length : lastUser, 0, {role:'system',content:text});
    }
    function listen(name, fn, first = false) {
        if (!types[name] || !bus?.on) return;
        const add = first && typeof bus.makeFirst === 'function' ? bus.makeFirst : bus.on;
        add.call(bus, types[name], fn); hooks.push([types[name], fn]);
    }
    listen('CHAT_COMPLETION_PROMPT_READY', data => inject(data?.chat, data), true);
    listen('CHAT_COMPLETION_SETTINGS_READY', data => inject(data?.messages, data));
    function clear() { prepared = null; getContext()?.setExtensionPrompt?.(key, '', 1, depth, false, 0); }
    return {
        clear,
        set(text, current) {
            if (!text || !current()) return;
            prepared = {text, current};
            getContext()?.setExtensionPrompt?.(key, text, 1, depth, false, 0, current);
        },
        destroy() { clear(); for (const [name, fn] of hooks) { if (bus.removeListener) bus.removeListener(name, fn); else bus.off?.(name, fn); } },
    };
}
