import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings} from '../src/config.js';
import {createKeyStore} from '../src/api.js';
import {createApiPanel} from '../src/api-view.js';
import {createDiagnostics} from '../src/diagnostics.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i],get length(){return data.size;}};};

test('API presets at the same endpoint preserve separate keys, reload, update, switch and delete',async()=>{
 let settings=normalizeSettings({}),fail=false;const local=storage(),keys=createKeyStore(local);
 const panel=()=>createApiPanel({adapter:{keyStore:keys},getSettings:()=>settings,persist:p=>{if(fail)return false;settings=normalizeSettings({...settings,...p});return true;},redraw(){}});
 let p=panel();p.input('mode','independent');p.input('baseUrl','https://service.example/v1');p.input('model','model-a');p.input('key','secret-a');p.input('profileName','A');await p.action('profile-save');const a=settings.apiProfileId;
 p.input('model','model-b');p.input('key','secret-b');p.input('profileName','B');await p.action('profile-save');const b=settings.apiProfileId;
 assert.equal(settings.apiProfiles.length,2);assert.notEqual(a,b);assert.equal(keys.get(settings.api.baseUrl,a),'secret-a');assert.equal(keys.get(settings.api.baseUrl,b),'secret-b');assert.doesNotMatch(JSON.stringify(settings),/secret-[ab]/);
 p.destroy();p=panel();p.html();assert.equal(p.keyValue(),'secret-b');p.input('selectedProfile',a);await p.action('profile-use');assert.equal(settings.api.model,'model-a');assert.equal(p.keyValue(),'secret-a');
 p.input('timeout','120');await p.action('save');assert.equal(settings.apiProfiles.find(v=>v.id===a).api.timeout,120);
 fail=true;p.input('key','failed-key');await p.action('save');assert.equal(keys.get(settings.api.baseUrl,a),'secret-a');fail=false;
 p.input('selectedProfile',b);await p.action('profile-use');await p.action('profile-delete');assert.equal(settings.apiProfileId,'');assert.equal(settings.api.model,'model-b');assert.equal(keys.get(settings.api.baseUrl),'secret-b');assert.equal(keys.get(settings.api.baseUrl,b),'');assert.equal(keys.get(settings.api.baseUrl,a),'secret-a');
});

test('malformed profiles cannot leak secret fields or break settings',()=>{
 const s=normalizeSettings({apiProfileId:'bad',apiProfiles:[null,{id:'valid',name:'Name',key:'secret',api:{key:'secret',model:'okay'}},{id:'valid',name:'Duplicate'},{id:'bad:key',name:'Bad'}]});assert.equal(s.apiProfiles.length,1);assert.equal(s.apiProfileId,'');assert.doesNotMatch(JSON.stringify(s),/secret/);
});

test('diagnostics persist bounded, redacted history and clear it',()=>{
 const local=storage(),keys=createKeyStore(local);keys.set('https://service.example','private-value','profile');
 const options={storage:local,version:'test',getSecrets:()=>keys.secrets()};let d=createDiagnostics(options);
 d.add(new Error('Failed private-value Bearer another-secret api_key=third-secret https://user:pass@a.example/v1?key=fourth-secret'),'API');
 d.add(new Error('Draft unsaved-value'), 'API test',['unsaved-value']);
 assert.doesNotMatch(local.getItem('durian_phone_errors_v1'),/private-value|another-secret|third-secret|fourth-secret|user:pass|unsaved-value/);
 d=createDiagnostics(options);assert.equal(d.list().length,2);assert.match(d.text(),/\[已隐藏\]/);
 for(let i=0;i<110;i++)d.add('failure '+i,'X');assert.equal(d.list().length,100);assert.match(d.list()[0].message,/109/);d.clear();assert.equal(createDiagnostics(options).list().length,0);
 const disabled=createDiagnostics({storage:null});disabled.add('Error');assert.equal(disabled.persistent(),false);assert.equal(disabled.list().length,1);
});
