"""Build a dependency-free HTML preview using the exact extension UI source."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
chunks = []
for name in ['config.js', 'api.js', 'api-view.js', 'icons.js', 'journal.js', 'contact-events.js', 'block-controls.js', 'phone-view.js', 'messages.js', 'messages-view.js', 'ui.js']:
    code = (root / 'src' / name).read_text()
    code = re.sub(r'^import .+;\n', '', code, flags=re.M)
    code = re.sub(r'^export ', '', code, flags=re.M)
    chunks.append(code)

bootstrap = r'''
const PREVIEW_KEY = 'pocket_phone_preview_v010';
let storageAvailable = true;
let memory = {};
try { localStorage.setItem(PREVIEW_KEY + '_probe', '1'); localStorage.removeItem(PREVIEW_KEY + '_probe'); }
catch { storageAvailable = false; document.getElementById('storage-note').hidden = false; }
const adapter = {
    load() { try { return storageAvailable ? JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}') : memory; } catch { return {}; } },
    save(settings) { if (storageAvailable) localStorage.setItem(PREVIEW_KEY, JSON.stringify(settings)); else memory = settings; },
    connectionName() { return '离线预览中不连接模型。'; },
    onChange(settings) { document.getElementById('preview-visibility').checked = settings.launcherVisible; },
};
const controller = mountPhone({ adapter, styles: PREVIEW_STYLES });
document.getElementById('preview-visibility').checked = controller.getSettings().launcherVisible;
document.getElementById('preview-visibility').addEventListener('change', event => controller.setLauncherVisible(event.target.checked));
document.getElementById('preview-open').addEventListener('click', () => controller.open());
document.getElementById('preview-settings').addEventListener('click', () => controller.openSettings());
document.getElementById('preview-reset').addEventListener('click', () => controller.resetPosition());
controller.open();
'''
script = '\n'.join(chunks) + '\nconst PREVIEW_STYLES = ' + json.dumps((root / 'style.css').read_text(), ensure_ascii=False) + ';\n' + bootstrap
script = script.replace('</script', '<\\/script')
html = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>榴莲手机 · 界面预览</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#efedf4;color:#353244;font:15px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:540px;padding:10vh 40px 40px;margin-left:max(0px,calc((100vw - 1100px)/2))}small{color:#76658b;letter-spacing:3px}h1{font-size:36px;letter-spacing:-1px;line-height:1.3;margin:20px 0}p{color:#716b7c}button{font:inherit;border:1px solid #d4ccde;border-radius:10px;padding:9px 15px;cursor:pointer;color:#514361;background:#ffffffb0}button:hover{background:#fff}.actions{display:flex;gap:10px;flex-wrap:wrap}.card{margin:28px 0;padding:20px;border:1px solid #dad3e2;border-radius:18px;background:#ffffff70}.card label{display:flex;align-items:center;gap:10px;margin:10px 0 18px}.card input{width:18px;height:18px;accent-color:#827096}li{margin:8px 0}footer{font-size:12px;color:#92899e;margin-top:28px}@media(max-width:760px){main{padding:36px 24px;max-width:100%;margin:0}h1{font-size:28px}}
</style></head><body><main><small>POCKET PHONE · 0.10.0</small><h1>榴莲手机，先从这里开始。</h1><p>这是首阶段界面预览。可以打开、收起、拖动入口，调整桌面与设置。App 目前是空页面，不生成剧情内容。</p><div class="actions"><button id="preview-open">打开手机</button><button id="preview-settings">打开设置</button></div><div class="card"><strong>悬浮入口</strong><label><input id="preview-visibility" type="checkbox">显示悬浮入口</label><button id="preview-reset">重置悬浮位置</button><p style="font-size:12px;margin-bottom:0">安装到酒馆后，这组控制位于扩展栏的「榴莲手机」条目中。</p></div><ol><li>检查手机窗口是否挡住操作、字号是否合适。</li><li>在「设置 → App 管理」关闭、重新开启应用。</li><li>修改提示词和重试次数，刷新后检查是否保留。</li></ol><p id="storage-note" hidden>当前打开方式不支持保存预览设置；本次修改只在页面关闭前保留。可换用浏览器打开。</p><footer>预览数据独立于酒馆。本文件无需联网，不请求模型。桌面暂时显示设备时间。</footer></main><script>''' + script + '</script></body></html>'
output = root.parent / 'deliverables' / 'pocket-phone-preview.html'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(html)
print(output)
