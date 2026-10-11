// Read scene timestamps locally. No wall-clock fallback and no model calls.
export function dateDay(value) {
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
    const d=new Date(0);d.setUTCFullYear(+m[1],+m[2]-1,+m[3]);d.setUTCHours(0,0,0,0);
    return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?Math.floor(d.getTime()/86400000):null;
}
export const dayDate = day => Number.isInteger(day)?new Date(day*86400000).toISOString().slice(0,10):'';
export function readStoryClock(chat, seed=null) {
    let day=seed?.day??null,hour=seed?.hour??null;
    for(const m of chat||[]){
        if(m.is_system&&!m.extra?.qianqianjieAutoHide)continue;
        const text=String(m.mes||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|think|thinking)[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,'\n');
        const lines=text.split('\n').map(s=>s.replace(/^[\s*#|]+|[\s*|]+$/g,'')).filter(Boolean);
        for(const line of lines){
            const t=line.match(/^(?:(?:当前|剧情|故事)?(?:日期|时间)|Date|Time|Scene time)?\s*[:：]?\s*(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?(?:\s|$|[T,，|])/i);
            const md=!t&&day!==null?line.match(/^(?:(?:当前|剧情)?(?:日期|时间)|Date|Time)\s*[:：]\s*(\d{1,2})[-月/.](\d{1,2})日?/i):null;
            let next=null;
            if(t)next=dateDay(`${t[1]}-${t[2].padStart(2,'0')}-${t[3].padStart(2,'0')}`);
            if(md)next=dateDay(`${dayDate(day).slice(0,4)}-${md[1].padStart(2,'0')}-${md[2].padStart(2,'0')}`);
            if(next!==null){if(next!==day)hour=null;day=next;}
            // Only scene-opening relative transitions, never mentions in dialogue.
            const relative=line===lines[0]?line.match(/^(?:第二天|次日|翌日|隔天|the next day|the following morning)|^([一二两三四五六七八九十\d]+)天后|^(\d+) days? later/i):null;
            if(relative&&day!==null){const n=relative[1]||relative[2];const count=n?(/^\d+$/.test(n)?+n:{一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[n]):1;if(count){day+=count;hour=null;}}
            const sceneLine=!!t||!!md||!!relative||/^(?:(?:当前|剧情|故事)?时间|Time|Scene time)\s*[:：]/i.test(line);
            if(sceneLine){
                const tm=line.match(/(?:\b|[T\s：:])(\d{1,2})[:：](\d{2})(?:\s*(AM|PM))?/i);
                if(tm&&+tm[1]<24&&+tm[2]<60){let h=+tm[1];if(tm[3]){h=h%12+(/pm/i.test(tm[3])?12:0);}hour=h+(+tm[2]/60);}
                else if(/凌晨|半夜|midnight/i.test(line))hour=2;
                else if(/晚上|夜晚|夜间|night|evening/i.test(line))hour=21;
                else if(/下午|午后|afternoon/i.test(line))hour=15;
                else if(/中午|正午|noon/i.test(line))hour=12;
                else if(/上午|早上|morning/i.test(line))hour=10;
                else if(/清晨|黎明|dawn/i.test(line))hour=7;
            }
        }
    }
    return {day,hour};
}
