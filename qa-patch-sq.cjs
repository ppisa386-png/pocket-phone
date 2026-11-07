const fs = require('fs');

// ---------- x-fixtures.js: extend names, default count 10 ----------
let fx = fs.readFileSync('tests/x-fixtures.js', 'utf8');
fx = fx.replace("export function worldTopics(first=[],count=8) {", "export function worldTopics(first=[],count=10) {");
fx = fx.replace("const names=['夜市新摊位','周末球赛','校园艺术节','本地乐队新专辑','城市步道开放','春季读书会','电影节片单','公交线路调整','社区摄影展','创作者交流会'];",
"const names=['夜市新摊位','周末球赛','校园艺术节','本地乐队新专辑','城市步道开放','春季读书会','电影节片单','公交线路调整','社区摄影展','创作者交流会','老城路灯改造','河畔马拉松','博物馆特展','夜航航线开通','社区植物园'];");
fs.writeFileSync('tests/x-fixtures.js', fx);
console.log('x-fixtures patched');

// ---------- square.test.js ----------
let sq = fs.readFileSync('tests/square.test.js', 'utf8');
sq = sq.replace("const row=(text='The park is quiet.')=>({name:'路人',handle:'local',text,publicBasis:background});",
"const row=(text='The park is quiet.')=>({name:'路人',handle:'local',text,publicBasis:background});\nconst squareRows=(n,offset=0)=>Array.from({length:n},(_,i)=>({name:'路人'+(offset+i),handle:'local'+(offset+i),text:'Street note '+(offset+i)+'.',publicBasis:background}));");
sq = sq.replace("const bus=new EventEmitter();let calls=0,response={posts:[row()]},prompt='';",
"const bus=new EventEmitter();let calls=0,response={posts:[...squareRows(9),row()]},prompt='';");
sq = sq.replace("  f.reply({posts:[row('The lake is quiet.')]});ok(await f.x.refresh('square'));",
"  f.reply({posts:[...squareRows(9,10),row('The lake is quiet.')]});ok(await f.x.refresh('square'));");
fs.writeFileSync('tests/square.test.js', sq);
console.log('square.test.js patched');

