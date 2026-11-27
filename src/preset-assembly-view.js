import { APPS, resolveAppConnection } from './config.js?v=1.2.102';
import { presetRule, presetRowSelected } from './preset-assembly.js?v=1.2.93';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

export function createPresetAssemblyPanel({ adapter, getSettings, persist, redraw, active }) {
    let app = 'x', snapshot = null, rule = { mode: 'follow', choices: {} }, error = '', status = '', dirty = false, showDiagnostic = false;
    function refresh(force = false) {
        try {
            if (!adapter.presetAssembly) throw new Error('请在酒馆内打开此页面，当前环境没有真实预设接口。');
            const next = adapter.presetAssembly.read();
            const changed = !snapshot || next.key !== snapshot.key || next.fingerprint !== snapshot.fingerprint || next.support !== snapshot.support;
            if (force || changed) {
                const same = snapshot?.key === next.key;
                // A content/order edit keeps unsaved choices for surviving IDs.
                // A preset switch loads that preset's saved choices, never another's.
                if (force || !same || !dirty) rule = presetRule(getSettings(), app, next);
                if (!same || force) dirty = false;
                snapshot = next;
                if (changed) status = same ? '已同步酒馆最新条目。' : '已载入当前预设的独立配置。';
            }
            const recovered = !!error;
            error = '';
            return changed || recovered;
        } catch (cause) {
            const changed = error !== cause.message;
            error = cause.message;
            snapshot = null;
            return changed;
        }
    }
    const timer = setInterval(() => { if (active() && refresh()) redraw(); }, 1000);
    const independent = () => resolveAppConnection(getSettings(), app).api.mode === 'independent';
    const listNames = list => list?.length ? list.map(item => esc(item.name) + ' <small>(' + esc(item.id) + ')</small>').join('、') : '无';
    return {
        html() {
            refresh();
            const host = !independent();
            const available = !!snapshot && !snapshot.support && !host;
            const custom = rule.mode === 'custom';
            let html = '<section class="pp-card pp-form pp-preset-panel"><label class="pp-field"><span>App</span><select data-assembly-field="app">' +
                APPS.map(item => '<option value="' + item.id + '"' + (app === item.id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('') + '</select></label>' +
                '<div class="pp-preset-heading"><strong>' + esc(snapshot?.name || '当前预设不可用') + '</strong><button type="button" class="pp-text-button" data-assembly-action="refresh">刷新</button></div>';
            if (error) html += '<p class="pp-footnote" role="alert">' + esc(error) + '</p>';
            if (host) html += '<p class="pp-footnote">该 App 当前跟随酒馆连接，该模式暂不支持自定义预设组装。已保存的选择仅在切回独立 API 后生效。</p>';
            if (snapshot?.support) html += '<p class="pp-footnote" role="alert">' + esc(snapshot.support) + '</p>';
            html += '<label class="pp-field"><span>组装模式</span><select data-assembly-field="mode"' + (!snapshot ? ' disabled' : '') + '><option value="follow"' + (!custom ? ' selected' : '') + '>跟随酒馆</option><option value="custom"' + (custom ? ' selected' : '') + (!available ? ' disabled' : '') + '>自定义组装</option></select></label>' +
                '<p class="pp-footnote">仅排除可独立识别的普通条目，不强制启用酒馆已禁用的条目。角色卡、世界书、历史与扩展内容保留酒馆处理；每个 App、每份预设分别保存。</p>';
            if (snapshot) {
                const disabled = !available || !custom ? ' disabled' : '';
                html += '<div class="pp-api-actions"><button type="button" class="pp-text-button" data-assembly-action="all"' + disabled + '>全选</button><button type="button" class="pp-text-button" data-assembly-action="none"' + disabled + '>全不选</button><button type="button" class="pp-text-button" data-assembly-action="reset">恢复默认</button></div>';
                html += '<div class="pp-preset-list">' + snapshot.rows.map(row => '<label class="pp-preset-row"><span><strong>' + esc(row.name) + '</strong><small>酒馆' + (row.enabled ? '已启用' : '已禁用') +
                    (row.reason ? ' · ' + esc(row.reason) : '') + '</small><small class="pp-preset-id">' + esc(row.id) + '</small></span>' +
                    (row.controllable ? '<input type="checkbox" data-assembly-entry="' + esc(row.id) + '" aria-label="纳入' + esc(row.name) + '"' + (presetRowSelected(row, custom ? rule : { choices: {} }) ? ' checked' : '') + ((!available || !custom || !row.enabled) ? ' disabled' : '') + '>' : '<small class="pp-preset-locked">随酒馆</small>') + '</label>').join('') +
                    (!snapshot.rows.length ? '<p class="pp-footnote">当前预设没有排序条目。</p>' : '') + '</div>' +
                    '<div class="pp-api-actions"><button type="button" class="pp-text-button" data-assembly-action="save"' + (custom && !available ? ' disabled' : '') + '>保存</button><button type="button" class="pp-text-button" data-assembly-action="diagnostic">查看组装信息</button></div>';
            }
            html += '<p class="pp-footnote" role="status">' + esc(dirty ? '有未保存的修改。' : status) + '</p>';
            if (showDiagnostic) {
                const info = adapter.presetAssembly?.diagnostic(app);
                html += '<div class="pp-preset-diagnostic">' + (info ? '<strong>最近一次实际请求</strong><p>App：' + esc(APPS.find(item => item.id === info.app)?.name || info.app) + '；预设：' + esc(info.preset) + '；模式：' + (info.mode === 'custom' ? '自定义组装' : '跟随酒馆') + '；' + esc(info.status) + '；' + esc(new Date(info.submittedAt).toLocaleString()) + '</p>' +
                    (info.mode === 'custom' ? '<p>纳入：' + listNames(info.included) + '</p><p>排除：' + listNames(info.excluded) + '</p><p>酒馆本次未组装（如禁用、触发条件、空内容）：' + listNames(info.absent) + '</p>' : '') +
                    '<p>保留酒馆处理：' + listNames(info.special) + '</p><p>' + esc(info.note) + '</p>' : '尚无此 App 的实际请求记录。当前勾选只是配置预览；保存不会调用模型。') + '</div>';
            }
            return html + '</section>';
        },
        change(field, value) {
            if (field === 'app' && APPS.some(item => item.id === value)) { app = value; snapshot = null; dirty = false; showDiagnostic = false; refresh(true); }
            if (field === 'mode' && ['follow','custom'].includes(value) && (value === 'follow' || (independent() && snapshot && !snapshot.support))) { rule.mode = value; dirty = true; }
            redraw();
        },
        check(id, checked) {
            const row = snapshot?.rows.find(item => item.id === id && item.controllable && item.enabled);
            if (row && independent() && !snapshot.support && rule.mode === 'custom') { rule.choices = { ...rule.choices, [id]: checked }; dirty = true; }
            redraw();
        },
        action(action) {
            if (action === 'refresh') { refresh(true); status = error || '已刷新并载入保存的配置。'; }
            if (action === 'diagnostic') showDiagnostic = !showDiagnostic;
            if (action === 'reset') { rule = { mode: 'follow', choices: {} }; dirty = true; }
            if (['all','none'].includes(action) && independent() && snapshot && !snapshot.support && rule.mode === 'custom') {
                for (const row of snapshot.rows.filter(item => item.controllable && item.enabled)) rule.choices[row.id] = action === 'all';
                dirty = true;
            }
            if (action === 'save' && snapshot) {
                const before = snapshot;
                if (refresh() || !snapshot || snapshot.fingerprint !== before.fingerprint) { status = '预设已变化，请核对最新条目后再次保存。'; dirty = false; }
                else if (rule.mode === 'follow' || (independent() && !snapshot.support)) {
                    const choices = Object.fromEntries(snapshot.rows.filter(row => row.controllable && Object.hasOwn(rule.choices, row.id)).map(row => [row.id, rule.choices[row.id]]));
                    const all = getSettings().presetAssemblies || {};
                    if (persist({ presetAssemblies: { ...all, [app]: { ...all[app], [snapshot.key]: { mode: rule.mode, choices } } } })) { dirty = false; status = '已保存；下一次任务使用此配置，在途任务保持发起时的选择。'; }
                    else status = '保存失败，请重试。';
                }
            }
            redraw();
        },
        destroy() { clearInterval(timer); },
    };
}
