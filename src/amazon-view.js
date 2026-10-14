import { shopItems, shopMoney } from './amazon.js?v=0.23.2';
import { dayDate, readStoryClock } from './story-clock.js?v=0.23.2';
import { deliveryStatus } from './delivery.js?v=0.23.2';
const shopEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createAmazonPanel({adapter,getView,redraw,notice}){
    let tab='shop',selected=null,status='',working=false,epoch=0,drafts={};
    const chat=()=>adapter.storyChat?.()||[];
    const disabled=()=>working||getView().busy?' disabled':'';
    const btn=(action,label,id='')=>'<button type="button" class="pp-snap-button" data-shop-action="'+action+'" data-shop-id="'+shopEscape(id)+'"'+disabled()+'>'+shopEscape(label)+'</button>';
    const input=(name,label,value='',type='text')=>'<label class="pp-field"><span>'+label+'</span><input data-shop-field="'+name+'" name="'+name+'" type="'+type+'" value="'+shopEscape(drafts[name]??value)+'"'+(type==='number'?' min="1" max="99"':'')+'></label>';
    const submit=(name,body,label)=>'<form data-shop-form="'+name+'" class="pp-snap-form">'+body+'<button type="submit" class="pp-snap-primary"'+disabled()+'>'+label+'</button></form>';
    const amount=items=>{const sums=Object.create(null);for(const i of items)sums[i.product.currency]=(sums[i.product.currency]||0)+i.quantity*i.product.priceMinor;return Object.entries(sums).map(([c,v])=>shopMoney(v,c)).join(' + ');};
    const itemHTML=i=>'<p class="pp-snap-copy"><strong>'+shopEscape(i.product.brand+' '+i.product.name)+'</strong><br>'+shopEscape(i.variant)+' × '+i.quantity+'<br>'+shopEscape(shopMoney(i.product.priceMinor,i.product.currency))+'</p>';
    function html(){
        const state=getView(),products=shopItems(state,'product'),cart=state.orders?.cart?.items||[];
        const p=products.find(p=>p.id===selected);if(selected&&!p)selected=null;
        let body='';
        if(tab==='shop'&&p){
            body=btn('back','‹ 商品')+'<h3>'+shopEscape(p.brand+' '+p.name)+'</h3><strong>'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong><p class="pp-snap-copy">'+shopEscape(p.description)+'</p>'+
                submit('add',(p.variants.length?'<label class="pp-field"><span>规格</span><select name="variant" data-shop-field="variant">'+p.variants.map(v=>'<option'+((drafts.variant??p.variants[0])===v?' selected':'')+'>'+shopEscape(v)+'</option>').join('')+'</select></label>':'')+input('quantity','数量',1,'number'),'加入购物车')+
                '<h3>买家评价</h3>'+p.reviews.map(r=>'<article class="pp-shop-review"><strong>'+shopEscape(r.name)+' · '+'★'.repeat(r.rating)+'</strong><p class="pp-snap-copy">'+shopEscape(r.text)+'</p></article>').join('');
        }else if(tab==='shop'){
            body=submit('search',input('query','想买什么？',state.orders?.catalog?.query||''),'搜索商品')+products.map(p=>'<article class="pp-shop-product"><small>'+shopEscape(p.brand)+'</small><h3>'+shopEscape(p.name)+'</h3><strong>'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong>'+btn('product','查看商品',p.id)+'</article>').join('');
        }else if(tab==='cart'){
            const clock=readStoryClock(chat());
            body=cart.length?cart.map(i=>'<article class="pp-shop-product">'+itemHTML(i)+btn('remove','移除',i.id)+'</article>').join('')+'<h3>合计 '+shopEscape(amount(cart))+'</h3>'+submit('checkout','<label class="pp-field"><span>收件人</span><select name="recipient" data-shop-field="recipient"><option value="self">我自己</option>'+Object.values(state.contacts||{}).map(c=>'<option value="'+shopEscape(c.id)+'"'+(drafts.recipient===c.id?' selected':'')+'>'+shopEscape(c.targetName||c.name)+'</option>').join('')+'</select></label>'+input('date','下单日期',dayDate(clock.day),'date')+input('time','下单时间',clock.hour!==null?String(Math.floor(clock.hour)).padStart(2,'0')+':'+String(Math.round(clock.hour%1*60)).padStart(2,'0'):'','time'),'确认下单'):'<p class="pp-snap-empty">购物车是空的</p>';
        }else{
            body=shopItems(state,'order').reverse().map(o=>{const delivery=deliveryStatus(o,chat());return '<article class="pp-shop-product"><strong>'+delivery.label+'</strong><p>收件人：'+shopEscape(o.recipient.name)+'</p><small>预计 '+dayDate(o.dueDay)+' 白天送达</small>'+o.items.map(itemHTML).join('')+'<b>合计 '+shopEscape(Object.entries(o.totals).map(([c,v])=>shopMoney(v,c)).join(' + '))+'</b></article>';}).join('')||'<p class="pp-snap-empty">暂无订单</p>';
        }
        return '<div class="pp-snap pp-shop"><header class="pp-snap-top"><b>amazon</b></header><p class="pp-snap-status" role="status">'+shopEscape(working||state.busy?'正在处理…':state.errorKind==='amazon'&&state.error?state.error:status)+'</p>'+body+'<nav class="pp-snap-tabs pp-shop-tabs" aria-label="Amazon 页面">'+[['shop','商品'],['cart','购物车'+(cart.length?' '+cart.length:'')],['orders','订单']].map(([id,label])=>'<button type="button" data-shop-action="tab" data-shop-id="'+id+'" aria-pressed="'+(tab===id)+'">'+label+'</button>').join('')+'</nav></div>';
    }
    async function perform(method,args,message=''){
        if(!adapter.amazon){notice('请在酒馆内使用 Amazon。');return null;}if(working||getView().busy)return null;
        const token=epoch;working=true;redraw();
        try{const r=await adapter.amazon[method](...args);if(token!==epoch)return null;status=r?.ok?message:r?.error||'请重试。';return r;}
        catch(e){if(token===epoch)status=e.message;return null;}finally{working=false;redraw();}
    }
    return {html,reset(){epoch++;tab='shop';selected=null;drafts={};status='';},input(el){drafts[el.dataset.shopField]=el.value;},
        async action(action,id){if(action==='tab'){tab=id;selected=null;status='';redraw();return;}if(action==='product'){selected=id;delete drafts.variant;drafts.quantity=1;redraw();return;}if(action==='back'){selected=null;redraw();return;}if(action==='remove')await perform('remove',[id]);},
        async submit(form){const v=Object.fromEntries(new FormData(form)),kind=form.dataset.shopForm;
            if(kind==='search')await perform('search',[v.query]);
            if(kind==='add')await perform('add',[selected,v.variant,Number(v.quantity)],'已加入购物车');
            if(kind==='checkout'){const r=await perform('checkout',[v.recipient,v.date,v.time],'下单成功');if(r?.ok){tab='orders';delete drafts.date;delete drafts.time;redraw();}}
        },
    };
}
