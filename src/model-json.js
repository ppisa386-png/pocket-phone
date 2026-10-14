// Extract one complete object without rewriting financial data. Presentation
// blocks are ignored only outside JSON; markup inside quoted values is data.
export function parseModelObject(raw) {
    const original = String(raw ?? ''), text = original.trim();
    const fail = (code, reason, hint = '', extra = '') => {
        throw Object.assign(new Error('账本返回格式不正确：' + reason + '。本次未保存。' + hint), {
            code,
            diagnostic: '任务：资产评估；错误代码：' + code + '；原因：' + reason
                + '；返回字符数：' + original.length + (extra ? '；' + extra : '')
                + (hint ? '\n建议：' + hint : ''),
        });
    };
    if (!text) fail('MODEL_JSON_EMPTY', '模型没有返回文字', '请检查模型回复是否为空或被输出规则过滤。');
    const object = value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        fail('MODEL_JSON_TYPE', '需要单个 JSON 对象', '不能用数组、文字或空值代替账本。');
    };
    const clean = text.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim();
    try { return object(JSON.parse(clean)); } catch (e) { if (e.diagnostic) throw e; }
    const candidates = [];
    let start = -1, stack = [], quoted = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (start < 0) {
            if (c === '<') {
                const opening = text.slice(i).match(/^<(think|thinking|analysis|script|style)\b[^>]*>/i);
                if (opening) {
                    const end = new RegExp('<\\/' + opening[1] + '\\s*>', 'i').exec(text.slice(i + opening[0].length));
                    if (!end) fail('MODEL_JSON_REASONING', /think|analysis/i.test(opening[1]) ? '思考标签未闭合' : '展示标签未闭合', '请检查模型是否只返回了思考或未完成回复。');
                    i += opening[0].length + end.index + end[0].length - 1; continue;
                }
                if (text.startsWith('<!--', i)) {
                    const end = text.indexOf('-->', i + 4);
                    if (end < 0) fail('MODEL_JSON_TRUNCATED', '隐藏注释不完整，可能被截断');
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
        '请检查预设或输出规则是否让模型续写正文、隐藏账本或输出多个结果。', '完整候选数：' + candidates.length);
    let value;
    try { value = JSON.parse(candidates[0]); }
    catch (error) {
        // Native SyntaxError messages may include private response excerpts.
        const offset = String(error.message).match(/\bposition\s+(\d+)/i)?.[1];
        fail('MODEL_JSON_SYNTAX', 'JSON 语法无效', '请让模型返回合法 JSON；不会猜改账本数值。',
            offset === undefined ? '' : '候选内字符位置：' + (Number(offset) + 1));
    }
    return object(value);
}
