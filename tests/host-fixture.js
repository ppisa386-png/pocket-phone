import { EventEmitter } from 'node:events';

// Mirrors ST's awaited event bus, including swallowed listener exceptions.
export class HostEvents extends EventEmitter {
    async emit(name, ...args) {
        for (const listener of this.listeners(name)) {
            try { await listener(...args); } catch { /* ST logs, then continues. */ }
        }
        return true;
    }
}
export function installHostGeneration(context, options = {}) {
    const bus = context.eventSource ||= new HostEvents();
    context.mainApi = 'openai';
    context.event_types ||= {};
    for (const n of ['GENERATION_STARTED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY']) context.event_types[n] = n;
    const host = { requests: [], options: [], cleanups: 0, preparations: 0 };
    context.generateQuietPrompt = async quiet => {
        host.options.push(quiet); host.preparations++;
        await bus.emit('GENERATION_STARTED','quiet',{quiet_prompt:quiet.quietPrompt},false);
        await options.beforePrepare?.(quiet);
        const messages = [
            {role:'system',content:'Host preset: language, macros, position and enabled entries'},
            {role:'system',content:'Host character, persona, triggered lore and plugin memory'},
            ...(context.chat || []).map(m=>({role:m.is_user?'user':'assistant',content:m.mes})),
            {role:'system',content:quiet.quietPrompt},
        ];
        const generated = {prompt:messages};
        if (options.stripTask) messages.at(-1).content='removed';
        await bus.emit('GENERATE_AFTER_DATA', generated, false);
        try {
            const data = {type:'quiet',messages:generated.prompt.filter(m=>m && typeof m==='object'),model:'host-model',
                temperature:0.83,max_tokens:4321,chat_completion_source:'custom',custom_url:'https://host.invalid/v1',
                custom_include_headers:'Authorization: host-secret',reverse_proxy:'https://host.invalid/v1',proxy_password:'host-secret',stream:false};
            if (!options.skipReady) await bus.emit('CHAT_COMPLETION_SETTINGS_READY', data);
            const body=JSON.parse(JSON.stringify(data)); // ST fetch body boundary.
            host.requests.push(body);
            return 'HOST RESULT';
        } finally {host.cleanups++;}
    };
    return host;
}


// One real-story pipeline simulation for passive observers; never a model call.
export async function publishStorySnapshot(context) {
    const bus = context.eventSource;
    await bus.emit('GENERATION_STARTED','normal',{},false);
    const generated = {prompt:[{role:'system',content:'Host preset and processed lore'},
        ...(context.chat || []).filter(m=>!m.is_system).map(m=>({role:m.is_user?'user':'assistant',content:m.mes}))]};
    await bus.emit('GENERATE_AFTER_DATA',generated,false);
    const data = {type:'normal',messages:generated.prompt,temperature:.83,max_tokens:4321,model:'host-model',proxy_password:'host-secret'};
    await bus.emit('CHAT_COMPLETION_SETTINGS_READY',data);
    await bus.emit('GENERATION_ENDED');
    return data;
}
