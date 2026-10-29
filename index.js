import { createDaily } from './src/daily.js?v=1.0.6';
import { createDailyBridge } from './src/daily-story.js?v=1.0.6';
import { createAssets } from './src/assets.js?v=1.0.6';
import { createAssetBridge } from './src/assets-story.js?v=1.0.6';
import { createOpinionBridge } from './src/x-opinion.js?v=1.0.6';
import { createAmazon } from './src/amazon.js?v=1.0.6';
import { createDeliveryBridge } from './src/delivery.js?v=1.0.6';
import { createGenerationReader } from './src/host-state.js?v=1.0.6';
import { createDiagnostics } from './src/diagnostics.js?v=1.0.6';
import { createX } from './src/x.js?v=1.0.6';
import { createSnapchat } from './src/snapchat.js?v=1.0.6';
import { readPreparedMemory } from './src/external-memory.js?v=1.0.6';
import { createApiClient, createKeyStore } from './src/api.js?v=1.0.6';
import { captureHostRequest } from './src/api-context.js?v=1.0.6';
import { MODULE_KEY, VERSION } from './src/config.js?v=1.0.6';
import { mountPhone } from './src/ui.js?v=1.0.6';
import { createPhoneMemory, hostGenerationState } from './src/memory.js?v=1.0.6';
import { createPhoneService } from './src/phone.js?v=1.0.6';
import { createContinuityBridge } from './src/continuity.js?v=1.0.6';
import { normalizeSettings } from './src/config.js?v=1.0.6';

import { createStoryPhoneBridge } from './src/story-phone.js?v=1.0.6';

const keyStore = createKeyStore();
const diagnostics = createDiagnostics({version:VERSION,getSecrets:()=>keyStore.secrets()});
// Capture only errors belonging to this extension, never unrelated host errors.
const extensionUrl = new URL('.',import.meta.url).href;
window.addEventListener('error',event=>{if(event.filename?.startsWith(extensionUrl))diagnostics.add(event.error||event.message,'脚本');});
window.addEventListener('unhandledrejection',event=>{if(String(event.reason?.stack||'').includes(extensionUrl))diagnostics.add(event.reason,'异步任务');});

let modelClient;
let incomingWatcher;
let controller;
let memory;
let phoneService;
let continuityBridge;
let deliveryBridge;
let opinionBridge;
let assetBridge;
let dailyBridge;
let extensionPanel;
let observer;
let starting = false;

// Keep the settings panel available while the runtime is fully stopped.
// Destroying services also invalidates pending writes and prompt hooks.
function stopRuntime() {
    controller?.destroy(); controller = null;
    modelClient?.cancel(); modelClient = null;
    for (const service of [incomingWatcher, continuityBridge, deliveryBridge, opinionBridge, assetBridge, dailyBridge, phoneService, memory]) service?.destroy();
    incomingWatcher = continuityBridge = deliveryBridge = opinionBridge = assetBridge = dailyBridge = phoneService = memory = null;
}

