import { shopItems, shopMoney } from './amazon.js?v=1.0.1';
import { dayDate, readStoryClock } from './story-clock.js?v=1.0.1';
import { deliveryStatus } from './delivery.js?v=1.0.1';
import { icon } from './icons.js?v=1.0.1';
const shopEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createAmazonPanel({adapter,getView,redraw,notice}){
    let tab='shop',selected=null,status='',working=false,epoch=0,drafts={};
    const chat=()=>adapter.storyChat?.()||[];
    const disabled=()=>working||getView().busy?' disabled':'';
    const btn=(action,label,id='')=>'<button type="button" class="pp-snap-button" data-shop-action="'+action+'" data-shop-id="'+shopEscape(id)+'"'+disabled()+'>'+shopEscape(label)+'</button>';
    const input=(name,label,value='',type='text')=>'<label class="pp-field"><span>'+label+'</span><input data-shop-field="'+name+'" name="'+name+'" type="'+type+'" value="'+shopEscape(drafts[name]??value)+'"'+(name==='query'?' placeholder="搜索 Amazon 商品"':'')+(type==='number'?' min="1" max="99"':'')+'></label>';
    const submit=(name,body,label)=>'<form data-shop-form="'+name+'" class="pp-snap-form">'+body+'<button type="submit" class="pp-snap-primary"'+disabled()+'>'+label+'</button></form>';
    const amount=items=>{const sums=Object.create(null);for(const i of items)sums[i.product.currency]=(sums[i.product.currency]||0)+i.quantity*i.product.priceMinor;return Object.entries(sums).map(([c,v])=>shopMoney(v,c)).join(' + ');};
    const parcel=()=>'<span class="pp-shop-parcel" aria-hidden="true">'+icon('parcel')+'</span>';
    const itemHTML=i=>'<div class="pp-shop-item">'+parcel()+'<div><strong>'+shopEscape([i.product.brand,i.product.name].filter(Boolean).join(' '))+'</strong><p>'+shopEscape(i.variant)+(i.variant?' · ':'')+'数量 '+i.quantity+'</p><b class="pp-shop-price">'+shopEscape(shopMoney(i.product.priceMinor,i.product.currency))+'</b></div></div>';
    const empty=(symbol,title,text)=>'<div class="pp-shop-empty">'+icon(symbol)+'<h3>'+title+'</h3><p>'+text+'</p></div>';
    function html(){
        const state=getView(),products=shopItems(state,'product'),cart=state.orders?.cart?.items||[];
        const p=products.find(p=>p.id===selected);if(selected&&!p)selected=null;
        let body='';
        if(tab==='shop'&&p){
            body='<section class="pp-shop-detail">'+btn('back','‹ 商品')+'<small class="pp-shop-brand">'+shopEscape(p.brand)+'</small><h3>'+shopEscape(p.name)+'</h3><strong class="pp-shop-price">'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong><p class="pp-snap-copy">'+shopEscape(p.description)+'</p>'+
                submit('add',(p.variants.length?'<label class="pp-field"><span>规格</span><select name="variant" data-shop-field="variant">'+p.variants.map(v=>'<option'+((drafts.variant??p.variants[0])===v?' selected':'')+'>'+shopEscape(v)+'</option>').join('')+'</select></label>':'')+input('quantity','数量',1,'number'),'加入购物车')+'</section>'+
                '<section class="pp-shop-reviews"><h3>买家评价</h3>'+p.reviews.map(r=>'<article class="pp-shop-review"><header><span class="pp-shop-review-avatar" aria-hidden="true">'+shopEscape(Array.from(r.name||'客')[0])+'</span><strong>'+shopEscape(r.name)+'</strong></header><span class="pp-shop-stars" aria-label="'+r.rating+' 星，满分 5 星">'+'★'.repeat(r.rating)+'<span aria-hidden="true">'+'☆'.repeat(5-r.rating)+'</span></span><p class="pp-snap-copy">'+shopEscape(r.text)+'</p></article>').join('')+(!p.reviews.length?'<p class="pp-snap-empty">暂无评价</p>':'')+'</section>';
        }else if(tab==='shop'){
            body='<div class="pp-shop-search">'+submit('search',input('query','搜索商品',state.orders?.catalog?.query||''),'<span class="pp-shop-sr">搜索商品</span>'+icon('search'))+'</div>'+
                (products.length?'<h3 class="pp-shop-heading">商品 <span>'+products.length+' 件</span></h3><div class="pp-shop-results">'+products.map(p=>'<article class="pp-shop-product">'+parcel()+'<div class="pp-shop-product-info"><small class="pp-shop-brand">'+shopEscape(p.brand)+'</small><h3>'+shopEscape(p.name)+'</h3><strong class="pp-shop-price">'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong>'+btn('product','查看商品',p.id)+'</div></article>').join('')+'</div>':empty('amazon',state.orders?.catalog?'未找到商品':'想买点什么？','搜索商品名称，或告诉我你的购物需求。'));
        }else if(tab==='cart'){
            const clock=readStoryClock(chat());
            body='<h3 class="pp-shop-heading">购物车'+(cart.length?' <span>'+cart.reduce((sum,i)=>sum+i.quantity,0)+' 件商品</span>':'')+'</h3>'+
                (cart.length?cart.map(i=>'<article class="pp-shop-cart-item">'+itemHTML(i)+btn('remove','移除',i.id)+'</article>').join('')+'<section class="pp-shop-checkout"><h3>合计 <b class="pp-shop-price">'+shopEscape(amount(cart))+'</b></h3>'+submit('checkout','<label class="pp-field"><span>收件人</span><select name="recipient" data-shop-field="recipient"><option value="self">我自己</option>'+Object.values(state.contacts||{}).map(c=>'<option value="'+shopEscape(c.id)+'"'+(drafts.recipient===c.id?' selected':'')+'>'+shopEscape(c.targetName||c.name)+'</option>').join('')+'</select></label><div class="pp-shop-date-fields">'+input('date','下单日期',dayDate(clock.day),'date')+input('time','下单时间',clock.hour!==null?String(Math.floor(clock.hour)).padStart(2,'0')+':'+String(Math.round(clock.hour%1*60)).padStart(2,'0'):'','time')+'</div>','确认下单')+'</section>':empty('cart','购物车是空的','挑选喜欢的商品，加入购物车。'));
        }else{
            body='<h3 class="pp-shop-heading">我的订单</h3>'+(shopItems(state,'order').reverse().map(o=>{const delivery=deliveryStatus(o,chat());return '<article class="pp-shop-order"><header><strong>'+icon('parcel')+shopEscape(delivery.label)+'</strong><small>预计 '+dayDate(o.dueDay)+' 白天送达</small></header><div class="pp-shop-order-body"><p>收件人：'+shopEscape(o.recipient.name)+'</p>'+o.items.map(itemHTML).join('')+'<p class="pp-shop-order-total">合计 <b>'+shopEscape(Object.entries(o.totals).map(([c,v])=>shopMoney(v,c)).join(' + '))+'</b></p></div></article>';}).join('')||empty('parcel','暂无订单','下单后，可以在这里查看配送进度。'));
        }
        return '<div class="pp-snap pp-shop"><header class="pp-shop-masthead"><b>amazon<span aria-hidden="true"></span></b><span>购物</span></header><div class="pp-shop-body" data-shop-page="'+shopEscape(tab+':'+(selected||''))+'"><p class="pp-snap-status" role="status">'+shopEscape(working||state.busy?'正在处理…':state.errorKind==='amazon'&&state.error?state.error:status)+'</p>'+body+'</div><nav class="pp-snap-tabs pp-shop-tabs" aria-label="Amazon 页面">'+[['shop','商品','amazon'],['cart','购物车','cart'],['orders','订单','parcel']].map(([id,label,symbol])=>'<button type="button" data-shop-action="tab" data-shop-id="'+id+'" aria-pressed="'+(tab===id)+'" aria-label="'+label+(id==='cart'&&cart.length?' '+cart.length:'')+'"><span class="pp-shop-tab-icon">'+icon(symbol)+(id==='cart'&&cart.length?'<b aria-hidden="true">'+cart.length+'</b>':'')+'</span><span>'+label+'</span></button>').join('')+'</nav></div>';
    }
    async function perform(method,args,message=''){
        if(!adapter.amazon){notice('请在酒馆内使用 Amazon。');return null;}if(working||getView().busy)return null;
        const token=epoch;working=true;redraw();
        try{const r=await adapter.amazon[method](...args);if(token!==epoch)return null;status=r?.ok?message:r?.error||'请重试。';return r;}
        catch(e){if(token===epoch)status=e.message;return null;}finally{working=false;redraw();}
    }
    return {html,back(){if(tab==='shop'&&selected){selected=null;redraw();return true;}return false;},reset(){epoch++;tab='shop';selected=null;drafts={};status='';},input(el){drafts[el.dataset.shopField]=el.value;},
        async action(action,id){if(action==='tab'){tab=id;selected=null;status='';redraw();return;}if(action==='product'){selected=id;delete drafts.variant;drafts.quantity=1;redraw();return;}if(action==='back'){selected=null;redraw();return;}if(action==='remove')await perform('remove',[id]);},
        async submit(form){const v=Object.fromEntries(new FormData(form)),kind=form.dataset.shopForm;
            if(kind==='search')await perform('search',[v.query]);
            if(kind==='add')await perform('add',[selected,v.variant,Number(v.quantity)],'已加入购物车');
            if(kind==='checkout'){const r=await perform('checkout',[v.recipient,v.date,v.time],'下单成功');if(r?.ok){tab='orders';delete drafts.date;delete drafts.time;redraw();}}
        },
    };
}
