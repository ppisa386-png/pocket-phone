// Extract one complete object without rewriting financial data. Presentation
// blocks are ignored only outside JSON; markup inside quoted values is data.
export function parseModelObject(raw, { allowTrailingCommas = false } = {}) {
    const original = String(raw ?? ''), text = original.trim();
    let hiddenBlocks = 0, hiddenLedgers = 0, reasoningBlocks = 0;
    const fail = (code, reason, hint = '', extra = '') => {
        throw Object.assign(new Error('账本返回格式不正确：' + reason + '。本次未保存。' + hint), {
            code,
            diagnostic: '任务：资产评估；错误代码：' + code + '；原因：' + reason
                + '；返回字符数：' + original.length + (extra ? '；' + extra : '')
                + '；隐藏注释数：' + hiddenBlocks + '；隐藏账本数：' + hiddenLedgers + '；思考块数：' + reasoningBlocks
                + (hint ? '\n建议：' + hint : ''),
        });
    };
    if (!text) fail('MODEL_JSON_EMPTY', '模型没有返回文字', '请检查模型回复是否为空或被输出规则过滤。');
    const object = value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        fail('MODEL_JSON_TYPE', '需要单个 JSON 对象', '不能用数组、文字或空值代替账本。');
    };
    const parse = source => {
        try { return JSON.parse(source); } catch (error) {
            if (!allowTrailingCommas) throw error;
            // Only remove a redundant delimiter after a value, outside strings.
            // Never repair quotes, keys, missing values/brackets or scalar data.
            let fixed='', quoted=false, escaped=false, previous='';
            for (let i=0;i<source.length;i++) {
                const c=source[i];
                if (!quoted && c===',' && previous && !'{[:,'.includes(previous) && /^[\s]*[}\]]/.test(source.slice(i+1))) continue;
                fixed+=c;
                if (quoted) {
                    if (escaped) escaped=false;
                    else if (c==='\\') escaped=true;
                    else if (c==='"') quoted=false;
                } else if (c==='"') quoted=true;
                if (!/\s/.test(c)) previous=c;
            }
            if (fixed===source) throw error;
            return JSON.parse(fixed);
        }
    };
    const clean = text.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim();
    try { return object(parse(clean)); } catch (e) { if (e.diagnostic) throw e; }
    const candidates = [];
    let start = -1, stack = [], quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (start < 0) {
            if (c === '<') {
                const opening = text.slice(i).match(/^<(think|thinking|analysis|script|style)\b[^>]*>/i);
                if (opening) {
                    if (/think|analysis/i.test(opening[1])) reasoningBlocks++;
                    const end = new RegExp('<\\/' + opening[1] + '\\s*>', 'i').exec(text.slice(i + opening[0].length));
                    if (!end) fail('MODEL_JSON_REASONING', /think|analysis/i.test(opening[1]) ? '思考标签未闭合' : '展示标签未闭合', '请检查模型是否只返回了思考或未完成回复。');
                    i += opening[0].length + end.index + end[0].length - 1; continue;
                }
                if (text.startsWith('<!--', i)) {
                    hiddenBlocks++;
                    const end = text.indexOf('-->', i + 4);
                    if (end < 0) fail('MODEL_JSON_TRUNCATED', '隐藏注释不完整，可能被截断');
                    // Accept only an entire, explicitly structured ledger in a
                    // comment. Never mine reasoning, snippets or durian-money
                    // narrative events to invent a financial assessment.
                    const body = text.slice(i + 4, end).trim().replace(/^durian-ledger\s*:\s*/i, '');
                    try {
                        const value = JSON.parse(body);
                        if (value && !Array.isArray(value) && typeof value === 'object' &&
                            (Array.isArray(value.recoveredAssets) || (value.initial && typeof value.initial === 'object' && !Array.isArray(value.initial)) ||
                                ['events', 'valuations', 'ownership', 'business'].some(key => Array.isArray(value[key])))) {
                            candidates.push(body); hiddenLedgers++;
                        }
                    } catch { /* No JSON surgery, no guessing missing values. */ }
                    i = end + 2; continue;
                }
            }
            if (c !== '{' && c !== '[') continue;
            start = i; stack = [c]; quoted = false; escaped = false; continue;
        }
        if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
            continue;
        }
        if (c === '"') quoted = true;
        else if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') {
            if (stack.pop() !== (c === '}' ? '{' : '[')) fail('MODEL_JSON_SYNTAX', 'JSON 括号不匹配', '', '字符位置：' + (i + 1));
            if (!stack.length) { candidates.push(text.slice(start, i + 1)); start = -1; }
        }
    }
    if (start >= 0) fail('MODEL_JSON_TRUNCATED', 'JSON 不完整，可能被截断', '请检查酒馆回复长度或停止词；不会自动补齐金额。');
    if (candidates.length !== 1) fail(candidates.length ? 'MODEL_JSON_AMBIGUOUS' : 'MODEL_JSON_MISSING',
        candidates.length ? '返回多个 JSON，无法确定唯一账本' : '未返回 JSON 账本',
        candidates.length ? '需要唯一的账本结果，不会替你选择其中一份。' : '本次未识别出可用账本；未写入任何数据，可手动重试。仅凭此错误不能确定是预设还是模型输出造成。', '完整候选数：' + candidates.length);
    let value;
    try { value = parse(candidates[0]); }
    catch (error) {
        // Native SyntaxError messages may include private response excerpts.
        const offset = String(error.message).match(/\bposition\s+(\d+)/i)?.[1];
        const message = String(error.message);
        const detail = /control character/i.test(message) ? '字符串含未转义换行或控制字符'
            : /escape|unicode/i.test(message) ? '字符串转义无效'
            : /property name|property names/i.test(message) ? '字段名缺少英文双引号或分隔符错误'
            : /after property value|after array element/i.test(message) ? '字段或数组项之间分隔错误（也可能是字符串内引号未转义）'
            : /after property name/i.test(message) ? '字段名后缺少冒号'
            : /unterminated string/i.test(message) ? '字符串未闭合' : '无法解析字段或值';
        fail('MODEL_JSON_SYNTAX', 'JSON 语法无效：'+detail, '返回内容未通过语法检查，本次未保存，可手动重试。',
            offset === undefined ? '' : '候选内字符位置：' + (Number(offset) + 1));
    }
    return object(value);
}