async function start() {
    if (starting || controller) return;
    starting = true;
    try {
        const context = globalThis.SillyTavern?.getContext?.();
        if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
            throw new Error('当前酒馆未提供扩展设置接口，请更新酒馆后重试。');
        }
        const response = await fetch(new URL('./style.css?v=1.0.6', import.meta.url), { cache: 'no-cache' });
        if (!response.ok) throw new Error('无法读取榴莲手机样式，请检查安装包是否完整。');
        const styles = await response.text();
        let hostModule=null;
        try { hostModule=await import(new URL('../../../../script.js',import.meta.url).href); }
        catch { /* Keep compatibility with hosts without public generation exports. */ }
        const generationState=createGenerationReader(hostModule,()=>globalThis.SillyTavern.getContext(),hostGenerationState);
        function mountRuntime(showSettings = false) {
            const enabled = normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]).enabled;
            modelClient = createApiClient({ getContext: () => globalThis.SillyTavern.getContext(), getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]), getKey: url => keyStore.get(url,normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]).apiProfileId), prepareRequest: captureHostRequest });
            if (enabled) {
                memory = createPhoneMemory({
                    assetEnabled: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]).apps.assets,
                    getGenerationState:generationState,
                    getContext: () => globalThis.SillyTavern.getContext(),
                    onError: error => {diagnostics.add(error,'记录保存');globalThis.toastr?.error?.(error.message, '榴莲手机');},
                });
                phoneService = createPhoneService({
                    modelClient, onError:(error,source)=>diagnostics.add(error,source),
                    memory, getContext: () => globalThis.SillyTavern.getContext(),
                    getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),
                });
                continuityBridge = createContinuityBridge({
                    getContext: () => globalThis.SillyTavern.getContext(),
                    getSettings: () => normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),
                    onError: error => {diagnostics.add(error,'正文同步');globalThis.toastr?.error?.('本次未能同步手机记录，请检查记录格式或酒馆版本。', '榴莲手机');},
                });
                deliveryBridge=createDeliveryBridge({
                    getContext:()=>globalThis.SillyTavern.getContext(),
                    getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),
                    onError:error=>diagnostics.add(error,'订单配送'),
                });
                opinionBridge=createOpinionBridge({getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),onError:e=>diagnostics.add(e,'舆情衔接')});
                assetBridge=createAssetBridge({getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),onError:e=>diagnostics.add(e,'小榴莲正文同步')});
                dailyBridge=createDailyBridge({getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),onError:e=>diagnostics.add(e,'日报正文衔接')});
                incomingWatcher = createStoryPhoneBridge({getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY]),onError:e=>diagnostics.add(e,'正文通信')});
            }
            const adapter = {
                daily:enabled ? createDaily({memory,phone:phoneService,getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY])}) : null,
                assets:enabled ? createAssets({memory,phone:phoneService,getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY])}) : null,
                storyChat:()=>globalThis.SillyTavern.getContext().chat||[],
                amazon:enabled ? createAmazon({memory,phone:phoneService,getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY])}) : null,
                api: modelClient, keyStore, diagnostics,
                memoryStatus: settings => readPreparedMemory(globalThis.SillyTavern.getContext(), settings),
                continuitySupported: continuityBridge?.supported ?? false,
                phone: phoneService,
                snapchat: enabled ? createSnapchat({memory,phone:phoneService,getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY])}) : null,
                x: enabled ? createX({memory,phone:phoneService,getContext:()=>globalThis.SillyTavern.getContext(),getSettings:()=>normalizeSettings(globalThis.SillyTavern.getContext().extensionSettings[MODULE_KEY])}) : null,
                userName:()=>globalThis.SillyTavern.getContext().name1,
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
                    const master = extensionPanel?.querySelector('[data-pp-enabled]');
                    if (master) master.checked = settings.enabled;
                    if (settings.enabled !== enabled) {
                        const wasOpen = controller?.isOpen();
                        stopRuntime();
                        mountRuntime(wasOpen);
                    }
                },
            };
            controller = mountPhone({ adapter, styles });
            if (showSettings) controller.openSettings();
        }
        mountRuntime();
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
                '<div class="inline-drawer-content"><p style="font-size:.85em;opacity:.75">v1.0 · 开发测试版</p><label class="checkbox_label"><span>启用榴莲手机</span><input type="checkbox" data-pp-enabled></label><label class="checkbox_label"><input type="checkbox" data-pp-visibility><span>显示悬浮入口</span></label>' +
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
            const master = extensionPanel.querySelector('[data-pp-enabled]');
            master.checked = controller.getSettings().enabled;
            master.addEventListener('change', () => { if (!controller.setEnabled(master.checked)) master.checked = controller.getSettings().enabled; });
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
        console.info('[榴莲手机] v1.0 已加载');
    } catch (error) {
        diagnostics.add(error,'初始化');
        stopRuntime();
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
