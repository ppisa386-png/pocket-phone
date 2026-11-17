// The actual active preset remains in the host-prepared context. Do not guess
// its language from UI locale, character display names, or old model replies.
export const COMMUNICATION_LANGUAGE_RULE = "\n通信语言适配：短信、电话说话内容和语音转写属于角色对白。由本次生效的酒馆预设决定角色说哪种语言、是否提供中文译文，不因界面语言或姓名强制英文或双语。唯小手机的可见对白排版统一：若预设要求双语，直接在同一个text字符串中写“原语言完整对白（中文完整译文）”，例如“Hello.（你好。）”；原文、译文内容必须完整，保留人物口吻、语义、标点，不添加或照抄预设的任何XML/HTML/方括号语言标签、原文/译文标题、代码围栏或换行式语言标记。预设有语言标签时理解其中语言含义，不复制标签文本；不同预设标签可能完全不同，也可能无标签。预设仅要求单语则仅输出单语，不自行翻译；角色母语依据人设场景判断，不统一英语。JSON只是容器，整句及译文放同一text，不另增translation/original字段。已在正文逐字明确写出的历史消息、user原话及非对白字段不可擅自改写；不翻译协议键、ID和status。";

export const SOCIAL_LANGUAGE_RULE = "\n社交内容语言：WhatsApp、微信的聊天与动态、X 的帖子、转帖附言、评论、回复及私信，以及 Snapchat 的聊天、语音转写、通话台词、故事配文和评论回复属于角色表达。由当前生效预设的对白语言要求决定各角色使用的原语言和是否附中文译文；依照人物与场景确定语言，不统一英语；双语时小手机统一显示为“原文（中文译文）”，例如“Hello.（你好。）”，同一条text字符串完整容纳两部分，保留原语言、内容和标点，不输出预设带来的任意语言标签、成对标记、原文/译文小标题、XML/HTML元素或代码块；预设的标签仅用于辨认语言，不能作为用户可见正文。单语预设保持单语，原样，不强行提供翻译；不同预设可能无标签，不能根据一套固定标签解析。账号简介与照片/视频画面说明等叙述字段仍按预设叙述语言；不改写user发送的文字，不改变handle、ID、status等协议值，不跨平台泄露私人身份。";

// Display-only, conservative normalisation of preset-provided bilingual wrappers.
// Stored texts, user entries, and model context remain byte-for-byte unchanged.
export function formatPhoneDialogue(value) {
    const original=String(value??'');
    if(!original||original.length>30000)return original;
    const hint=tag=>{
        const s=String(tag||'').toLowerCase();
        if(/(?:^|[_:.-])(?:zh|cn|zho|chinese|hans|translation|translated|trans|target)(?:$|[_:.-])/.test(s)||/中文|译文|翻译/.test(s))return 'zh';
        if(/(?:^|[_:.-])(?:src|source|original|origin|en|eng|english|foreign|ja|jp|ko|kr|es|fr|de|ru)(?:$|[_:.-])/.test(s)||/原文|英文|英语/.test(s))return 'src';
        return null;
    };
    const chinese=s=>/\p{Script=Han}/u.test(s)&&!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s);
    const foreign=s=>/[\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(s);
    const pair=(a,b)=>{
        const ha=hint(a.tag),hb=hint(b.tag);
        let source,translation;
        if(ha==='src'&&hb==='zh'){source=a.body;translation=b.body;}
        else if(ha==='zh'&&hb==='src'){source=b.body;translation=a.body;}
        else if(ha==='zh'&&hb!=='zh'&&foreign(b.body)){source=b.body;translation=a.body;}
        else if(hb==='zh'&&ha!=='zh'&&foreign(a.body)){source=a.body;translation=b.body;}
        else if(chinese(a.body)&&!chinese(b.body)&&foreign(b.body)){source=b.body;translation=a.body;}
        else if(chinese(b.body)&&!chinese(a.body)&&foreign(a.body)){source=a.body;translation=b.body;}
        else return null;
        source=source.trim();translation=translation.trim();
        if(/^[（(][\s\S]*[)）]$/.test(translation))translation=translation.slice(1,-1).trim();
        return source&&translation?source+'（'+translation+'）':null;
    };
    const pattern=/<([A-Za-z][\w:.-]{0,63})(?:\s+[^<>]*?)?>\s*([\s\S]*?)\s*<\/\1\s*>|\[([A-Za-z][\w:.-]{0,63})\]\s*([\s\S]*?)\s*\[\/\3\s*\]/g;
    const tags=[...original.matchAll(pattern)].map(m=>({start:m.index,end:m.index+m[0].length,tag:m[1]||m[3],body:m[2]??m[4],raw:m[0]}))
        .filter(x=>!/<\/?[A-Za-z][^>]*>/.test(x.body));
    let result='',position=0;
    for(let i=0;i<tags.length;i++){
        const a=tags[i],b=tags[i+1];
        if(a.start<position)continue;
        const joined=b&&/^\s*$/.test(original.slice(a.end,b.start))?pair(a,b):null;
        if(joined){
            result+=original.slice(position,a.start)+joined;
            position=b.end;i++;
        }else if(hint(a.tag)){
            result+=original.slice(position,a.start)+a.body.trim();
            position=a.end;
        }
    }
    result+=original.slice(position);
    const lines=result.trim().split(/\r?\n/);
    if(lines.length===2){
        const prefix=/^(?:(?:【|\[)\s*(原文|英文|英语|English|en|src|source|中文|译文|翻译|Chinese|zh|cn)\s*(?:】|\])|(?:原文|英文|英语|English|中文|译文|翻译|Chinese|source|translation)\s*[:：])\s*/iu;
        const marked=lines.map(line=>line.match(prefix));
        if(marked[0]&&marked[1]){
            const a={tag:marked[0][1]||(/中文|译文|翻译|Chinese|translation/i.test(marked[0][0])?'zh':'src'),body:lines[0].slice(marked[0][0].length)};
            const b={tag:marked[1][1]||(/中文|译文|翻译|Chinese|translation/i.test(marked[1][0])?'zh':'src'),body:lines[1].slice(marked[1][0].length)};
            return pair(a,b)??result;
        }
        if(!marked[0]&&!marked[1]&&!chinese(lines[0])&&chinese(lines[1])&&foreign(lines[0]))
            return lines[0].trim()+'（'+lines[1].trim().replace(/^[（(]([\s\S]*?)[)）]$/,'$1')+'）';
    }
    return result;
}
