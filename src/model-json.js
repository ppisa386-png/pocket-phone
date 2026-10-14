// Accept presentation wrappers, never repair numbers, incomplete JSON or choose
// between competing objects. Validation of the actual financial data stays strict.
export function parseModelObject(raw) {
    const original = String(raw ?? '');
    const fail = reason => {
        throw Object.assign(new Error('账本返回格式不正确，本次未保存。可在报错记录查看原因。'), {
            diagnostic: '任务：资产评估；原因：' + reason + '；返回字符数：' + original.length,
        });
    };
    const text = original.replace(/<(think|thinking|analysis|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '').trim();
    if (/<(?:think|thinking|analysis)\b/i.test(text)) fail('思考标签未闭合');
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
        const value = JSON.parse(clean);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        fail('需要单个 JSON 对象');
    } catch (e) { if (e.diagnostic) throw e; }
    const candidates = [];
    let start = -1, stack = [], quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (start < 0) {
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
            if (stack.pop() !== (c === '}' ? '{' : '[')) fail('JSON 括号不匹配');
            if (!stack.length) { candidates.push(text.slice(start, i + 1)); start = -1; }
        }
    }
    if (start >= 0) fail('JSON 不完整，可能被截断');
    if (candidates.length !== 1) fail(candidates.length ? '返回多个 JSON，无法确定唯一账本' : '未返回 JSON 账本');
    try {
        const value = JSON.parse(candidates[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { fail('JSON 语法无效'); }
    fail('需要单个 JSON 对象');
}
