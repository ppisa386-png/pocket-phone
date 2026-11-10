import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createXPanel} from '../src/x-view.js';

function fixture(){
    const state={busy:false,x:{
        profile:{id:'profile',type:'profile',alias:'Robin',bio:'读书，写字。',requestsOpen:true},
        a:{id:'a',type:'account',name:'Avery',handle:'avery',bio:'Hello!',following:false},
        p:{id:'p',type:'post',author:'a',text:'A short post',metrics:{likes:2,reposts:3,replies:1}},
        c:{id:'c',type:'comment',postId:'p',author:'a',text:'A reply'}
    }};
    const panel=createXPanel({adapter:{userName:()=> 'Robin',storyChat:()=>[]},getView:()=>state,redraw(){},notice(){}});
    return {state,panel};
}
test('X timeline retains its composer and original interaction hooks',()=>{
    const {panel}=fixture(),html=panel.html();
    for(const value of ['pp-x-feed-composer','data-x-form="post"','data-x-field="post"','pp-x-post-avatar','pp-x-reactions'])assert.ok(html.includes(value),value);
    for(const action of ['comments','repost','like','refresh','profile','tab'])assert.match(html,new RegExp('data-x-action="'+action+'"'));
});
test('X separate refresh buttons are scoped to each page and styled as icon controls',async()=>{
 const {panel}=fixture();
 const home=panel.html();assert.match(home,/data-x-action="refresh" aria-label="刷新首页动态与粉丝"/);
 assert.doesNotMatch(home,/data-x-action="refresh-square"|data-x-action="refresh-trends"/);
 await panel.action('tab','search');
 const search=panel.html();assert.match(search,/data-x-action="refresh-trends" aria-label="刷新趋势"/);
 assert.doesNotMatch(search,/data-x-action="refresh-square"|data-x-action="refresh" /);
 await panel.action('tab','square');
 const square=panel.html();assert.match(square,/data-x-action="refresh-square" aria-label="刷新广场"/);
 assert.doesNotMatch(square,/data-x-action="refresh-trends"|data-x-action="refresh" /);
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 assert.match(css,/pp-x-refresh:focus-visible/);
});
test('X refresh actions call only their matching independent service',async()=>{
    const called=[];
    const state={busy:false,x:{profile:{id:'profile',type:'profile',alias:'Robin',bio:''}}};
    const panel=createXPanel({adapter:{
        storyChat:()=>[{mes:'2026-11-10 10:00'}],
        x:{
            refreshPublic:async()=>{called.push('home');return {ok:true,value:{added:2}};},
            refreshTrends:async()=>{called.push('trends');return {ok:true};},
            refresh:async mode=>{called.push(mode);return {ok:true};}
        }
    },getView:()=>state,redraw(){},notice(){}});
    await panel.action('refresh');
    await panel.action('tab','search');
    await panel.action('refresh-trends');
    await panel.action('tab','square');
    await panel.action('refresh-square');
    assert.deepEqual(called,['home','trends','square']);
});

test('X profile retains editable data, audience controls, and account actions',async()=>{
    const {panel}=fixture();
    await panel.action('profile');
    const html=panel.html();
    for(const value of ['pp-x-profile-cover','pp-x-profile-avatar','data-x-followers>','data-x-form="profile"','name="requestsOpen"','data-x-action="reset-followers"'])assert.ok(html.includes(value),value);
    await panel.action('account','a');
    assert.match(panel.html(),/pp-x-account-full/);
    assert.match(panel.html(),/data-x-action="follow"/);
    assert.match(panel.html(),/data-x-action="thread"/);
});
test('X reply detail retains comment author navigation and reply form',async()=>{
    const {panel}=fixture();
    await panel.action('comments','p');
    const html=panel.html();
    for(const value of ['pp-x-comment-row','data-x-action="comment-author"','data-x-action="reply-comment"','data-x-form="comment"','data-press="x-post"','data-press="x-comment"'])assert.ok(html.includes(value),value);
});
test('X theme is scoped and adapts to a narrow phone container',()=>{
    const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
    assert.match(css,/\.pp-phone\[data-active-app="x"\]/);
    assert.match(css,/\.pp-x \.pp-x-feed-composer/);
    assert.match(css,/@container pp-phone \(max-width:330px\)/);
});
