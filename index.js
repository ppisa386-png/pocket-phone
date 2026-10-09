import { readPreparedMemory } from './src/external-memory.js?v=0.11.0';
import { createApiClient, createKeyStore } from './src/api.js?v=0.11.0';
import { buildApiContext } from './src/api-context.js?v=0.11.0';
import { MODULE_KEY } from './src/config.js?v=0.11.0';
import { mountPhone } from './src/ui.js?v=0.11.0';
import { createPhoneMemory } from './src/memory.js?v=0.11.0';
import { createPhoneService } from './src/phone.js?v=0.11.0';
import { createContinuityBridge } from './src/continuity.js?v=0.11.0';
import { normalizeSettings } from './src/config.js?v=0.11.0';

import { watchIncoming } from './src/incoming.js?v=0.11.0';

let modelClient;
let incomingWatcher;
let controller;
let memory;
let phoneService;
let continuityBridge;
let extensionPanel;
let observer;
let starting = false;

async function start() {
    if (starting || controller) return;
    starting = true;
    try {
        const context = globalThis.SillyTavern?.getContext?.();
        if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
            throw new Error('当前酒馆未提供扩展设置接口，请更新酒馆后重试。');
        }
        const response = await fetch(new URL('./style.css?v=0.11.0', import.meta.url), { cache: 'no-cache' });
        if (!response.ok) throw new Error('无法读取榴莲手机样式，请检查安装包是否完整。');
        const styles = await response.text();
        memory = createPhoneMemory({
            getContext: () => globalThis.SillyTavern.getContext(),
            onError: error => globalThis.toastr?.error?.(error.message, '榴莲手机'),
        });
        const keyStore = createKeyStore();
        modelClient = createApiClient({ getContext: () => globalThis.SillyTavern.getContext(), getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]), getKey: url => keyStore.get(url), buildContext: buildApiContext });
        phoneService = createPhoneService({
            modelClient,
            memory, getContext: () => globalThis.SillyTavern.getContext(),
            getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),
        });
        continuityBridge = createContinuityBridge({
            getContext: () => globalThis.SillyTavern.getContext(),
            getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),
            onError: () => globalThis.toastr?.error?.('本次未能同步手机记录，请检查记录格式或酒馆版本。', '榴莲手机'),
        });
        const adapter = {
            api: modelClient, keyStore,
            memoryStatus: settings => readPreparedMemory(globalThis.SillyTavern.getContext(), settings),
            continuitySupported: continuityBridge.supported,
            phone: phoneService,
            memory,
            load: () => globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY],
            save(settings) {
                const current = globalThis.SillyTavern.getContext();
                current.extensionSettings[MODULE_KEY] = settings;
                current.saveSettingsDebounced();
            },
            connectionName() {
                const current = globalThis.SillyTavern.getContext();
                return current.mainApi ? '连接类型：' + current.mainApi : '';
            },
            onChange(settings) {
                const checkbox = extensionPanel?.querySelector('[data-pp-visibility]');
                if (checkbox) checkbox.checked = settings.launcherVisible;
            },
        };
        controller = mountPhone({ adapter, styles });
        incomingWatcher = watchIncoming({ getContext: () => globalThis.SillyTavern.getContext(), phone: phoneService });
        // Install only the small entry controls into SillyTavern's extension drawer.
        // Phone UI lives in a Shadow DOM to avoid affecting SillyTavern or other extensions.
        function attachPanel() {
            if (extensionPanel?.isConnected) return true;
            const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (!target) return false;
            extensionPanel = document.createElement('div');
            extensionPanel.id = 'personal-pocket-phone-extension-settings';
            extensionPanel.className = 'extension_container';
            extensionPanel.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>榴莲手机</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
                '<div class="inline-drawer-content"><p style="font-size:.85em;opacity:.75">v0.11.0 · 开发测试版</p><label class="checkbox_label"><input type="checkbox" data-pp-visibility><span>显示悬浮入口</span></label>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button type="button" class="menu_button" data-pp-open>打开手机设置</button><button type="button" class="menu_button" data-pp-reset>重置悬浮位置</button></div></div></div>';
            // Host themes may give .menu_button an icon-sized/min-content width.
            // Keep these two text controls horizontal without changing host CSS.
            for (const button of extensionPanel.querySelectorAll('button')) {
                for (const [property, value] of Object.entries({
                    width: 'auto', 'min-width': 'max-content', flex: '0 0 auto',
                    'white-space': 'nowrap', 'word-break': 'normal',
                    'writing-mode': 'horizontal-tb', display: 'inline-flex',
                    'align-items': 'center', 'justify-content': 'center', padding: '8px 12px',
                })) button.style.setProperty(property, value, 'important');
            }
            const visibility = extensionPanel.querySelector('[data-pp-visibility]');
            visibility.checked = controller.getSettings().launcherVisible;
            visibility.addEventListener('change', () => controller.setLauncherVisible(visibility.checked));
            extensionPanel.querySelector('[data-pp-open]').addEventListener('click', () => controller.openSettings());
            extensionPanel.querySelector('[data-pp-reset]').addEventListener('click', () => controller.resetPosition());
            target.append(extensionPanel);
            return true;
        }
        if (!attachPanel()) {
            observer = new MutationObserver(() => { if (attachPanel()) { observer.disconnect(); observer = null; } });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        // Phone and SMS share the selected host or independent connection.
        console.info('[榴莲手机] v0.11.0 已加载');
    } catch (error) {
        modelClient?.cancel();
        incomingWatcher?.destroy();
        continuityBridge?.destroy();
        phoneService?.destroy();
        memory?.destroy();
        console.error('[榴莲手机] 初始化失败', error);
        globalThis.toastr?.error?.(error.message, '榴莲手机');
    } finally {
        starting = false;
    }
}

function boot() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (context?.eventSource?.on && context?.event_types?.APP_READY) {
        context.eventSource.on(context.event_types.APP_READY, start);
    } else {
        // Compatibility path for versions without APP_READY: the extension entry
        // is loaded after the public SillyTavern context becomes available.
        start();
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
