import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createFoodPanel } from '../src/food-view.js';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('../style-food.css', import.meta.url), 'utf8');
const asset = name => existsSync(new URL('assets/food/illustrations/' + name + '.svg', root));

test('Fresh Bite stylesheet keeps the app independent of shell themes and preserves menu scroll and dock', () => {
  assert.match(css, /\.pp-food\{/);
  for (const color of ['#FFFDFB','#232629','#EF664B','#FFBF66','#3C897B']) assert.ok(css.includes(color), color);
  assert.match(css, /\.pp-food-menu\{[^}]*overflow-y:auto/);
  assert.match(css, /\.pp-food-bar\{min-height:56px/);
  assert.match(css, /\.pp-food-hero\{[^}]*flex:0 0 124px/);
  for (const name of ['ramen','hamburger','shortcake','salad','bento','curry','plate','coffee','shrimp','sushi','spaghetti','pizza']) assert.ok(asset(name), name);
  assert.ok(existsSync(new URL('../assets/food/LICENSE-fluentui-emoji.txt', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/food/LICENSE-twemoji-graphics.txt', import.meta.url)));
});

test('real home, menu, and order views use illustrations without introducing sample ratings or delivery charges', async () => {
  const menu = [
    {id:'dish:1',name:'日式豚骨拉面',category:'主食',priceMinor:3600,description:'浓郁豚骨汤底'},
    {id:'dish:2',name:'芝士汉堡',category:'小吃',priceMinor:2500},
    {id:'dish:3',name:'咖喱牛肉饭',category:'主食',priceMinor:3500},
    {id:'dish:4',name:'无名创意料理',category:'主食',priceMinor:2000}
  ];
  const shop = {id:'shop:1',type:'foodShop',name:'和风食堂',cuisine:'日式料理',currency:'CNY',menu};
  const order = {id:'order:1',type:'foodOrder',shopName:'和风食堂',createdDay:1,createdHour:12,
    recipient:{name:'Sam'},paymentMethod:'npc',payerName:'Alex',
    items:[{name:'芝士汉堡',quantity:1,priceMinor:2500,currency:'CNY'}],totals:{CNY:2500}};
  const adapter = {userName:()=> 'Sam', storyChat:()=>[],food:{}};
  const state = () => ({busy:false,orders:{[shop.id]:shop,[order.id]:order}});
  const panel = createFoodPanel({adapter,getView:state,redraw(){},notice(){},assetBase:'https://local/assets/food/'});
  const home = panel.html();
  assert.match(home,/pp-food-hero-art/);
  assert.match(home,/illustrations\/ramen\.svg/);
  assert.doesNotMatch(home,/food\.jpg|menu-[1-6]\.png|评分|配送费/);
  await panel.action('shop',shop.id);
  const store = panel.html();
  for (const name of ['ramen','hamburger','curry','plate']) assert.match(store,new RegExp('illustrations/'+name+'\\.svg'));
  assert.match(store,/data-food-action="buy"/);
  assert.match(store,/pp-food-category-rail/);
  await panel.action('tab','orders');
  const orders = panel.html();
  assert.match(orders,/和风食堂/);
  assert.match(orders,/由 Alex 代付/);
  assert.match(orders,/实付金额/);
  assert.match(orders,/illustrations\/hamburger\.svg/);
});
