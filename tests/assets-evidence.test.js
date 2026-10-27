import test from 'node:test';
import assert from 'node:assert/strict';
import { financialEvidenceMatches } from '../src/assets-policy.js';
import { storyAnnotations } from '../src/story-phone.js';

const first='她挑好了红宝石色高定晚礼服与金色手拿包';
const last='他刷卡付账说：“这枚钻戒送给你，我们现在就戴出去。”';
const prose=first+'。店员取来鞋盒，他们又选了一枚钻戒。'+last;
test('financial evidence accepts ordered excerpts and presentation-only differences',()=>{
 assert.equal(financialEvidenceMatches(prose,first+'……'+last),true);
 assert.equal(financialEvidenceMatches('<p>'+last+'</p>',last.replace(/[“”]/g,'"')),true);
 assert.equal(financialEvidenceMatches(prose,first),true);
});
test('financial excerpt matching rejects invented, reordered, tiny and missing fragments',()=>{
 for(const evidence of [last+'……'+first,first+'……他送给她一艘价值两百万美元的游艇','她挑……送给你',first+'……','……'+last,'买了一栋房子'])assert.equal(financialEvidenceMatches(prose,evidence),false,evidence);
});
test('only financial annotations gain excerpt compatibility; comments cannot evidence themselves',()=>{
 const row={kind:'asset',name:'礼物',category:'luxury',evidence:first+'……'+last};
 const mes=prose+'<!--durian-money:'+JSON.stringify(row)+'--><!--durian-contact:'+JSON.stringify(row)+'-->';
 assert.equal(storyAnnotations({mes},'durian-money').length,1);
 assert.equal(storyAnnotations({mes},'durian-contact').length,0);
 assert.equal(storyAnnotations({mes:mes.slice(prose.length)},'durian-money').length,0);
 assert.equal(storyAnnotations({mes,is_user:true},'durian-money').length,0);
 assert.equal(storyAnnotations({mes:prose+'<!--durian-money:{broken}-->'},'durian-money').length,0);
});
