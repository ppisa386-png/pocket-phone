// Local, bounded error history. Never persist request bodies, responses or keys.
export function createDiagnostics({storage, version = '', getSecrets = () => []} = {}) {
    if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
    const key = 'durian_phone_errors_v1';
    let entries = [];
    const clean = (value, secrets = []) => {
        let text = String(value ?? '');
        for (const secret of [...getSecrets(), ...secrets].filter(s=>typeof s==='string'&&s).sort((a,b)=>b.length-a.length)) text=text.split(secret).join('[已隐藏]');
        return text.replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [已隐藏]')
            .replace(/((?:api[_-]?key|proxy_password|authorization|access_token|密钥)["']?\s*[:=]\s*["']?)[^\s"',;}&]+/gi,'$1[已隐藏]')
            .replace(/\bsk-[a-zA-Z0-9_-]+/g,'[已隐藏]')
            .replace(/https?:\/\/[^\s<>"']+/g, url => { try { const u=new URL(url);u.username='';u.password='';u.search='';u.hash='';return u.toString(); } catch { return '[地址已隐藏]'; } })
            .slice(0,1500);
    };
    try {
        const saved=JSON.parse(storage?.getItem(key)||'[]');
        if(Array.isArray(saved))entries=saved.filter(e=>e&&typeof e.message==='string').slice(-100).map(e=>({time:clean(e.time),version:clean(e.version),source:clean(e.source),message:clean(e.message)}));
    } catch { /* A malformed log must never block the phone. */ }
    let persisted = true;
    function save() { try { if(!storage)throw Error();storage.setItem(key,JSON.stringify(entries));persisted=true; } catch { persisted=false; } }
    return {
        add(error, source = '运行', secrets = []) {
            const message=clean(error?.message ?? error ?? '未知错误',secrets)+(typeof error?.diagnostic==='string'?'\n'+clean(error.diagnostic,secrets):'');
            entries.push({time:new Date().toISOString(),version,source:clean(source,secrets),message});
            entries=entries.slice(-100);save();
        },
        list: () => structuredClone(entries).reverse(),
        persistent: () => persisted,
        clear() { entries=[];save(); },
        text() { return entries.slice().reverse().map(e=>'['+e.time+'] 榴莲手机 '+e.version+' · '+e.source+'\n'+e.message).join('\n\n'); },
    };
}
