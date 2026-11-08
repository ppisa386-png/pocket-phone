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
