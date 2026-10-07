import { APPS, PROMPTS, VERSION, LAUNCHER_SIZE, normalizeSettings, clampPosition } from './config.js';
import { icon } from './icons.js';

const SECTIONS = [
    { id: 'appearance', name: '外观', icon: 'display', note: '主题、壁纸、字号与大小' },
    { id: 'api', name: 'API', icon: 'api', note: '模型连接' },
    { id: 'apps', name: 'App 管理', icon: 'apps', note: '选择桌面上显示的应用' },
    { id: 'prompts', name: '提示词', icon: 'prompts', note: '按功能分别编辑' },
    { id: 'retry', name: '失败重试', icon: 'retry', note: '设置自动重试次数' },
];

function esc(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function mountPhone({ adapter, styles, container = document.body }) {
    let settings = normalizeSettings(adapter.load());
    let route = 'home';
    let history = [];
    let promptId = 'general';
    let phoneTab = 'history';
    let opened = false;
    let lastFocused = null;
    let dragging = null;
    let suppressClickUntil = 0;
    let destroyed = false;
    let noticeTimeout;
    const lifetime = new AbortController();
    const host = document.createElement('div');
    host.id = 'personal-pocket-phone-root';
    // Keep the widget out of theme stacking/transform contexts when supported.
    // A manual popover is non-modal: the rest of SillyTavern remains usable.
    const topLayerAvailable = typeof host.showPopover === 'function';
    if (topLayerAvailable) host.setAttribute('popover', 'manual');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    shadow.append(style);
    const layer = document.createElement('div');
    layer.className = 'pp-layer';
    layer.style.setProperty('--pp-launcher-size', LAUNCHER_SIZE + 'px');
    layer.innerHTML = '<button type="button" class="pp-launcher" aria-label="打开榴莲手机" title="打开榴莲手机 · 拖动可移动" aria-expanded="false">' + icon('launcher') + '</button>' +
        '<section class="pp-phone" role="dialog" aria-label="榴莲手机" hidden>' +
        '<div class="pp-topline"><span class="pp-status-time"></span><span class="pp-island"></span><span class="pp-device-label">文字手机</span></div>' +
        '<header class="pp-header"><button type="button" data-action="back" class="pp-icon-button" aria-label="返回">' + icon('back') + '</button><span class="pp-title"></span><button type="button" data-action="close" class="pp-icon-button" aria-label="收起手机">' + icon('close') + '</button></header>' +
        '<main class="pp-content"></main><div class="pp-toast" role="status" aria-live="polite" hidden></div>' +
        '<footer class="pp-footer"><button type="button" data-action="home" aria-label="回到桌面"><span></span></button></footer></section>';
    shadow.append(layer);
    container.append(host);
    if (topLayerAvailable) {
        try { host.showPopover(); }
        catch { host.removeAttribute('popover'); }
    }
    const launcher = shadow.querySelector('.pp-launcher');
    const phone = shadow.querySelector('.pp-phone');
    const content = shadow.querySelector('.pp-content');
    const title = shadow.querySelector('.pp-title');
    const noticeElement = shadow.querySelector('.pp-toast');

    function notice(message) {
        noticeElement.textContent = message;
        noticeElement.hidden = false;
        clearTimeout(noticeTimeout);
        noticeTimeout = setTimeout(() => { noticeElement.hidden = true; }, 2600);
    }

    function persist(patch) {
        const previous = settings;
        settings = normalizeSettings({ ...settings, ...patch });
        try {
            adapter.save(settings);
        } catch (error) {
            settings = previous;
            applyAppearance();
            notice('设置保存失败，请检查储存空间后重试。');
            console.error('[榴莲手机] 无法保存设置', error);
            return false;
        }
        applyAppearance();
        adapter.onChange?.(settings);
        return true;
    }

    function applyAppearance() {
        layer.dataset.theme = settings.theme;
        layer.dataset.wallpaper = settings.wallpaper;
        layer.style.setProperty('--pp-font-size', settings.fontSize + 'px');
        layer.style.setProperty('--pp-phone-width', settings.phoneWidth + 'px');
        launcher.hidden = !settings.launcherVisible;
    }

    function viewport() { return { width: window.innerWidth, height: window.innerHeight }; }

    function placeLauncher() {
        const view = viewport();
        const saved = settings.position;
        const point = clampPosition(saved ? { x: saved.x * (view.width - LAUNCHER_SIZE), y: saved.y * (view.height - LAUNCHER_SIZE) } : null, view);
        launcher.style.left = point.x + 'px';
        launcher.style.top = point.y + 'px';
    }

    function appButton(app) {
        return '<button type="button" class="pp-app" data-app="' + app.id + '" aria-label="打开' + app.name + '"><span class="pp-app-icon pp-app-' + app.id + '" style="--app-color:' + app.color + '">' + icon(app.id) + '</span><span class="pp-app-name">' + app.name + '</span></button>';
    }

    function renderHome() {
        const enabled = APPS.filter(app => settings.apps[app.id]);
        content.innerHTML = '<div class="pp-home"><div class="pp-home-clock"><div class="pp-date"></div><div class="pp-big-time"></div><span class="pp-time-label">设备时间</span></div>' +
            '<div class="pp-app-grid">' + enabled.filter(app => !app.dock).map(appButton).join('') + '</div>' +
            '<div class="pp-dock">' + enabled.filter(app => app.dock).map(appButton).join('') + appButton({ id: 'settings', name: '设置', color: '#778298' }) + '</div></div>';
        updateClock();
    }

    function renderSettings() {
        content.innerHTML = '<div class="pp-page"><div class="pp-page-lead">按你的习惯设置手机</div><div class="pp-card">' +
            SECTIONS.map(section => '<button type="button" class="pp-setting-row" data-section="' + section.id + '"><span class="pp-section-icon">' + icon(section.icon) + '</span><span><strong>' + section.name + '</strong><small>' + section.note + '</small></span><span class="pp-row-chevron">' + icon('chevron') + '</span></button>').join('') +
            '</div><p class="pp-footnote">榴莲手机 ' + VERSION + ' · 界面测试版</p></div>';
    }

    function selectField(id, label, entries, selected) {
        return '<label class="pp-field"><span>' + label + '</span><select data-setting="' + id + '">' + entries.map(([value, text]) => '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + text + '</option>').join('') + '</select></label>';
    }

    function renderAppearance() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card pp-form">' +
            selectField('theme', '主题', [['dark', '深色'], ['light', '浅色']], settings.theme) +
            '<div class="pp-field pp-wallpaper-field"><span>壁纸</span><div class="pp-swatches">' + [['violet', '暮紫'], ['ocean', '海蓝'], ['sand', '暖砂'], ['graphite', '石墨']].map(([value, name]) => '<button type="button" class="pp-swatch" data-wallpaper="' + value + '" aria-label="' + name + '壁纸" aria-pressed="' + (settings.wallpaper === value) + '"><span></span><small>' + name + '</small></button>').join('') + '</div></div>' +
            '<label class="pp-field"><span>字号 <output data-output="fontSize">' + settings.fontSize + '</output></span><input type="range" min="14" max="20" step="1" data-setting="fontSize" value="' + settings.fontSize + '"></label>' +
            '<label class="pp-field"><span>窗口宽度 <output data-output="phoneWidth">' + settings.phoneWidth + '</output></span><input type="range" min="300" max="420" step="10" data-setting="phoneWidth" value="' + settings.phoneWidth + '"></label></div><p class="pp-footnote">小屏幕会自动适配可用宽度。</p></div>';
    }

    function renderAPI() {
        const connection = typeof adapter.connectionName === 'function' ? adapter.connectionName() : '';
        content.innerHTML = '<div class="pp-page"><div class="pp-card pp-info"><span class="pp-eyebrow">模型连接</span><h2>跟随酒馆当前连接</h2><p>' + esc(connection || '在酒馆的 API 连接页面配置模型。') + '</p></div><p class="pp-footnote">本阶段不发送模型请求。通信模块接入后，将使用这里的连接；独立 API 设置将在该阶段加入。</p></div>';
    }

    function renderApps() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card">' + APPS.map(app => '<label class="pp-toggle-row"><span class="pp-small-app pp-app-' + app.id + '" style="--app-color:' + app.color + '">' + icon(app.id) + '</span><span>' + app.name + '</span><input type="checkbox" role="switch" data-enabled="' + app.id + '"' + (settings.apps[app.id] ? ' checked' : '') + ' aria-label="启用' + app.name + '"><span class="pp-switch" aria-hidden="true"></span></label>').join('') + '</div><p class="pp-footnote">关闭后从桌面隐藏，已有内容保留。设置始终可用。</p></div>';
    }

    function renderPrompts() {
        content.innerHTML = '<div class="pp-page"><label class="pp-field pp-prompt-select"><span>功能</span><select data-prompt-selector>' + Object.entries(PROMPTS).map(([id, prompt]) => '<option value="' + id + '"' + (id === promptId ? ' selected' : '') + '>' + prompt.name + '</option>').join('') + '</select></label>' +
            '<label class="pp-editor-label" for="pp-prompt-editor">提示词内容</label><textarea id="pp-prompt-editor" class="pp-editor" data-prompt-editor spellcheck="false" maxlength="30000"></textarea><div class="pp-editor-footer"><span class="pp-save-status" aria-live="polite">修改后自动保存</span><button type="button" class="pp-text-button" data-action="reset-prompt">恢复此项默认</button></div><p class="pp-footnote">内容语言以酒馆预设为准。这些提示词将在对应通信模块接入后使用。</p></div>';
        content.querySelector('[data-prompt-editor]').value = settings.prompts[promptId];
    }

    function renderRetry() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card pp-form"><label class="pp-field"><span>失败后自动重试次数</span><input class="pp-number" type="number" inputmode="numeric" min="0" max="15" step="1" data-setting="retries" value="' + settings.retries + '" aria-describedby="pp-retry-help"></label></div><p id="pp-retry-help" class="pp-footnote">填写 0—15 的整数。0 表示不自动重试；次数不包含首次请求，成功后立即停止。</p><p class="pp-footnote">本阶段保存该设置，接入模型后生效。</p></div>';
    }

    function renderEmptyApp(id) {
        const app = APPS.find(item => item.id === id);
        const words = {
            phone: phoneTab === 'contacts' ? ['暂无联系人', '通讯模块接入后，在正文中获得号码的人物会出现在这里。'] : ['暂无通话记录', '电话功能将在下一阶段接入。'],
            messages: ['暂无短信', '短信功能将在后续阶段接入。'],
            snapchat: ['Snapchat', '好友邀请、私聊与 Stories 将在后续阶段接入。'],
            x: ['X', '个人主页、搜索与动态将在后续阶段接入。'],
            amazon: ['Amazon', '商品与虚拟订单将在后续阶段接入。'],
        };
        const [heading, detail] = words[id];
        content.innerHTML = '<div class="pp-empty-app"><div class="pp-empty"><span class="pp-empty-icon">' + icon(id === 'phone' && phoneTab === 'contacts' ? 'person' : app.id) + '</span><h2>' + heading + '</h2><p>' + detail + '</p><span class="pp-stage-label">页面预留</span></div>' +
            (id === 'phone' ? '<nav class="pp-phone-tabs" aria-label="电话页面"><button type="button" data-phone-tab="history" aria-pressed="' + (phoneTab === 'history') + '">' + icon('phone') + '<span>电话</span></button><button type="button" data-phone-tab="contacts" aria-pressed="' + (phoneTab === 'contacts') + '">' + icon('person') + '<span>联系人</span></button></nav>' : '') + '</div>';
    }

    function render() {
        if (destroyed) return;
        phone.dataset.home = String(route === 'home');
        shadow.querySelector('[data-action="back"]').hidden = route === 'home';
        const app = APPS.find(item => route === 'app:' + item.id);
        title.textContent = route === 'home' ? '' : route === 'settings' ? '设置' : app ? app.name : SECTIONS.find(section => section.id === route)?.name || '';
        if (route === 'home') renderHome();
        else if (route === 'settings') renderSettings();
        else if (route === 'appearance') renderAppearance();
        else if (route === 'api') renderAPI();
        else if (route === 'apps') renderApps();
        else if (route === 'prompts') renderPrompts();
        else if (route === 'retry') renderRetry();
        else if (app) renderEmptyApp(app.id);
        content.scrollTop = 0;
    }

    function navigate(next) {
        if (next === route) return;
        history.push(route);
        route = next;
        render();
        shadow.querySelector('[data-action="back"]').focus({ preventScroll: true });
    }

    function open() {
        if (opened) return;
        lastFocused = document.activeElement;
        opened = true;
        phone.hidden = false;
        launcher.setAttribute('aria-expanded', 'true');
        launcher.setAttribute('aria-label', '收起榴莲手机');
        render();
        shadow.querySelector('[data-action="close"]').focus({ preventScroll: true });
    }

    function close() {
        opened = false;
        phone.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
        launcher.setAttribute('aria-label', '打开榴莲手机');
        if (settings.launcherVisible) launcher.focus({ preventScroll: true });
        else if (lastFocused?.isConnected && lastFocused !== host) lastFocused.focus?.({ preventScroll: true });
    }

    function updateClock() {
        if (!opened) return;
        const now = new Date();
        const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        shadow.querySelector('.pp-status-time').textContent = time;
        const clock = content.querySelector('.pp-big-time');
        if (clock) clock.textContent = time;
        const date = content.querySelector('.pp-date');
        if (date) date.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
    }

    shadow.addEventListener('click', event => {
        const target = event.target.closest('button');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'close') close();
        if (action === 'home') { route = 'home'; history = []; render(); }
        if (action === 'back') { route = history.pop() || 'home'; render(); }
        if (target.dataset.app) navigate(target.dataset.app === 'settings' ? 'settings' : 'app:' + target.dataset.app);
        if (target.dataset.section) navigate(target.dataset.section);
        if (target.dataset.wallpaper && persist({ wallpaper: target.dataset.wallpaper })) {
            shadow.querySelectorAll('[data-wallpaper]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wallpaper === settings.wallpaper)));
        }
        if (target.dataset.phoneTab) { phoneTab = target.dataset.phoneTab; renderEmptyApp('phone'); }
        if (action === 'reset-prompt' && persist({ prompts: { ...settings.prompts, [promptId]: PROMPTS[promptId].text } })) { renderPrompts(); notice('已恢复此项默认提示词'); }
    }, { signal: lifetime.signal });

    shadow.addEventListener('change', event => {
        const target = event.target;
        if (target.dataset.enabled) persist({ apps: { ...settings.apps, [target.dataset.enabled]: target.checked } });
        if (target.hasAttribute('data-prompt-selector')) { promptId = target.value; renderPrompts(); }
        if (target.dataset.setting) {
            const key = target.dataset.setting;
            let value = target.value;
            if (['fontSize', 'phoneWidth', 'retries'].includes(key)) {
                value = Number(value);
                if (target.value.trim() === '' || !Number.isInteger(value) || !target.checkValidity()) {
                    target.value = settings[key];
                    notice(key === 'retries' ? '请填写 0—15 的整数' : '请填写有效数值');
                    return;
                }
            }
            if (persist({ [key]: value })) {
                const output = shadow.querySelector('[data-output="' + key + '"]');
                if (output) output.textContent = settings[key];
            }
        }
    }, { signal: lifetime.signal });

    shadow.addEventListener('input', event => {
        if (event.target.hasAttribute('data-prompt-editor')) {
            const saved = persist({ prompts: { ...settings.prompts, [promptId]: event.target.value } });
            content.querySelector('.pp-save-status').textContent = saved ? '已更新' : '保存失败';
        }
        if (event.target.type === 'range') {
            const key = event.target.dataset.setting;
            const output = shadow.querySelector('[data-output="' + key + '"]');
            if (output) output.textContent = event.target.value;
        }
    }, { signal: lifetime.signal });

    launcher.addEventListener('click', event => {
        event.stopPropagation();
        if (Date.now() < suppressClickUntil) return;
        opened ? close() : open();
    }, { signal: lifetime.signal });

    launcher.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.stopPropagation();
        const rect = launcher.getBoundingClientRect();
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, threshold: event.pointerType === 'touch' ? 12 : 6 };
        try { launcher.setPointerCapture(event.pointerId); } catch { /* Some embedded browsers reject capture. */ }
    }, { signal: lifetime.signal });

    launcher.addEventListener('pointermove', event => {
        if (!dragging || event.pointerId !== dragging.id) return;
        const dx = event.clientX - dragging.x;
        const dy = event.clientY - dragging.y;
        if (Math.hypot(dx, dy) > dragging.threshold) dragging.moved = true;
        if (!dragging.moved) return;
        const point = clampPosition({ x: dragging.left + dx, y: dragging.top + dy }, viewport());
        launcher.style.left = point.x + 'px';
        launcher.style.top = point.y + 'px';
    }, { signal: lifetime.signal });

    function endDrag(event) {
        if (!dragging || event.pointerId !== dragging.id) return;
        if (dragging.moved) {
            const rect = launcher.getBoundingClientRect();
            persist({ position: { x: rect.left / Math.max(1, window.innerWidth - LAUNCHER_SIZE), y: rect.top / Math.max(1, window.innerHeight - LAUNCHER_SIZE) } });
        } else if (event.type === 'pointerup') {
            // Handle a tap here: Android browsers may omit the later click.
            opened ? close() : open();
        }
        suppressClickUntil = Date.now() + 750;
        event.stopPropagation();
        if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
        dragging = null;
    }
    launcher.addEventListener('pointerup', endDrag, { signal: lifetime.signal });
    launcher.addEventListener('pointercancel', endDrag, { signal: lifetime.signal });
    window.addEventListener('resize', placeLauncher, { signal: lifetime.signal });
    shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); }
    }, { signal: lifetime.signal });

    let lastScope;
    const unsubscribeMemory = adapter.memory?.subscribe(({ scope }) => {
        if (scope !== lastScope) {
            lastScope = scope;
            route = 'home'; history = []; phoneTab = 'history';
            if (opened) render();
        }
    });
    const clockInterval = setInterval(updateClock, 15000);
    applyAppearance();
    placeLauncher();
    return {
        open,
        close,
        openSettings() { open(); history = ['home']; route = 'settings'; render(); },
        setLauncherVisible(visible) { persist({ launcherVisible: Boolean(visible) }); },
        resetPosition() { persist({ position: null }); placeLauncher(); },
        getSettings() { return structuredClone(settings); },
        destroy() {
            destroyed = true;
            lifetime.abort();
            unsubscribeMemory?.();
            clearInterval(clockInterval);
            clearTimeout(noticeTimeout);
            host.remove();
        },
    };
}
