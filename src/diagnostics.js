// Local, bounded error history. Failed JSON replies are retained for debugging;
// request bodies, separate reasoning fields and credentials are never stored.
export function createDiagnostics({storage, version = '', getSecrets = () => []} = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    const key = 'durian_phone_errors_v1';
    let entries = [];
    const clean = (value, secrets = [], limit = 1500) => {
        let text = String(value ?? '');
        const known = [...getSecrets(), ...secrets].filter(s=>typeof s==='string'&&s);
        for (const secret of [...new Set(known.flatMap(s=>[s,JSON.stringify(s).slice(1,-1)]))].sort((a,b)=>b.length-a.length)) text=text.split(secret).join('[已隐藏]');
        return text.replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]')
            .replace(/((?:api[_-]?key|proxy_password|authorization|access_token|密钥)["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi,'$1[已隐藏]')
            .replace(/\bsk-[a-zA-Z0-9_-]+/g,'[已隐藏]')
            .replace(/https?:\/\/[^\s<>"']+/g, url => { try { const u=new URL(url);u.username='';u.password='';u.search='';u.hash='';return u.toString(); } catch { return '[地址已隐藏]'; } })
            .slice(0,limit);
    };
    const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const stripReasoning = value => String(value).replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
        (_block, tag) => '<'+tag+'>[推理内容已隐藏]</'+tag+'>');
    const sample = (item, secrets = []) => {
        if (!item || typeof item.text !== 'string') return null;
        // Redact before truncation so a credential crossing the cut is not leaked.
        const redacted = clean(stripReasoning(item.text), secrets, Infinity);
        const truncated = redacted.length > (item.truncated === true ? 12100 : 12000);
        const meta = item.metadata || {}, parser = item.parser || {};
        const safeMetadata = {};
        for (const name of ['finishReason','completionTokens','reasoningTokens','choices','contentType','textParts','legacyText','rawTextCharacters','textCharacters','jsonMode','model','endpointOrigin']) {
            if (typeof meta[name] === 'string') safeMetadata[name] = clean(meta[name],secrets,300);
            else if (typeof meta[name] === 'boolean' || (typeof meta[name] === 'number' && Number.isFinite(meta[name]))) safeMetadata[name] = meta[name];
        }
        return {
            attempt:integer(item.attempt), code:clean(item.code,secrets,80),
            originalCharacters:integer(item.originalCharacters) ?? item.text.length,
            redacted:item.redacted === true || redacted !== item.text,
            truncated:item.truncated === true || truncated,
            text:truncated ? redacted.slice(0,8000)+'\n[中段省略 '+(redacted.length-12000)+' 字符]\n'+redacted.slice(-4000) : redacted,
            metadata:safeMetadata,
            parser:typeof parser.nativeMessage === 'string' ? {
                nativeMessage:clean(stripReasoning(parser.nativeMessage),secrets,600),
                inputCharacters:integer(parser.inputCharacters), candidateCharacters:integer(parser.candidateCharacters), candidateStart:integer(parser.candidateStart),
                position:integer(parser.position), line:integer(parser.line), column:integer(parser.column),
                positionBasis:clean(parser.positionBasis,secrets,100),
            } : null,
        };
    };
    const samples = (items, secrets) => Array.isArray(items) ? items.slice(0,2).map(item=>sample(item,secrets)).filter(Boolean) : [];
    function bound() {
        entries=entries.slice(-100);
        while(entries.length>1 && JSON.stringify(entries).length>512000) entries.shift();
    }
    try {
        const saved=JSON.parse(storage?.getItem(key)||'[]');
        if(Array.isArray(saved))entries=saved.filter(e=>e&&typeof e.message==='string').slice(-100).map(e=>({time:clean(e.time),version:clean(e.version),source:clean(e.source),message:clean(e.message,[],6500),modelResponses:samples(e.modelResponses)}));
        bound();
    } catch { /* A malformed log must never block the phone. */ }
    let persisted = true;
    function save() { try { if(!storage)throw Error();storage.setItem(key,JSON.stringify(entries));persisted=true; } catch { persisted=false; } }
    return {
        add(error, source = '运行', secrets = []) {
            const message=clean(error?.message ?? error ?? '未知错误',secrets)+(typeof error?.diagnostic==='string'?'\n'+clean(error.diagnostic,secrets,4500):'');
            entries.push({time:new Date().toISOString(),version,source:clean(source,secrets),message,modelResponses:samples(error?.modelResponses,secrets)});
            bound();save();
        },
        list: () => structuredClone(entries).reverse(),
        persistent: () => persisted,
        clear() { entries=[];save(); },
        text() {
            const escaped = value => JSON.stringify(value).replace(/[\u007f-\u009f\u00a0\u2000-\u200f\u2028-\u202f\u2060\u3000\ufeff]/g,
                c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
            const responseText = item => '\n\n模型返回诊断 · 第'+item.attempt+'次 · '+item.code
                +'\n原始字符数：'+item.originalCharacters+'；样本：'+(item.truncated?'仅保留头尾，非完整回复':'完整回复')+'；脱敏：'+(item.redacted?'是':'否')
                +'\n接口元数据：'+JSON.stringify(item.metadata)
                +(item.parser ? '\n解析器原始错误（脱敏）：'+item.parser.nativeMessage+'\n解析定位（候选内position/解析输入内candidateStart 从0起，line/column从1起）：'+JSON.stringify({...item.parser,nativeMessage:undefined}) : '')
                +'\n返回文本（JSON字符串转义表示；\\n是换行，\\\\n是字面量反斜线+n）：\n'+escaped(item.text);
            return (entries.length ? '当前运行版本：榴莲手机 ' + version + '\n（以下每条版本为报错发生时的版本；更新插件后请刷新酒馆页面。）\n\n' : '')
                + entries.slice().reverse().map(e=>'['+e.time+'] 榴莲手机 '+e.version+' · '+e.source+'\n'+e.message+(e.modelResponses||[]).map(responseText).join('')).join('\n\n');
        },
    };
}
