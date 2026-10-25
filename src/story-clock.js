// Read scene timestamps locally. No wall-clock fallback and no model calls.
export function dateDay(value) {
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
    const d=new Date(0);d.setUTCFullYear(+m[1],+m[2]-1,+m[3]);d.setUTCHours(0,0,0,0);
    return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?Math.floor(d.getTime()/86400000):null;
}
export const dayDate = day => Number.isInteger(day)?new Date(day*86400000).toISOString().slice(0,10):'';
export function readStoryClock(chat, seed=null, { exact = false } = {}) {
    let day=seed?.day??null,hour=seed?.hour??null;
    for(const m of chat||[]){
        if(m.is_system&&!m.extra?.qianqianjieAutoHide)continue;
        const text=String(m.mes||'').replace(/```[\s\S]*?```/g,'').replace(/<(script|style|think|thinking)[^>]*>[\s\S]*?<\/\1>/gi,'')
            .replace(/<!--\s*SDC-(?:start|end)\s*\|([\s\S]*?)-->/gi,(_,body)=>{
                const date=body.match(/(?:^|\|)\s*date\s*=\s*([^|]+)/i)?.[1]?.trim();
                const time=body.match(/(?:^|\|)\s*time\s*=\s*(\d{1,2}:\d{2})/i)?.[1];
                return date?'\n'+date+(time?' '+time:'')+'\n':'';
            }).replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'\n');
        const lines=text.split('\n').map(s=>s.replace(/^[\s*#|]+|[\s*|]+$/g,'')).filter(Boolean);
        for(const rawLine of lines){
            let line=rawLine.replace(/^[【\[]\s*/, '').replace(/\s*[】\]]$/, '');
            let t=line.match(/^(?:(?:当前|剧情|故事)?(?:日期|时间)|Date|Time|Scene time)?\s*[:：]?\s*(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?(?:\s|$|[T,，|])/i);
            // A scene status can summarize a time jump. Only accept an explicit
            // opening date range, never arbitrary later dates in narrative prose.
            if(t){
                const end=line.slice(t[0].length).match(/^(?:\d{1,2}[:：]\d{2}\s*(?:AM|PM)?\s*)?(?:(?:星期|周)[一二三四五六日天]\s*)?(?:至|到|→|～|~|—|to\b)\s*(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})日?(?=\s|$|[T,，|])/i);
                if(end){
                    const startDay=dateDay(`${t[1]}-${t[2].padStart(2,'0')}-${t[3].padStart(2,'0')}`);
                    const endDay=dateDay(`${end[1]}-${end[2].padStart(2,'0')}-${end[3].padStart(2,'0')}`);
                    if(startDay!==null&&endDay!==null&&endDay>=startDay){
                        line=`${end[1]}-${end[2].padStart(2,'0')}-${end[3].padStart(2,'0')} `+line.slice(t[0].length+end[0].length);
                        t=line.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    }
                }
            }
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
                else if(exact && /凌晨|半夜|晚上|夜晚|夜间|下午|午后|中午|正午|上午|早上|清晨|黎明|midnight|night|evening|afternoon|noon|morning|dawn/i.test(line))hour=null;
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

// Exact clock for elapsed-time policies: fuzzy morning/evening is not a time.
export function exactStoryTime(chat) {
    const {day,hour}=readStoryClock(chat,null,{exact:true});
    return {date:dayDate(day),time:hour==null?'':String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0'),precision:'exact'};
}

// Stored story anchors are distinct from createdAt (local ordering only).
export function storyTime(chat) {
    const {day,hour}=readStoryClock(chat);
    return {date:dayDate(day), time:hour==null?'':String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0'), precision:'scene'};
}
export const displayStoryTime = item => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item?.storyTime?.time||'') ? item.storyTime.time : '—';
