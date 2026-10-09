import { createSnapPanel } from './snapchat-view.js?v=0.13.0';
import { snapUnread } from './snapchat.js?v=0.13.0';
import { createApiPanel } from './api-view.js?v=0.13.0';
import { APPS, PROMPTS, VERSION, LAUNCHER_SIZE, normalizeSettings, clampPosition } from './config.js?v=0.13.0';
import { icon } from './icons.js?v=0.13.0';
import { renderMessagesScreen } from './messages-view.js?v=0.13.0';
import { unreadMessages, messageParticipants } from './messages.js?v=0.13.0';
import { renderPhoneScreen } from './phone-view.js?v=0.13.0';

const SECTIONS = [
    { id: 'appearance', name: '外观', icon: 'display', note: '主题、壁纸、字号与大小' },
    { id: 'api', name: 'API', icon: 'api', note: '模型连接' },
    { id: 'apps', name: 'App 管理', icon: 'apps', note: '选择桌面上显示的应用' },
    { id: 'prompts', name: '提示词', icon: 'prompts', note: '按功能分别编辑' },
    { id: 'contact', name: '主动联系', icon: 'phone', note: '允许角色主动联系' },
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
    let phoneView = { contacts: {}, calls: {}, busy: false, error: '' };
    let selectedCallId = null;
    let callDraft = '';
    let previousActiveCallId = null;
    let selectedSMSContactId = null;
    let pickingSMSContact = false;
    let smsDrafts = Object.create(null);
    let smsRenderKey = '';
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
    layer.innerHTML = '<button type="button" class="pp-launcher" aria-label="打开榴莲手机" title="打开榴莲手机 · 拖动可移动" aria-expanded="false">' + icon('launcher') + '<span class="pp-launcher-badge" hidden></span></button>' +
        '<section class="pp-phone" role="dialog" aria-label="榴莲手机" hidden>' +
        '<div class="pp-topline"><span class="pp-status-time"></span><span class="pp-island"></span></div>' +
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
    const apiPanel = createApiPanel({ adapter, getSettings: () => settings, persist, redraw: () => { if (!destroyed && route === 'api') renderAPI(); } });

    const snapPanel = createSnapPanel({adapter,getView:()=>phoneView,redraw:()=>{if(!destroyed&&opened&&route==='app:snapchat')renderSnapchat();},notice});

    function renderSnapchat() {
        const active=shadow.activeElement;const field=active?.dataset.snapField;
        const selection=field&&active.tagName==='TEXTAREA'?[active.selectionStart,active.selectionEnd]:null;
        const scroll=content.scrollTop;const clipsScroll=content.querySelector('.pp-snap-clips')?.scrollTop;
        content.innerHTML=snapPanel.html();content.scrollTop=scroll;
        const clips=content.querySelector('.pp-snap-clips');if(clips&&clipsScroll!=null)clips.scrollTop=clipsScroll;
        const next=field?Array.from(content.querySelectorAll('[data-snap-field]')).find(el=>el.dataset.snapField===field):null;
        if(next){next.focus({preventScroll:true});if(selection)next.setSelectionRange(...selection);}
        queueMicrotask(()=>{if(opened&&route==='app:snapchat')void snapPanel.readVisible();});
    }

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
        const badge = launcher.querySelector('.pp-launcher-badge');
        badge.hidden = !settings.apps.phone || !unreadCalls();
    }

    function viewport() { return { width: window.innerWidth, height: window.innerHeight }; }

    function placeLauncher() {
        const view = viewport();
        const saved = settings.position;
        const point = clampPosition(saved ? { x: saved.x * (view.width - LAUNCHER_SIZE), y: saved.y * (view.height - LAUNCHER_SIZE) } : null, view);
        launcher.style.left = point.x + 'px';
        launcher.style.top = point.y + 'px';
    }

    function unreadCalls() { return Object.values(phoneView.calls || {}).filter(call => call.direction === 'incoming' && !call.read).length; }
    function appButton(app) {
        const unread = app.id === 'messages' ? unreadMessages(phoneView.messages) : app.id === 'phone' ? unreadCalls() : app.id === 'snapchat' ? snapUnread(phoneView) : 0;
        const badge = unread ? '<span class="pp-app-badge" aria-label="' + unread + (app.id === 'phone' ? ' 条待处理来电' : ' 条未读消息') + '">' + (unread > 99 ? '99+' : unread) + '</span>' : '';
        return '<button type="button" class="pp-app" data-app="' + app.id + '" aria-label="打开' + app.name + '"><span class="pp-app-icon pp-app-' + app.id + '" style="--app-color:' + app.color + '">' + icon(app.id) + badge + '</span><span class="pp-app-name">' + app.name + '</span></button>';
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
            '</div><p class="pp-footnote">榴莲手机 ' + VERSION + ' · 开发测试版</p></div>';
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

    function renderAPI() { content.innerHTML = apiPanel.html(); }

    function renderApps() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card">' + APPS.map(app => '<label class="pp-toggle-row"><span class="pp-small-app pp-app-' + app.id + '" style="--app-color:' + app.color + '">' + icon(app.id) + '</span><span>' + app.name + '</span><input type="checkbox" role="switch" data-enabled="' + app.id + '"' + (settings.apps[app.id] ? ' checked' : '') + ' aria-label="启用' + app.name + '"><span class="pp-switch" aria-hidden="true"></span></label>').join('') + '</div><p class="pp-footnote">关闭后从桌面隐藏，已有内容保留。设置始终可用。</p></div>';
    }

    function renderPrompts() {
        content.innerHTML = '<div class="pp-page"><label class="pp-field pp-prompt-select"><span>功能</span><select data-prompt-selector>' + Object.entries(PROMPTS).map(([id, prompt]) => '<option value="' + id + '"' + (id === promptId ? ' selected' : '') + '>' + prompt.name + '</option>').join('') + '</select></label>' +
            '<label class="pp-editor-label" for="pp-prompt-editor">提示词内容</label><textarea id="pp-prompt-editor" class="pp-editor" data-prompt-editor spellcheck="false" maxlength="30000"></textarea><div class="pp-editor-footer"><span class="pp-save-status" aria-live="polite">修改后自动保存</span><button type="button" class="pp-text-button" data-action="reset-prompt">恢复此项默认</button></div><p class="pp-footnote">内容语言以酒馆预设为准。联系方式识别、电话、主动来电、主动短信、短信、Snapchat 和正文衔接提示词现已生效；其余用于后续功能。</p></div>';
        content.querySelector('[data-prompt-editor]').value = settings.prompts[promptId];
    }

    function renderContactSettings() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card pp-form">' +
            selectField('proactiveEnabled', '允许主动联系', [['true', '开启'], ['false', '关闭']], String(settings.proactiveEnabled)) + '</div></div>';
    }

    function renderRetry() {
        content.innerHTML = '<div class="pp-page"><div class="pp-card pp-form"><label class="pp-field"><span>失败后自动重试次数</span><input class="pp-number" type="number" inputmode="numeric" min="0" max="15" step="1" data-setting="retries" value="' + settings.retries + '" aria-describedby="pp-retry-help"></label></div><p id="pp-retry-help" class="pp-footnote">填写 0—15 的整数。0 表示不自动重试；次数不包含首次请求，成功后立即停止。</p><p class="pp-footnote">此设置用于联系人识别、来电判断、电话和短信回应的请求失败重试。</p></div>';
    }

    function renderPhone() {
        const input = shadow.querySelector('[data-phone-draft]');
        const focused = input && shadow.activeElement === input;
        const selection = input ? [input.selectionStart, input.selectionEnd] : null;
        const scroll = content.scrollTop;
        content.innerHTML = renderPhoneScreen(phoneView, phoneTab, selectedCallId, callDraft);
        content.scrollTop = scroll;
        const next = shadow.querySelector('[data-phone-draft]');
        if (focused && next) { next.focus({ preventScroll: true }); next.setSelectionRange(...selection); }
        if (Object.values(phoneView.calls || {}).some(call => call.direction === 'incoming' && !call.read && ['ended', 'declined', 'missed', 'interrupted'].includes(call.status))) phoneAction(() => adapter.phone.markCallsRead());
    }
    function renderMessages() {
        const input = shadow.querySelector('[data-sms-draft]');
        const focused = input && shadow.activeElement === input;
        const selection = input ? [input.selectionStart, input.selectionEnd] : null;
        const scroll = content.scrollTop;
        const count = Object.values(phoneView.messages || {}).filter(item => item.contactId === selectedSMSContactId).length;
        const key = selectedSMSContactId + ':' + count;
        content.innerHTML = renderMessagesScreen(phoneView, selectedSMSContactId, pickingSMSContact, smsDrafts);
        content.scrollTop = key === smsRenderKey ? scroll : content.scrollHeight;
        smsRenderKey = key;
        const next = shadow.querySelector('[data-sms-draft]');
        if (focused && next && !next.disabled) { next.focus({ preventScroll: true }); next.setSelectionRange(...selection); }
        if (opened && selectedSMSContactId && unreadMessages(phoneView.messages, selectedSMSContactId)) {
            phoneAction(() => adapter.phone.markMessagesRead(selectedSMSContactId));
        }
    }
    function phoneAction(action) {
        if (!adapter.phone) { notice('请在酒馆中连接 API 后使用通信功能。'); return; }
        Promise.resolve().then(action).catch(error => notice(error.message));
    }

    function renderEmptyApp(id) {
        const app = APPS.find(item => item.id === id);
        const words = {
            phone: phoneTab === 'contacts' ? ['暂无联系人', '点击「新增联系人」后查找可见正文和人设中的电话联系人。'] : ['暂无通话记录', '电话功能将在下一阶段接入。'],
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
        else if (route === 'contact') renderContactSettings();
        else if (route === 'retry') renderRetry();
        else if (app?.id === 'phone') renderPhone();
        else if (app?.id === 'messages') renderMessages();
        else if (app?.id === 'snapchat') renderSnapchat();
        else if (app) renderEmptyApp(app.id);
        content.scrollTop = route === 'app:messages' && selectedSMSContactId ? content.scrollHeight : 0;
    }

    function navigate(next) {
        if (next === route) return;
        history.push(route);
        route = next;
        render();
        shadow.querySelector('[data-action="back"]').focus({ preventScroll: true });
        if (next === 'app:phone') phoneAction(() => adapter.phone.open());
        if (next === 'app:messages') phoneAction(() => adapter.phone.openMessages());
        if (next === 'app:snapchat' && adapter.snapchat) phoneAction(() => adapter.snapchat.open());
    }

    function open() {
        if (opened) return;
        lastFocused = document.activeElement;
        opened = true;
        const incoming = phoneView.calls?.[phoneView.activeCallId];
        if (settings.apps.phone && incoming?.status === 'ringing') { route = 'app:phone'; history = ['home']; selectedCallId = incoming.id; }
        phone.hidden = false;
        if(windowPosition){const point={...windowPosition};phone.style.height='';phone.style.bottom='';phone.style.top='';movePhone(point.x,point.y);}
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
        for(const el of content.querySelectorAll('[data-snap-expiry]'))el.textContent=Date.now()-Number(el.dataset.snapExpiry)>=86400000?'已过期 · 留存':'24 小时内';
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
        if (target.dataset.snapAction) { void snapPanel.action(target.dataset.snapAction,target.dataset.snapId); return; }
        if (target.dataset.apiAction) { void apiPanel.action(target.dataset.apiAction); return; }
        const action = target.dataset.action;
        if (action === 'close') close();
        if (action === 'home') { route = 'home'; history = []; render(); }
        if (action === 'back') { route = history.pop() || 'home'; render(); }
        if (target.dataset.app) navigate(target.dataset.app === 'settings' ? 'settings' : 'app:' + target.dataset.app);
        if (target.dataset.section) navigate(target.dataset.section);
        if (target.dataset.wallpaper && persist({ wallpaper: target.dataset.wallpaper })) {
            shadow.querySelectorAll('[data-wallpaper]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wallpaper === settings.wallpaper)));
        }
        if (target.dataset.phoneTab) { phoneTab = target.dataset.phoneTab; selectedCallId = null; renderPhone(); }
        if (target.hasAttribute('data-phone-sync')) phoneAction(() => adapter.phone.scan());
        if (target.dataset.phoneDial) phoneAction(() => adapter.phone.dial(target.dataset.phoneDial));
        if (target.dataset.phoneRecord) { selectedCallId = target.dataset.phoneRecord; callDraft = ''; renderPhone(); }
        if (target.hasAttribute('data-phone-list')) { selectedCallId = null; phoneTab = 'history'; renderPhone(); }
        if (target.hasAttribute('data-phone-hangup')) phoneAction(async () => { await adapter.phone.hangup(); selectedCallId = phoneView.activeCallId; phoneTab = 'history'; callDraft = ''; renderPhone(); });
        if (target.hasAttribute('data-phone-answer')) phoneAction(() => adapter.phone.answer());
        if (target.hasAttribute('data-phone-decline')) phoneAction(() => adapter.phone.decline());
        if (target.hasAttribute('data-phone-check-incoming')) phoneAction(() => adapter.phone.checkIncoming());
        if (target.hasAttribute('data-phone-retry')) phoneAction(() => adapter.phone.retry());
        if (target.hasAttribute('data-sms-new')) { pickingSMSContact = true; selectedSMSContactId = null; renderMessages(); }
        if (target.hasAttribute('data-sms-back')) { pickingSMSContact = false; selectedSMSContactId = null; renderMessages(); }
        if (target.hasAttribute('data-sms-blocklist')) { pickingSMSContact = 'blocked'; selectedSMSContactId = null; renderMessages(); }
        if (target.dataset.blockId) phoneAction(() => adapter.phone.setBlocked(target.dataset.blockId, target.dataset.blockChannel, target.dataset.blockValue === 'true'));
        if (target.dataset.smsContact) { selectedSMSContactId = target.dataset.smsContact; pickingSMSContact = false; renderMessages(); }
        if (target.hasAttribute('data-sms-sync')) phoneAction(() => adapter.phone.scan());
        if (target.dataset.smsRetry) phoneAction(() => adapter.phone.retryMessage(target.dataset.smsRetry));
        if (action === 'reset-prompt' && persist({ prompts: { ...settings.prompts, [promptId]: PROMPTS[promptId].text } })) { renderPrompts(); notice('已恢复此项默认提示词'); }
    }, { signal: lifetime.signal });

    shadow.addEventListener('submit', event => {
        if(event.target.dataset.snapForm){event.preventDefault();void snapPanel.submit(event.target);return;}
        if (event.target.hasAttribute('data-sms-form')) {
            event.preventDefault();
            const contactId = selectedSMSContactId;
            const draft = smsDrafts[contactId] || '';
            if (draft.trim()) phoneAction(async () => {
                const result = await adapter.phone.sendMessage(contactId, draft);
                if (result?.value?.saved && smsDrafts[contactId] === draft) delete smsDrafts[contactId];
                if (opened && route === 'app:messages') renderMessages();
            });
            return;
        }
        if (!event.target.hasAttribute('data-phone-form')) return;
        event.preventDefault();
        const text = callDraft.trim();
        if (text) phoneAction(async () => { callDraft = ''; await adapter.phone.say(text); });
    }, { signal: lifetime.signal });

    shadow.addEventListener('change', event => {
        const target = event.target;
        if(target.dataset.snapField){snapPanel.input(target);return;}
        if (target.dataset.apiField && target.tagName === 'SELECT') { apiPanel.input(target.dataset.apiField, target.value); return; }
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
            if (['proactiveEnabled'].includes(key)) value = value === 'true';
            if (persist({ [key]: value })) {
                const output = shadow.querySelector('[data-output="' + key + '"]');
                if (output) output.textContent = settings[key];
            }
        }
    }, { signal: lifetime.signal });

    shadow.addEventListener('input', event => {
        if(event.target.dataset.snapField){snapPanel.input(event.target);return;}
        if (event.target.dataset.apiField && event.target.tagName !== 'SELECT') {
            apiPanel.input(event.target.dataset.apiField, event.target.value);
            if (event.target.dataset.apiField === 'baseUrl') { const keyInput = shadow.querySelector('[data-api-field="key"]'); if (keyInput) keyInput.value = apiPanel.keyValue(); }
            const status = shadow.querySelector('[data-api-status]'); if (status) { status.textContent = '尚未保存。'; status.dataset.kind = ''; }
            return;
        }
        if (event.target.hasAttribute('data-sms-draft') && selectedSMSContactId) smsDrafts[selectedSMSContactId] = event.target.value;
        if (event.target.hasAttribute('data-phone-draft')) callDraft = event.target.value;
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
    const phoneHandle = shadow.querySelector('.pp-topline');
    phoneHandle.title = '拖动顶部移动手机';
    let windowDrag = null;
    let windowPosition = null;
    function movePhone(x, y) {
        const rect = phone.getBoundingClientRect();
        const point = {x:Math.max(4,Math.min(x,Math.max(4,window.innerWidth-rect.width-4))),
            y:Math.max(4,Math.min(y,Math.max(4,window.innerHeight-rect.height-4)))};
        phone.style.height = rect.height + 'px';
        phone.style.bottom = 'auto'; phone.style.right = 'auto';
        phone.style.left = point.x + 'px'; phone.style.top = point.y + 'px';
        windowPosition = point;
    }
    phoneHandle.addEventListener('pointerdown', event => {
        if(event.button !== 0 || event.isPrimary === false) return;
        const rect=phone.getBoundingClientRect();
        windowDrag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
        try {phoneHandle.setPointerCapture(event.pointerId);} catch { /* Embedded browser fallback. */ }
        event.preventDefault();event.stopPropagation();
    }, {signal:lifetime.signal});
    phoneHandle.addEventListener('pointermove', event => {
        if(!windowDrag || windowDrag.id!==event.pointerId)return;
        movePhone(windowDrag.left+event.clientX-windowDrag.x,windowDrag.top+event.clientY-windowDrag.y);
    }, {signal:lifetime.signal});
    function finishWindowDrag(event) {
        if(windowDrag?.id!==event.pointerId)return;
        windowDrag=null;
        if(phoneHandle.hasPointerCapture(event.pointerId))phoneHandle.releasePointerCapture(event.pointerId);
    }
    for(const event of ['pointerup','pointercancel','lostpointercapture'])phoneHandle.addEventListener(event,finishWindowDrag,{signal:lifetime.signal});
    window.addEventListener('resize', () => {
        placeLauncher();
        if(windowPosition){
            const point={...windowPosition};phone.style.height='';
            // Reset to responsive dimensions before clamping after rotation.
            phone.style.bottom='';phone.style.top='';
            if(opened)movePhone(point.x,point.y);
        }
    }, { signal: lifetime.signal });
    shadow.addEventListener('keydown', event => {
        if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); }
    }, { signal: lifetime.signal });

    let lastScope;
    const unsubscribeMemory = adapter.memory?.subscribe(({ scope }) => {
        if (scope !== lastScope) {
            lastScope = scope;
            route = 'home'; history = []; phoneTab = 'history'; selectedCallId = null; callDraft = '';
            snapPanel.reset();
            selectedSMSContactId = null; pickingSMSContact = false; smsDrafts = Object.create(null); smsRenderKey = '';
            if (opened) render();
        }
    });
    const unsubscribePhone = adapter.phone?.subscribe(view => {
        phoneView = view;
        const badge = launcher.querySelector('.pp-launcher-badge');
        const count = settings.apps.phone ? unreadCalls() : 0;
        badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count);
        badge.setAttribute('aria-label', count + ' 条待处理来电');
        if (view.activeCallId && view.activeCallId !== previousActiveCallId) { selectedCallId = view.activeCallId; callDraft = ''; }
        previousActiveCallId = view.activeCallId;
        if (selectedCallId && !view.calls[selectedCallId]) selectedCallId = null;
        if (selectedSMSContactId && !messageParticipants(view)[selectedSMSContactId]) selectedSMSContactId = null;
        if (opened && route === 'app:phone') renderPhone();
        if (opened && route === 'app:messages') renderMessages();
        if (opened && route === 'app:snapchat') renderSnapchat();
        if (opened && route === 'home') renderHome();
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
            apiPanel.destroy();
            lifetime.abort();
            unsubscribeMemory?.();
            unsubscribePhone?.();
            clearInterval(clockInterval);
            clearTimeout(noticeTimeout);
            host.remove();
        },
    };
}