// ---------- x.test.js ----------
let t = fs.readFileSync('tests/x.test.js', 'utf8');
const subs = [
  // helper after setup block
  [`const ok=r=>assert.equal(r?.ok,true,r?.error);`,
   `const ok=r=>assert.equal(r?.ok,true,r?.error);\nconst squareRows=(n,offset=0)=>Array.from({length:n},(_,i)=>({name:'路人'+(offset+i),handle:'local'+(offset+i),text:'街坊动态 '+(offset+i)+' 号。',publicBasis:{access:'background',summary:'Ordinary local life',involvesCharacters:false}}));`],
  // comments test: crowd-only square now needs ten posts
  [`  f.reply({posts:[]});ok(await f.x.refresh('square'));assert.equal(calls,1,'crowd-only square never requests actors private state');`,
   `  f.reply({posts:squareRows(10)});ok(await f.x.refresh('square'));assert.equal(calls,1,'crowd-only square never requests actors private state');`],
  // square refresh needs no following
  [`  f.reply({posts:[{name:'Alex',handle:'alex_new',text:'Not a square author'},
    {name:'alex',handle:'a2',text:'Still the character'},
    {name:'Juniper',handle:'juniper_walks',text:'The park is lovely today.',metrics:{likes:12,reposts:2,replies:6},publicBasis:{access:'background',summary:'Ordinary local park visitor',involvesCharacters:false},
      comments:[{key:'one',name:'Rowan',handle:'rowan',text:'How crowded is it?'},{key:'two',isAuthor:true,replyTo:'one',text:'Quiet by the lake.'}]}]});
  ok(await f.x.refresh('square'));assert.equal(f.count(),before+1);
  const posts=xItems(f.state(),'post');assert.equal(posts.length,1);assert.equal(posts[0].feed,'square');`,
   `  f.reply({posts:[{name:'Alex',handle:'alex_new',text:'Not a square author'},
    {name:'alex',handle:'a2',text:'Still the character'},
    {name:'Juniper',handle:'juniper_walks',text:'The park is lovely today.',metrics:{likes:12,reposts:2,replies:6},publicBasis:{access:'background',summary:'Ordinary local park visitor',involvesCharacters:false},
      comments:[{key:'one',name:'Rowan',handle:'rowan',text:'How crowded is it?'},{key:'two',isAuthor:true,replyTo:'one',text:'Quiet by the lake.'}]},...squareRows(9,100)]});
  ok(await f.x.refresh('square'));assert.equal(f.count(),before+1);
  const posts=xItems(f.state(),'post');assert.equal(posts.length,10);assert.ok(posts[0].feed==='square');`],
  // square contents and engagement roll back
  [`  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}}]});ok(await f.x.refresh('square'));`,
   `  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}},...squareRows(9,50)]});ok(await f.x.refresh('square'));`],
  // reposted posts appear on profile
  [`  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'My favorite park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false}}]});ok(await f.x.refresh('square'));`,
   `  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'My favorite park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false}},...squareRows(9,60)]});ok(await f.x.refresh('square'));`],
  // style instructions
  [` f.reply({posts:[{name:'Rowan',handle:'r1',text:'nice park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact:{...impact,significant:false}},{name:'Ivy',handle:'i1',text:'reviews are split',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact}]});ok(await f.x.refresh('square'));`,
   `  f.reply({posts:[{name:'Rowan',handle:'r1',text:'nice park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact:{...impact,significant:false}},{name:'Ivy',handle:'i1',text:'reviews are split',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact},...squareRows(8,70)]});ok(await f.x.refresh('square'));`],
  // expired selected posts fixture
  [`  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}}]});ok(await f.x.refresh('square'));const p=xItems(f.state(),'post').find(p=>p.feed==='square');`,
   `  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}},...squareRows(9,80)]});ok(await f.x.refresh('square'));const p=xItems(f.state(),'post').find(p=>p.feed==='square');`],
  // following/square limits rewrite
  [`test('following and square keep zero-to-five limits and their author restrictions',async()=>{
 const f=setup();
 try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[]});ok(await f.x.refresh(true));ok(await f.x.refresh('square'));
  f.reply({posts:Array.from({length:5},(_,i)=>({accountId:id,text:'Followed post '+i}))});ok(await f.x.refresh(true));
  assert.equal(xItems(f.state(),'post').length,5);
  f.reply({posts:feedResult().posts});assert.equal((await f.x.refresh(true)).ok,false);assert.equal((await f.x.refresh('square')).ok,false);
  f.reply({posts:[{name:'街区店铺',handle:'square_shop',text:'今天店里有新品。',publicBasis:{access:'background',summary:'日常街区生活',involvesCharacters:false}}]});ok(await f.x.refresh('square'));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='square').length,1);
 }finally{f.close();}
});`,
   `test('following keeps zero-to-five posts while the square requires ten to fifteen',async()=>{
 const f=setup();
 try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[]});ok(await f.x.refresh(true));
  f.reply({posts:squareRows(10)});ok(await f.x.refresh('square'));
  f.reply({posts:Array.from({length:5},(_,i)=>({accountId:id,text:'Followed post '+i}))});ok(await f.x.refresh(true));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='square').length,10);
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='home').length,5);
  f.reply({posts:feedResult().posts});assert.equal((await f.x.refresh(true)).ok,false);assert.equal((await f.x.refresh('square')).ok,false);
  f.reply({posts:[{name:'街区店铺',handle:'square_shop',text:'今天店里有新品。',publicBasis:{access:'background',summary:'日常街区生活',involvesCharacters:false}}]});
  const short=await f.x.refresh('square');assert.equal(short.ok,false);assert.match(short.error,/广场刷新需要 10～15 条/);
  f.reply({posts:squareRows(10,20)});ok(await f.x.refresh('square'));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='square').length,20);
 }finally{f.close();}
});`],
  // validateTrends boundary: 9 too few, 16 too many, duplicate title still invalid
  [` for(const topics of [worldTopics([],7),[...worldTopics([],10),{title:'Another',summary:'Other',sourcePostIds:[]}],[...worldTopics().slice(0,7),{...worldTopics()[0],title:'#'+worldTopics()[0].title}]]){
  assert.throws(()=>validateTrends({topics,evaluations:[]},[]));
 }`,
   ` for(const topics of [worldTopics([],9),[...worldTopics([],15),{title:'Another',summary:'Other',sourcePostIds:[]}],[...worldTopics().slice(0,7),{...worldTopics()[0],title:'#'+worldTopics()[0].title}]]){
  assert.throws(()=>validateTrends({topics,evaluations:[]},[]));
 }`],
  // count loop 8/10 → 10/15
  [` for(const count of [8,10]){`,
   ` for(const count of [10,15]){`],
  // combined refresh: square reply needs ten posts
  [`   if(quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:[notice,{name:'Alex',handle:'alex',authorKind:'public',text:'错误分区',publicBasis:notice.publicBasis}]});`,
   `   if(quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:[notice,{name:'Alex',handle:'alex',authorKind:'public',text:'错误分区',publicBasis:notice.publicBasis},...Array.from({length:9},(_,i)=>({name:'路人'+i,handle:'crowd'+i,text:'街区动态 '+i+'。',publicBasis:notice.publicBasis}))]});`],
  // home provenance test: square reply needs ten posts
  [`  f.reply({posts:[{...org,publicBasis},{name:'慢走',handle:'walking',authorKind:'public',text:'雨后散步。',publicBasis},
   {...npc,authorKind:'public',publicBasis},{name:'KPL 赛事速报',handle:'kpl',authorKind:'organization',text:'本周常规赛赛程。',publicBasis}]});
  ok(await f.x.refresh('square'));const square=xItems(f.state(),'post').filter(p=>p.feed==='square');assert.equal(square.length,3);`,
   `  f.reply({posts:[{...org,publicBasis},{name:'慢走',handle:'walking',authorKind:'public',text:'雨后散步。',publicBasis},
   {...npc,authorKind:'public',publicBasis},{name:'KPL 赛事速报',handle:'kpl',authorKind:'organization',text:'本周常规赛赛程。',publicBasis},...squareRows(6,200)]});
  ok(await f.x.refresh('square'));const square=xItems(f.state(),'post').filter(p=>p.feed==='square');assert.equal(square.length,10);`],
  // combined test title: eight → ten world trends
  [`test('combined refresh saves full recommendations and eight world trends, locks and rolls back atomically',async()=>{`,
   `test('combined refresh saves full recommendations and ten world trends, locks and rolls back atomically',async()=>{`],
  // trend acceptance title
  [`test('trends accept eight to ten unique topics without counts or reasons and preserve model order',async()=>{`,
   `test('trends accept ten to fifteen unique topics without counts or reasons and preserve model order',async()=>{`],
];
for (const [from, to] of subs) {
  if (!t.includes(from)) { console.error('NOT FOUND in x.test.js: ' + from.slice(0, 70)); process.exit(1); }
  t = t.replace(from, to);
}
// New tests appended at end.
t += `

// ---- Post deletion and trend injection (1.1.29) ----

test('deleting a post removes it with its comments and influence, other posts and accounts stay, rollback restores everything',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,text:'The park post',comments:[{key:'a',name:'Bea',handle:'bea',text:'A friend remark'}]},...squareRows(10,300)]});
  ok(await f.x.refresh(true));
  const homePost=xItems(f.state(),'post').find(p=>p.text==='The park post');
  ok(await f.x.react(homePost.id,'liked'));
  const before=xItems(f.state(),'post').length,commentsBefore=xItems(f.state(),'comment').length;
  assert.ok(commentsBefore>=1);
  const result=await f.x.deletePost(homePost.id);ok(result);
  assert.equal(f.state().x[homePost.id],undefined);
  assert.equal(xItems(f.state(),'post').length,before-1);
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId===homePost.id).length,0);
  assert.equal(f.state().x['alex']?.type,'account','accounts are not deleted');
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(xItems(f.state(),'post').length,before,'rollback restores the deleted post');
 }finally{f.close();}
});

test('square and user posts can be deleted the same way and trend injection toggles persist and roll back',async()=>{
 const f=setup();try{
  f.reply({posts:[...squareRows(10)]});ok(await f.x.refresh('square'));
  const squarePost=xItems(f.state(),'post').at(-1);
  ok(await f.x.deletePost(squarePost.id));
  assert.equal(f.state().x[squarePost.id],undefined);
  ok(await f.x.publish('My own post'));
  const mine=xItems(f.state(),'post').find(p=>p.author==='user');
  ok(await f.x.comment(mine.id,'A comment on mine'));
  ok(await f.x.deletePost(mine.id));
  assert.equal(f.state().x[mine.id],undefined);
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId===mine.id).length,0);
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:worldTopics([{title:'注入测试话题',summary:'A trend used for injection',sourcePostIds:[]}]),evaluations:[{postId:xItems(f.state(),'post')[0]?.id||'none',eligible:false}]});
   return JSON.stringify({posts:[]});
  });
  ok(await f.x.refreshTrends());
  const edition=f.state().x['trend-edition'];
  assert.equal(edition.topics[0].injected,undefined);
  ok(await f.x.toggleTrendInjection(0));
  let topics=(f.state().x['trend-edition']).topics;
  assert.equal(topics[0].injected,true);
  const {buildOpinionPrompt}=await import('../src/x-opinion.js');
  const prompt=buildOpinionPrompt(f.state(),[{mes:'2026-01-01'}],'');
  assert.match(prompt,/注入测试话题/);
  ok(await f.x.toggleTrendInjection(0));
  assert.equal((f.state().x['trend-edition']).topics[0].injected,false);
  assert.doesNotMatch(buildOpinionPrompt(f.state(),[{mes:'2026-01-01'}],''),/注入测试话题/);
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
 }finally{f.close();}
});
`;
fs.writeFileSync('tests/x.test.js', t);
console.log('x.test.js patched: ' + subs.length);
