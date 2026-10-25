import { findProactiveEvidence } from './proactive-evidence.js?v=0.24.20';
import { narrativeReplyCount } from './contact-policy.js?v=0.24.20';
import { messageSignatures, isMemoryHidden } from './journal.js?v=0.24.20';
// Only the current single-chat character or the last actual group speaker may call.
export function incomingParticipant(context) {
    const characters = context.characters ?? [];
    let index = context.characterId;
    if (context.groupId != null && context.groupId !== '') {
        const group = context.groups?.find(item => String(item.id) === String(context.groupId));
        const last = context.chat?.at(-1);
        if (!group || !last || last.is_user || last.is_system) return null;
        const matches = characters.map((character, i) => ({ character, i })).filter(({ character }) =>
            group.members?.includes(character.avatar) &&
            (last.original_avatar ? character.avatar === last.original_avatar : character.name === last.name));
        if (matches.length !== 1) return null;
        index = matches[0].i;
    }
    const character = characters[index];
    if (!character?.name || !character.avatar) return null;
    return { id: 'card:' + character.avatar, name: character.name, characterId: Number(index) };
}

export function validateIncoming(data, chat, sources = []) {
    if (data.status === 'none') return null;
    if (data.status !== 'ringing' || !['known_number', 'mutual_contact', 'public_contact'].includes(data.route) ||
        data.can_obtain_number !== true || typeof data.evidence !== 'string' || data.evidence.trim().length < 4 ||
        typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 1000) {
        throw new Error('来电判断格式不正确，请重试。');
    }
    const basis=findProactiveEvidence(data.evidence,chat,sources,data.evidence_source);
    if(!basis)throw new Error('来电缺少有效号码来源依据，未生成来电。');
    if (data.route !== 'known_number' && (typeof data.channel !== 'string' || data.channel.trim().length < 2 || !data.evidence.includes(data.channel))) {
        throw new Error('来电没有可核对的号码获取途径，未生成来电。');
    }
    return { route: data.route, evidence: data.evidence, channel: data.channel || '', sourceIndex:basis.sourceIndex, sourceKind:basis.source, reason: data.reason.trim() };
}

// Defer until the host finishes its event stack. Never await a new quiet model
// request inside a foreground generation event, or recurse on quiet completion.
export function watchIncoming({ getContext, phone }) {
    const context = getContext();
    const bus = context?.eventSource;
    const types = context?.event_types ?? context?.eventTypes ?? {};
    const subscriptions = [];
    let pending = null;
    let group = null;
    let nestedQuiet = 0;
    let timer;
    let disposed = false;
    const capture = () => ({ metadata: getContext().chatMetadata, chat: JSON.stringify(messageSignatures(getContext().chat ?? [])), replies:narrativeReplyCount(getContext().chat ?? []) });
    const validType = type => !['quiet', 'impersonate'].includes(type);
    function cancel() { pending = null; group = null; nestedQuiet = 0; clearTimeout(timer); }
    function listen(name, handler) {
        if (types[name] && bus?.on) { bus.on(types[name], handler); subscriptions.push([types[name], handler]); }
    }
    function schedule(basis) {
        if (!basis) return;
        clearTimeout(timer);
        const current = capture();
        const last = getContext().chat?.at(-1);
        if (current.metadata !== basis.metadata || current.chat === basis.chat || !last || last.is_user || (last.is_system && !isMemoryHidden(last))) return;
        let attempts=0;
        async function check(){
            if(disposed||getContext().chatMetadata!==current.metadata||capture().chat!==current.chat)return;
            const result=await phone.checkIncoming({narrative:true,scheduled:true,previousReplies:basis.replies}).catch(()=>null);
            // Wait locally for the host/another phone task to settle. No API
            // request has happened for GENERATING or a busy skipped task.
            if((result?.code==='GENERATING'||result?.skipped&&phone.snapshot?.().busy)&&++attempts<40)
                timer=setTimeout(check,250);
        }
        timer=setTimeout(check,0);
    }
    listen('GENERATION_STARTED', (type, _options, dryRun) => {
        if(dryRun)return;
        if(!validType(type)){if(pending)nestedQuiet++;return;}
        clearTimeout(timer);nestedQuiet=0;pending=capture();
    });
    listen('GENERATION_ENDED', () => {
        if(nestedQuiet){nestedQuiet--;return;}
        const basis = pending; pending = null;
        if (getContext().groupId == null || getContext().groupId === '') schedule(basis);
    });
    listen('GROUP_WRAPPER_STARTED', ({ type } = {}) => { group = validType(type) ? capture() : null; });
    listen('GROUP_WRAPPER_FINISHED', () => { const basis = group; group = null; pending = null; schedule(basis); });
    for (const name of ['GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED']) listen(name, cancel);
    return { destroy() {
        disposed = true; cancel();
        for (const [type, handler] of subscriptions) {
            if (bus.removeListener) bus.removeListener(type, handler); else bus.off?.(type, handler);
        }
    } };
}
