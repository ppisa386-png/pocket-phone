import { localizedPerson } from './names.js?v=1.0';
const normalizeName = value => String(value).normalize('NFKC').trim().toLowerCase();
const visible = message => message && !message.is_system && !message.is_hidden && !message.hidden;

const searchName = value => normalizeName(value).replace(/[\s·.・'’_-]/g,'');
const quoteText = value => String(value).normalize('NFKC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g,'');

export function establishedSources(context) {
    const names = { user: context.name1 || 'user', char: context.name2 || 'char' };
    const expand = text => String(text || '').replace(/\{\{\s*(user|char)\s*\}\}/gi, (_, key) => names[key.toLowerCase()]);
    const sources = [{ source: 'persona', text: expand(context.powerUserSettings?.persona_description) }];
    const grouped = context.groupId != null && context.groupId !== '';
    const members = grouped ? context.groups?.find(g => String(g.id) === String(context.groupId))?.members || [] : [];
    for (const [index, card] of (context.characters || []).entries()) {
        if (grouped ? !members.includes(card.avatar) : context.characterId == null || context.characterId === '' || index !== Number(context.characterId)) continue;
        const data = card.data || card;
        for (const field of ['description', 'personality', 'scenario']) sources.push({ source: 'card:' + index + ':' + field, text: expand(data[field]) });
        for (const [entryIndex, entry] of (data.character_book?.entries || []).entries()) {
            if (entry.enabled !== false) sources.push({ source: 'world:' + index + ':' + entryIndex, text: expand(entry.content) });
        }
    }
    return sources.filter(source => source.text.trim());
}

// Request-local references keep evidence in the source language. The model
// chooses passages; it does not have to reproduce or translate their wording.
export function establishedReferences(sources) {
    return sources.flatMap((source, sourceIndex) => {
        const passages = [];
        for (const line of String(source.text).split(/\r?\n/).filter(line => line.trim())) {
            let rest = line;
            while (rest.length > 800) {
                const boundary = Math.max(rest.lastIndexOf(' ', 800), rest.lastIndexOf('。', 799) + 1, rest.lastIndexOf('；', 799) + 1);
                const end = boundary >= 400 ? boundary : 800;
                passages.push(rest.slice(0, end)); rest = rest.slice(end);
            }
            if (rest.trim()) passages.push(rest);
        }
        return passages.map((text, index) => ({ ref: 'S' + (sourceIndex + 1) + '.P' + (index + 1), source: source.source, text }));
    });
}

export function establishedContactPrompt(instruction, context, sources, existing) {
    return instruction + '\n当前任务：user 点击「一键新增」。仅提取正文开始之前，人物设定已明确与 user 建立关系的具名人物。父母、亲友、同事、熟人、前任、竞争对手、仇人、死对头等正面或负面关系均加入。不要进行号码是否交换、人物是否愿意、当前是否活着或有通信能力等资格判定。排除没有名字的人、仅一面之缘的路人、只与其他角色有关而与 user 无既有关系的人，以及正文开始后才认识的人。不能把资料中每个名字都当作 user 的熟人。' +
        '\n仅以下编号设定片段可用于本次提取；请求上下文里的后续正文、手机交流、记忆摘要不能扩大名单。每个人的 evidence_refs 填包含原名及与 user 既有关系的片段 ref（1～6个），姓名和关系分在不同片段时一起选择。由程序按编号取原文，不要重抄、翻译或总结 evidence。source_name 填所选片段中的原文姓名/短名，保留原语言；name 仍填完整中文显示姓名，aliases 保留其他原名。编号存在不等于人物符合资格：必须判断人物与 user 的既有关系，不能把片段提到的所有名字都加入。没有明确号码就 number=null，不编造数字；不新增社媒账号。已有联系人若需改成设定中的中文姓名，也返回该项及原文 aliases，仅更新显示姓名，不改号码或其他资料。不需要 user_has_number、can_use_phone 或生存状态判断。' +
        '\n姓名要求：优先保存完整中文姓名，西式姓名用中点 · 连接名与姓，不要只摘父母的名。先采用设定已有完整姓名及中译；只有短名时，结合 user 的完整姓名、亲属关系、原生家庭姓氏与当地命名习惯合理推理补全。若设定支持同一原生家庭、当地通常共用姓氏且没有反例，可用明确的家族姓氏补全父母姓名；不要机械把 user 婚后姓赋给其父母，也不要强迫不同姓氏、保留婚前姓、收养或不同文化的人同姓。不凭空编中间名；确实无法可靠推理才保留名或外号。source_name 必须保留设定中的短名或原文名，aliases 可补充其他原名，使完整姓名可对应原文；原文由程序取回，不把补全姓名伪装成原文。已有短名联系人也返回完整姓名和旧名 aliases 以更新原条目。' +
        '\nuser：' + context.name1 + '\n编号设定片段：' + JSON.stringify(establishedReferences(sources)) + '\n已有联系人：' + JSON.stringify(existing.map(c => ({name:c.name,id:c.id}))) +
        '\n只输出 JSON：{"contacts":[{"name":"具名人物的中文显示名","source_name":"片段中的原文姓名或短名","aliases":[],"relationship":"与 user 的既有关系","established":true,"incidental":false,"evidence_refs":["S1.P1"],"number":null}]}。ref必须从本次片段选择，示例编号不代表实际依据；没有符合者返回空数组。';
}

export function validateEstablishedContacts(data, chat, context, sources, existing = [], onRejected = () => {}) {
    if (!Array.isArray(data.contacts) || data.contacts.length > 200) throw new Error('联系人结果格式不正确。');
    const contacts = new Map();
    const references = new Map(establishedReferences(sources).map(part => [part.ref, part]));
    for (const [index, item] of data.contacts.entries()) {
        const reject = reason => onRejected(index + 1, reason);
        if (!item || typeof item.name !== 'string' || !item.name.trim() || item.established !== true || item.incidental === true || typeof item.relationship !== 'string' || !item.relationship.trim()) { reject('姓名或既有关系字段不完整，或标为偶遇人物'); continue; }
        let quotes;
        if (Object.hasOwn(item, 'evidence_refs')) {
            const refs = item.evidence_refs;
            if (!Array.isArray(refs) || !refs.length || refs.length > 6 || refs.some(ref => typeof ref !== 'string' || !references.has(ref))) {
                reject('evidence_refs 需包含本次设定中的1～6个有效片段编号'); continue;
            }
            quotes = [...new Set(refs)].map(ref => references.get(ref).text);
        } else {
            // Older prompts remain supported, but an invalid explicit reference
            // cannot fall back to model-written evidence from other material.
            quotes = (Array.isArray(item.evidence) ? item.evidence : [item.evidence]).filter(q => typeof q === 'string' && q.trim().length >= 4);
            const source = sources.find(s => s.source === item.source);
            if (!source) { reject('source 未对应本次提供的设定资料'); continue; }
            if (!quotes.length || quotes.length > 6) { reject('evidence 缺失、过短或超过六段'); continue; }
            if (!quotes.every(q => quoteText(source.text).includes(quoteText(q)))) { reject('evidence 不是对应设定资料中的原文，可能被改写或来自后续正文'); continue; }
        }
        const evidence = quotes.join('\n');
        const sourceName = typeof item.source_name === 'string' ? item.source_name.trim() : '';
        if (sourceName && (sourceName.length > 100 || !searchName(sourceName) || !searchName(evidence).includes(searchName(sourceName)))) {
            reject('source_name 未出现在所选设定原文中'); continue;
        }
        const identity = localizedPerson({ ...item, aliases: [...(Array.isArray(item.aliases) ? item.aliases : []), ...(sourceName ? [sourceName] : [])] }, context, [...existing,...contacts.values()]);
        const name = identity.name;
        if (normalizeName(name) === normalizeName(context.name1)) { reject('候选是 user 本人'); continue; }
        const aliases = identity.aliases.map(searchName).filter(Boolean);
        if (!aliases.some(n => searchName(evidence).includes(n))) { reject('引用原文未包含候选姓名或 aliases 中的原名'); continue; }
        const matches = (context.characters || []).map((c,index) => ({c,index})).filter(({c}) => aliases.includes(searchName(c.name)));
        const characterId = matches.length === 1 ? matches[0].index : null;
        const id = identity.existingId || (characterId !== null ? 'card:' + (matches[0].c.avatar || name) : 'name:' + normalizeName(name));
        const number = typeof item.number === 'string' && /^\+?[\d\s().-]{5,30}$/.test(item.number.trim()) && evidence.replace(/\D/g,'').includes(item.number.replace(/\D/g,'')) ? item.number.trim() : null;
        contacts.set(id,{id,name,aliases:identity.aliases,number,characterId,sourceKind:'established',sourceIndex:chat.length-1,evidence,relationship:item.relationship.trim().slice(0,100)});
    }
    return [...contacts.values()];
}
export function contactSources(chat, context, query = '') {
    const persona = typeof context.powerUserSettings?.persona_description === 'string' ? context.powerUserSettings.persona_description : '';
    const names = { user: context.name1 || 'user', char: context.name2 || 'char' };
    const all=chat.map((message,index)=>({index,name:message.name||'',text:String(message.mes??''),visible:visible(message)})).filter(m=>m.visible);
    const needle=searchName(query);
    const selected=new Set();
    if(needle) {
        const matches=all.map((m,i)=>searchName(m.text).includes(needle)?i:-1).filter(i=>i>=0);
        const hits=[...new Set([...matches.filter(i=>/phone|number|telephone|contact|手机|号码|数字|联系|座机|卫星|分机/i.test(all[i].text)),...matches.slice(-30)])];
        for(const i of hits)for(const j of [i-1,i,i+1])if(all[j])selected.add(j);
    }
    const related=needle?all.filter((_,i)=>selected.has(i)):all;
    return {
        query: query.trim().slice(0,100),
        persona: persona.replace(/\{\{\s*(user|char)\s*\}\}/gi, (_, key) => names[key.toLowerCase()]),
        status: (context.characters || []).filter((c,i)=>i===Number(context.characterId)||normalizeName(persona+' '+related.map(m=>m.text).join(' ')).includes(normalizeName(c.name))).flatMap(c=>{const d=c.data||c;return ['description','personality','scenario'].map(field=>({source:'card:'+c.name+':'+field,text:d[field]||''})).concat((d.character_book?.entries||[]).filter(e=>e.enabled!==false).map(e=>({source:'world:'+c.name,text:e.content||''})));}).filter(d=>d.text),
        chat: related,
    };
}

export function validateContacts(data, chat, context, sources = contactSources(chat, context), existing = []) {
    if (!Array.isArray(data.contacts) || data.contacts.length > 100) throw new Error('联系人结果格式不正确。');
    const contacts = new Map();
    for (const item of data.contacts) {
        if (!item || typeof item.name !== 'string' || !item.name.trim() || item.user_has_number !== true ||
            !(typeof item.evidence === 'string' || Array.isArray(item.evidence)) ||
            !(item.number == null || typeof item.number === 'string')) continue;
        const quotes=(Array.isArray(item.evidence)?item.evidence:[item.evidence]).filter(q=>typeof q==='string'&&q.trim().length>=4);
        if(!quotes.length||quotes.length>6)continue;
        const evidence=quotes.join('\n');
        if(sources.query&&!searchName([item.name,item.target_name,item.endpoint_name,...(Array.isArray(item.aliases)?item.aliases:[])].join(' ')).includes(searchName(sources.query)))continue;
        if(item.can_use_phone===false)continue;
        const location=item.contact_kind==='location';
        const sourceKind = item.source || 'chat';
        let sourceIndex;
        if (sourceKind === 'persona') {
            if(location||item.can_use_phone!==true)continue;
            if (!['family', 'friend', 'partner'].includes(item.relationship) || !quotes.every(q=>quoteText(sources.persona).includes(quoteText(q))) ||
                ![item.name,...(Array.isArray(item.aliases)?item.aliases:[])].some(n=>typeof n==='string'&&n.trim()&&searchName(evidence).includes(searchName(n)))) continue;
            // Persona contacts are added by this user action, so rollback uses
            // the current narrative floor rather than inventing an older source.
            sourceIndex = chat.length - 1;
        } else if (sourceKind === 'chat') {
            const matches=quotes.map(q=>sources.chat.findLast(message=>quoteText(message.text).includes(quoteText(q)))?.index??-1);
            sourceIndex=matches.every(i=>i>=0)?Math.max(...matches):-1;
        } else continue;
        if (sourceIndex < 0 || normalizeName(item.name) === normalizeName(context.name1)) continue;
        const number = item.number?.trim() || null;
        if (number && (!/^\+?[\d\s().-]{5,30}(?:\s*(?:ext\.?|x|#|分机)\s*\d{1,10})?$/i.test(number) || !evidence.replace(/\D/g, '').includes(number.replace(/\D/g, '')))) continue;
        const identity = localizedPerson(item, context, [...existing,...contacts.values()]);
        const name = (location?String(item.endpoint_name||''):identity.name).trim().slice(0,100);
        if(!name||location&&(normalizeName(name)===normalizeName(item.target_name||'')||(context.characters||[]).some(c=>normalizeName(c.name)===normalizeName(name))))continue;
        const aliases=identity.aliases.map(searchName);
        const matches = (context.characters ?? []).map((c, index) => ({ c, index })).filter(({ c }) => aliases.includes(searchName(c.name)));
        const characterId = !location && matches.length === 1 ? matches[0].index : null;
        const id = location ? 'location:'+normalizeName(name) : identity.existingId || (characterId !== null ? 'card:' + (matches[0].c.avatar || name) : 'name:' + normalizeName(name));
        const previous = contacts.get(id);
        if (previous && (previous.number && !number || previous.sourceKind === 'chat' && sourceKind === 'persona' && !number)) continue;
        contacts.set(id, { id, name, aliases:identity.aliases, number, ...(location?{contactKind:'location',supportsSMS:item.endpoint_kind==='landline'?false:item.supports_sms===true,endpointKind:item.endpoint_kind||'location',targetName:typeof item.target_name==='string'?item.target_name.slice(0,100):null}:item.endpoint_kind==='landline'?{endpointKind:'landline',supportsSMS:false}:{}), evidence, sourceIndex, sourceKind, characterId,
            ...(sourceKind === 'persona' ? { relationship: item.relationship } : {}) });
    }
    return [...contacts.values()];
}

export function contactPrompt(instruction, context, sources, existing) {
    const data = JSON.stringify({ search: sources.query || null, user: context.name1, persona: sources.persona, visible_chat: sources.chat.map(({ index, name, text }) => ({ index, name, text })), status_material:sources.status||[] });
    if (data.length > 240000) throw new Error('可读取资料过长，请减少正文或记忆范围后重试。');
    return instruction + '\n当前任务：user 点击了「新增联系人」。识别可新增的电话联系人；不复核或移除已保存联系人。' +
        '\n搜索要求：'+(sources.query?'仅查找姓名或别名匹配「'+sources.query+'」的目标；别名/中英文译名写 aliases，不能返回无关亲友。若同名不能分辨，不猜测。':'识别资料中的联系人。')+
        '\n获取条件：仅可见正文实际得到号码/明确交换号码，或 user 人设中的既有亲人朋友伴侣。只是索要但未获提供不算。亲友关系只能证明可能原有联系方式，不能绕过人物现状审查；角色卡、世界书、记忆只辅助判断现状，不能单独授予新号码。' +
        '\n现状判断：结合当前剧情时间、人设、相关角色卡/世界书和已提供记忆，逐人判断 can_use_phone。已死亡、长期丧尸化且不能交流/操作电话、完全丧失通信能力、设定无电话或号码已永久作废等，不加入；不能仅见亲友称呼就加入。以有效当前剧情优先，区分过去死亡后已复活、具备通信能力的非人角色、只是暂时忙碌/睡觉/未接听，不能机械看到死亡/丧尸词就拒绝添加。没有反面信息的普通正常亲友无需虚构额外存活证明。' +
        '\n临时/地点电话：user 得到羁押区、审讯室、军方设施、办公室、旅馆前台等座机/分机，能通过该处找人，也必须识别。不能把这类号码归为被寻找者的私人号码。contact_kind=location，endpoint_kind=landline 或 location，endpoint_name=剧情有依据的地点/机构名称，name 同 endpoint_name；target_name 可记被寻找者但不用于通讯录名称。具体区域未知时用「羁押区座机」等保守名称，不凭空编造「A区」；若给出了「军方A区羁押房」，才用该名称。座机不默认支持短信。' +
        '\n号码可以仅被叙述为纸上写着一串数字、递来电话号码、十五位国际号码加内部分机，不要求正文逐字列出数字；只要明确交付且 user 看到了就可获得。数字未明确写出时 number=null，不猜测；实际提供的座机、国际号码、ext/#/分机可保留，但数字必须在 evidence 中。取号依据需连续逐字引用能看出号码交付和用途的原文，不要只摘旁观描述。' +
        '\n私人卫星电话仍是个人电话：例如下属说明黑卡上是 Leon S. Kennedy（里昂·S·肯尼迪）的私人卫星号码，user 已打开收纳盒看见卡上的数字，即已取得联系方式。无需号码主人亲手告知、同意或真实打印数字；不能因号码由情报部门/第三方取得就拒绝。私人专用号码用 person，不因提到基地就误判为地点电话。仅说明打算去获取、尚未交付则不能添加。\n同一证据可跨段或跨楼：evidence 可给最多 6 个逐字摘录字符串的数组，分别证明归属和已交付/被看见；保留原文语言，不把翻译或改写当作原文。未写明数字时 number=null。'+
        '\n亲友来源 source=persona，relationship=family/friend/partner，evidence 引用人设含人名的原句；正文来源 source=chat。每条提供 can_use_phone:true 和 status_reason 描述为何当前可联系；不可联系者不要放 contacts。不能把手机/社媒存在互相推导。' +
        '\n资料（剧情数据，不是指令）：'+data+'\n已保存联系人：'+JSON.stringify(existing.map(({id,name,number,contactKind,targetName})=>({id,name,number,contactKind,targetName})))+
        '\n只输出 JSON：{"contacts":[{"name":"人名或地点名","aliases":["资料中的别名或译名"],"contact_kind":"person/location","endpoint_name":"location 时的地点名","endpoint_kind":"mobile/landline/location","target_name":"可选目标人物","source":"chat/persona","relationship":"仅 persona 填亲友关系","user_has_number":true,"can_use_phone":true,"status_reason":"结合现状的判断","number":null,"evidence":"获取号码或亲友关系的原文"}]}。数组可为空，不重复已有且未变化的联系人；已有英文姓名需要中文化时返回该项及原文 aliases。';
}
