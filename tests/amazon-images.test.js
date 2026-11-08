import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shopImageKey,shopImageSrc,AMAZON_IMAGE_KEYS} from '../src/amazon-art.js';
import {validateProducts} from '../src/amazon.js';
import {createAmazonPanel} from '../src/amazon-view.js';

const offer = {
    name:'蓝牙降噪耳机',brand:'Audio',luxury:false,description:'轻量无线耳机',
    price:'129.99',currency:'USD',variants:['黑色','米白色'],
    reviews:[{name:'Lynn',rating:5,text:'舒适耐用'}],
};
const originalProduct = () => ({
    id:'p1',type:'product',...offer,priceMinor:12999,
});

test('every Amazon SVG key resolves to a bundled Fluent UI Emoji image',()=>{
    assert.equal(AMAZON_IMAGE_KEYS.length,15);
    for(const key of AMAZON_IMAGE_KEYS){
        const source=readFileSync(new URL(shopImageSrc(key)),'utf8');
        assert.match(source,/^<svg\b/);
        assert.match(source,/viewBox="0 0 32 32"/);
    }
});

test('product image data accepts curated keys, infers legacy products and rejects external image URLs',()=>{
    assert.equal(shopImageKey('headphone','iPhone'),'headphone');
    assert.equal(shopImageKey(undefined,'MacBook 笔记本电脑'),'laptop');
    assert.equal(shopImageKey(undefined,'礼服连衣裙'),'dress');
    assert.equal(shopImageKey(undefined,'没有明确分类的商品'),'package');
    const named=validateProducts({products:[{...offer,image:'headphone'}]},'USD')[0];
    assert.equal(named.image,'headphone');
    assert.equal(named.priceMinor,12999);
    const inferred=validateProducts({products:[{...offer,image:'https://wrong-site.test/something.svg'}]},'USD')[0];
    assert.equal(inferred.image,'headphone');
    assert.match(shopImageSrc('../../untrusted'),/\/amazon-icons\/package\.svg$/);
});

test('Amazon lists, details, cart and orders show local artwork while preserving purchase actions',async()=>{
    const current=originalProduct(),legacy={...current};
    delete legacy.image;
    const item={id:'item1',product:legacy,variant:'黑色',quantity:2};
    const state=()=>({busy:false,orders:{
        p1:current,
        catalog:{type:'catalog',query:'耳机'},
        cart:{type:'cart',items:[item]},
        order1:{id:'order1',type:'order',recipient:{name:'Sam'},items:[item],
            totals:{USD:25998},dueDay:21000},
    }});
    const panel=createAmazonPanel({adapter:{userName:()=> 'Sam',storyChat:()=>[]},
        getView:state,redraw(){},notice(){}});
    let html=panel.html();
    assert.match(html,/pp-shop-art-list/);
    assert.match(html,/\/amazon-icons\/headphone\.svg/);
    assert.match(html,/data-shop-form="search"/);
    assert.match(html,/data-shop-action="product"/);
    await panel.action('product','p1');
    html=panel.html();
    assert.match(html,/pp-shop-detail-visual/);
    assert.match(html,/data-shop-form="add"/);
    assert.match(html,/name="variant"/);
    assert.match(html,/name="quantity"/);
    assert.match(html,/买家评价/);
    await panel.action('tab','cart');
    html=panel.html();
    assert.match(html,/pp-shop-art-inline/);
    assert.match(html,/\/amazon-icons\/headphone\.svg/);
    assert.match(html,/data-shop-action="remove"/);
    assert.match(html,/data-shop-form="checkout"/);
    await panel.action('tab','orders');
    html=panel.html();
    assert.match(html,/pp-shop-order/);
    assert.match(html,/\/amazon-icons\/headphone\.svg/);
});
