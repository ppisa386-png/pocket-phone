import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, clampPosition, LAUNCHER_SIZE, PROMPTS } from '../src/config.js';

test('malformed or old saved settings do not prevent startup', () => {
    for (const value of [null, undefined, [], 'bad', 3]) {
        assert.equal(normalizeSettings(value).launcherVisible, true);
    }
    const config = normalizeSettings({ retries: Infinity, fontSize: -40, phoneWidth: 9999, apps: null, prompts: [], position: { x: 9, y: -3 } });
    assert.equal(config.retries, 2);
    assert.equal(config.fontSize, 14);
    assert.equal(config.phoneWidth, 420);
    assert.deepEqual(config.position, { x: 1, y: 0 });
    assert.equal(config.prompts.phone, PROMPTS.phone.text);
});

test('disabled apps, zero retries and user prompt edits survive settings migration', () => {
    const config = normalizeSettings({ retries: 0, apps: { x: false }, prompts: { phone: '', x: '<script>alert(1)</script>' }, futureField: { keep: true } });
    assert.equal(config.retries, 0);
    assert.equal(config.apps.x, false);
    assert.equal(config.apps.phone, true);
    assert.equal(config.prompts.phone, '');
    assert.equal(config.prompts.x, '<script>alert(1)</script>');
    assert.deepEqual(config.futureField, { keep: true });
    assert.deepEqual(normalizeSettings(config), config);
});

test('master switch defaults on and preserves independent app and launcher preferences',()=>{
    assert.equal(normalizeSettings({}).enabled,true);
    assert.equal(normalizeSettings({enabled:'false'}).enabled,true);
    const settings=normalizeSettings({enabled:false,launcherVisible:true,apps:{x:false},prompts:{phone:'custom'}});
    assert.equal(settings.enabled,false);assert.equal(settings.launcherVisible,true);
    assert.equal(settings.apps.x,false);assert.equal(settings.apps.messages,true);
    assert.equal(normalizeSettings({...settings,enabled:true}).prompts.phone,'custom');
    assert.deepEqual(normalizeSettings(settings),settings);
});

test('launcher stays inside small screens and after orientation changes', () => {
    for (const view of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
        const point = clampPosition({ x: 20000, y: -500 }, view);
        assert.ok(point.x + LAUNCHER_SIZE <= view.width - 8);
        assert.ok(point.y >= 8);
        assert.ok(clampPosition(null, view).y + LAUNCHER_SIZE <= view.height - 8);
    }
});


test('previous proactive defaults migrate without changing custom text or empty preferences',()=>{
 const old={"storyContact": "正文决定实际发生的通信，小手机只保存记录。结合人设、关系、世界观、当前场景和已经发生的手机交流判断联系动机与获取号码的合理途径，不限恋人或既有好友，不要求专门的交换号码情节。日常问候、追求、打听消息、分享或事务都可以，也可以不联系。接听或拒接依正文的扮演规则与当前剧情决定，不凭空替 user 作决定。只记录本次 user 确实发出或收到的短信及拨出或接到的电话，不记录其他人物之间的通信，不重演旧记录、不以记录指令代替正文。", "incomingMessages": "依据角色设定、双方关系、当前剧情和已有通信，自行判断是否主动发短信。可以联系，也可以等待或不联系；不设固定间隔，未回复时是否再次联系由角色当下动机决定。不得替 user 发言或绕过拉黑。消息语言与角色表达习惯遵循酒馆预设。", "incoming": "依据角色性格、双方关系、剧情时间和已有通信决定是否来电。想念、关心、分享生活、异地伴侣的日常联络都是合理动机，不必等危机或新任务；也不因恋人标签强制每次联系。角色必须有已知 user 号码或可用获取途径的依据，可核对正文、人设、当前角色卡及当前聊天的有效记忆。设定中已建立正常电话联络的亲友无需重新交换号码；仅单向知晓、暗恋、匿名关系或知名度不等于已知号码，失联、秘密身份、无法通信等当前设定优先。共友需有依据且确实能提供号码；公开渠道需可访问。不打断面对面交流，不重复正文已发生的联系。", "contactEvent": "依据角色设定、当前剧情与 user 的反应，自行决定是否联系、继续联系、等待或结束。没有固定联系间隔，不预设拒接或沉默后必须停止，也不预设任何性格或分手情节必然导致纠缠。每步仅选择一次来电、一条短信、等待或结束；不能绕过拉黑，不替 user 发言，不预生成一串后续。"};
 const migrated=normalizeSettings({prompts:old});
 for(const id of Object.keys(old)){assert.equal(migrated.prompts[id],PROMPTS[id].text);assert.notEqual(migrated.prompts[id],old[id]);}
 const custom=normalizeSettings({prompts:{incomingMessages:"我的自定义双语规则",incoming:"",storyContact:"我的正文规则"}});
 assert.equal(custom.prompts.incomingMessages,"我的自定义双语规则");assert.equal(custom.prompts.incoming,"");assert.equal(custom.prompts.storyContact,"我的正文规则");
});
