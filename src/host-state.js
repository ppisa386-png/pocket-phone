// Read live exports, not a copied boolean or a theme's button appearance.
export function createGenerationReader(host, getContext, fallback) {
    const read = () => {
        const context = getContext();
        for (const [owner, label] of [[host, 'host'], [context, 'context']]) {
            try {
                if (typeof owner?.isGenerating === 'function') {
                    const value = owner.isGenerating();
                    if (typeof value === 'boolean') { read.source=label+'.isGenerating'; return value; }
                }
            } catch { /* Older hosts may not expose this function. */ }
        }
        if (context?.groupId == null || context.groupId === '') {
            try { if(typeof host?.is_send_press==='boolean'){read.source='host.is_send_press';return host.is_send_press;} } catch {}
        }
        read.source='compatibility';
        return fallback();
    };
    read.source='unread';
    return read;
}
