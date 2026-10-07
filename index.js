import { MODULE_KEY } from './src/config.js';
import { mountPhone } from './src/ui.js';

let controller;
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
        const response = await fetch(new URL('./style.css', import.meta.url));
        if (!response.ok) throw new Error('无法读取小手机样式，请检查安装包是否完整。');
        const styles = await response.text();
        const adapter = {
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
        // Install only the small entry controls into SillyTavern's extension drawer.
        // Phone UI lives in a Shadow DOM to avoid affecting SillyTavern or other extensions.
        function attachPanel() {
            if (extensionPanel?.isConnected) return true;
            const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
            if (!target) return false;
            extensionPanel = document.createElement('div');
            extensionPanel.id = 'personal-pocket-phone-extension-settings';
            extensionPanel.className = 'extension_container';
            extensionPanel.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>小手机</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
                '<div class="inline-drawer-content"><p style="font-size:.85em;opacity:.75">v0.1.0 · 界面测试版</p><label class="checkbox_label"><input type="checkbox" data-pp-visibility><span>显示悬浮入口</span></label>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button type="button" class="menu_button" data-pp-open>打开手机设置</button><button type="button" class="menu_button" data-pp-reset>重置悬浮位置</button></div></div></div>';
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
        // Save no chat data and make no generation calls in this first-stage build.
        console.info('[小手机] v0.1.0 已加载');
    } catch (error) {
        console.error('[小手机] 初始化失败', error);
        globalThis.toastr?.error?.(error.message, '小手机');
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
