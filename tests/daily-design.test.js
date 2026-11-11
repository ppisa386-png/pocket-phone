import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDailyPanel } from '../src/daily-view.js';
import { dateDay } from '../src/story-clock.js';

const makeArticle=(id,placement,section)=>({id,type:'article',editionId:'edition-1',placement,section,
    outlet:'洛杉矶时报',headline:'城市公共服务公布新的年度安排 '+id,
    summary:'市政部门公布了新的服务安排，相关计划将分阶段向居民开放。',
    body:'市政部门公布了新的服务安排。\n相关计划将分阶段向居民开放。',
    selected:false});

function panelFor(state,chat=[]){
    return createDailyPanel({adapter:{storyChat:()=>chat},getView:()=>state,redraw(){},notice(){}});
}

test('日报首页采用报头、日期线、头条、双栏报道和简讯版式，同时保留真实编辑字段',()=>{
    const articles=[makeArticle('lead','lead','国际与外交'),makeArticle('feature-a','feature','经济与商业'),
        makeArticle('feature-b','feature','社会新闻'),makeArticle('feature-c','feature','科技与科学'),
        makeArticle('feature-d','feature','体育'),makeArticle('feature-e','feature','环境与自然'),
        makeArticle('brief-a','brief','生活旅游与消费'),makeArticle('brief-b','brief','文化与娱乐'),makeArticle('brief-c','brief','城市建设与交通')];
    const state={daily:{edition:{editionId:'edition-1',day:null,printDate:'2026-11-11',
        publication:'洛杉矶时报',location:'洛杉矶',articleIds:articles.map(a=>a.id)},
        ...Object.fromEntries(articles.map(a=>[a.id,a]))}};
    const html=panelFor(state).html();
    assert.match(html,/pp-daily-masthead-top/);
    assert.match(html,/data-daily-field="publication"/);
    assert.match(html,/data-daily-field="date"/);
    assert.match(html,/data-daily-field="location"/);
    assert.match(html,/2026 \/ 11 \/ 11/);
    assert.match(html,/洛杉矶时报/);
    assert.equal((html.match(/class="pp-daily-article pp-daily-lead/g)||[]).length,1);
    assert.equal((html.match(/class="pp-daily-article pp-daily-feature/g)||[]).length,5);
    assert.equal((html.match(/class="pp-daily-article pp-daily-brief/g)||[]).length,3);
    assert.match(html,/pp-daily-feature-grid/);
    assert.match(html,/pp-daily-brief-heading/);
    assert.match(html,/data-daily-action="update"/);
    assert.match(html,/data-daily-action="archive"/);
});

test('日报历史档案仍只展示真实过期刊期，不生成虚构期号或版号',async()=>{
    const article=makeArticle('lead','lead','国际与外交');
    const state={daily:{edition:{editionId:'edition-1',day:dateDay('2026-11-11'),printDate:'2026-11-11',
        publication:'洛杉矶时报',location:'洛杉矶',articleIds:['lead']},lead:article}};
    const panel=panelFor(state,[{mes:'2026-11-12'}]);
    await panel.action('archive');
    const html=panel.html();
    assert.match(html,/过往报纸夹/);
    assert.match(html,/data-daily-action="archive-edition"/);
    assert.match(html,/洛杉矶时报/);
    assert.match(html,/1 篇报道/);
    assert.doesNotMatch(html,/第 14287 期|A2 版|A3 版/);
});

test('日报视觉样式独立加载并覆盖窄屏单栏',()=>{
    const css=readFileSync(new URL('../style-daily.css',import.meta.url),'utf8');
    const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
    const preview=readFileSync(new URL('../tools/build_preview.mjs',import.meta.url),'utf8');
    assert.match(css,/--pp-daily-paper:#F2F0E9/);
    assert.match(css,/--pp-daily-red:#A33832/);
    assert.match(css,/@media\(max-width:340px\)/);
    assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
    assert.match(index,/style-daily\.css\?v=1\.2\.42/);
    assert.match(preview,/style-daily\.css/);
});
