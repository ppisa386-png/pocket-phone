import test from 'node:test';
import assert from 'node:assert/strict';

import {normalizeSettings} from '../src/config.js';
test('old built-in incoming prompt upgrades while user edits remain intact',()=>{
 const old='只在剧情中有合理动机且角色有可用途径取得 user 号码时发起来电。必须核对正文依据，不能因为 user 知名就凭空知道号码，不能把 user 单方面知道角色号码当成双方交换。共友需要明确存在且确实能提供号码；公开渠道需要正文确认号码可被访问。不强行制造来电，不重复已在正文中完成的电话。';
 assert.match(normalizeSettings({prompts:{incoming:old}}).prompts.incoming,/分享.*适时联络/);
 assert.equal(normalizeSettings({prompts:{incoming:'我的自定义规则'}}).prompts.incoming,'我的自定义规则');
});
