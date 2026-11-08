import { foodItems } from './food.js?v=1.2';
import { formatMoney } from './currency.js?v=1.2';
import { dayDate } from './story-clock.js?v=1.2';
import { foodDeliveryStatus } from './delivery.js?v=1.2';
import { icon } from './icons.js?v=1.2';
const foodEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const foodMoney=(minor,currency)=>formatMoney(minor,currency);
const clockText=order=>{const hour=order.createdHour;const time=Number.isFinite(hour)?String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round(hour%1*60)).padStart(2,'0'):'—';return dayDate(order.createdDay)+' '+time;};
export function createFoodPanel({adapter,getView,redraw,notice}){
    let tab='home',selectedShop=null,status='',working=false,epoch=0,drafts={},buy=null;
    const chat=()=>adapter.storyChat?.()||[];
    const disabled=()=>working||getView().busy?' disabled':'';
    const empty=(symbol,title,text)=>'<div class="pp-food-empty">'+icon(symbol)+'<h3>'+title+'</h3><p>'+text+'</p></div>';
    const bubble=(label,inner)=>'<div class="pp-shop-bubble" role="dialog" aria-label="'+label+'">'+inner+'<span class="pp-shop-bubble-tail" aria-hidden="true"></span></div>';
    const bubbleOption=(action,id,title,note='')=>'<button type="button" class="pp-shop-bubble-option" data-food-action="'+action+'" data-food-id="'+foodEscape(id)+'"'+disabled()+'><b>'+foodEscape(title)+'</b>'+(note?'<small>'+foodEscape(note)+'</small>':'')+'</button>';
    const cart=state=>state.orders?.foodCart?.items||[];
    const lineOf=(state,dishId)=>cart(state).find(i=>i.dishId===dishId);
    const shopLines=(state,shopId)=>cart(state).filter(i=>i.shopId===shopId);
    const linesTotal=lines=>{const sums=Object.create(null);for(const i of lines)sums[i.currency]=(sums[i.currency]||0)+i.quantity*i.priceMinor;return Object.entries(sums).map(([c,v])=>foodMoney(v,c)).join(' + ');};
    function buyBubble(state){
        if(!buy)return '';
        const cancel='<button type="button" class="pp-shop-bubble-quiet" data-food-action="gift-cancel"'+disabled()+'>取消</button>';
        const hint=buy.hint?'<p class="pp-shop-bubble-hint">'+foodEscape(buy.hint)+'</p>':'';
        if(buy.step==='target')return bubble('选择收件人','<p class="pp-shop-bubble-title">这份外卖送给谁？</p><div class="pp-shop-bubble-options">'+bubbleOption('gift-self','self','送到这里来','收件人是 '+String(adapter.userName?.()||'user'))+bubbleOption('gift-other','','点给别人吃','输入名字就可以，不用电话号码')+'</div>'+hint+cancel);
        return bubble('点给别人吃','<p class="pp-shop-bubble-title">点给别人吃</p><form data-food-form="gift-name" class="pp-shop-bubble-form">'+hint+'<label class="pp-field"><span>收件人名字</span><input data-food-field="foodName" name="foodName" type="text" placeholder="姓、名、昵称都可以" value="'+foodEscape(drafts.foodName??'')+'"'+disabled()+'></label><div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-food-action="gift-back"'+disabled()+'>上一步</button><button type="submit" class="pp-shop-bubble-confirm"'+disabled()+'>确认下单</button></div></form>'+cancel);
    }
    function shopPage(state){
        const shop=state.orders[selectedShop];
        if(!shop||shop.type!=='foodShop'){selectedShop=null;return '';}
        const categories=[];
        for(const dish of shop.menu){const last=categories.at(-1);if(last?.name===dish.category)last.dishes.push(dish);else categories.push({name:dish.category,dishes:[dish]});}
        const lines=shopLines(state,shop.id);
        const stepper=dish=>{
            const line=lineOf(state,dish.id);
            return line
                ?'<div class="pp-food-step"><button type="button" class="pp-food-step-btn" data-food-action="dec" data-food-id="'+foodEscape(dish.id)+'" aria-label="减少 '+foodEscape(dish.name)+' 数量"'+disabled()+'>−</button><b aria-label="已选 '+line.quantity+' 份">'+line.quantity+'</b><button type="button" class="pp-food-step-btn" data-food-action="inc" data-food-id="'+foodEscape(dish.id)+'" aria-label="增加 '+foodEscape(dish.name)+' 数量"'+disabled()+'>+</button></div>'
                :'<button type="button" class="pp-food-add" data-food-action="inc" data-food-id="'+foodEscape(dish.id)+'" aria-label="加一份 '+foodEscape(dish.name)+'"'+disabled()+'>选</button>';
        };
        return '<section class="pp-food-shoppage"><div class="pp-food-shophead"><button type="button" class="pp-food-back" data-food-action="back"'+disabled()+'>‹ 返回</button><div class="pp-food-shopmeta"><h3>'+foodEscape(shop.name)+'</h3><small>'+foodEscape([shop.cuisine,shop.description].filter(Boolean).join(' · '))+'</small></div></div>'+
            '<div class="pp-food-menu" data-food-menu="shop:'+foodEscape(shop.id)+'">'+categories.map(cat=>'<h4 class="pp-food-cat">'+foodEscape(cat.name)+'</h4>'+cat.dishes.map(dish=>'<div class="pp-food-dish"><div class="pp-food-dish-info"><strong>'+foodEscape(dish.name)+'</strong>'+(dish.description?'<p>'+foodEscape(dish.description)+'</p>':'')+'<b class="pp-food-price">'+foodEscape(foodMoney(dish.priceMinor,shop.currency))+'</b></div>'+stepper(dish)+'</div>').join('')).join('')+'</div>'+
            buyBubble(state)+
            '<div class="pp-food-bar"><div class="pp-food-bar-total"><small>合计</small><b>'+(lines.length?foodEscape(linesTotal(lines)):'—')+'</b></div><button type="button" class="pp-food-buy" data-food-action="buy"'+(lines.length?disabled():' disabled')+'>购买</button></div></section>';
    }
    function html(){
        const state=getView(),shops=foodItems(state,'foodShop');
        if(selectedShop&&!shops.some(s=>s.id===selectedShop))selectedShop=null;
        let body='';
        if(tab==='home'&&selectedShop)body=shopPage(state);
        else if(tab==='home'){
            body='<div class="pp-food-search">'+submit('search','<label class="pp-field"><span>想吃的东西</span><input data-food-field="query" name="query" type="text" value="'+foodEscape(drafts.query??(state.orders?.foodSearch?.query||''))+'" placeholder="今天想吃什么呢"></label>','搜一搜')+'</div>'+
                (shops.length?'<div class="pp-food-shops">'+shops.map(shop=>{
                    const count=shopLines(state,shop.id).reduce((sum,i)=>sum+i.quantity,0);
                    const min=Math.min(...shop.menu.map(d=>d.priceMinor));
                    return '<article class="pp-food-shop-card"><button type="button" class="pp-food-shop-open" data-food-action="shop" data-food-id="'+foodEscape(shop.id)+'"'+disabled()+'><div class="pp-food-shop-row"><strong>'+foodEscape(shop.name)+'</strong>'+(count?'<b class="pp-food-shop-badge" aria-label="已选 '+count+' 件">'+count+'</b>':'')+'</div>'+(shop.cuisine?'<small class="pp-food-cuisine">'+foodEscape(shop.cuisine)+'</small>':'')+(shop.description?'<p>'+foodEscape(shop.description)+'</p>':'')+'<small class="pp-food-min">低至 '+foodEscape(foodMoney(min,shop.currency))+' · '+shop.menu.length+' 道菜</small></button></article>';
                }).join('')+'</div>':empty('food',state.orders?.foodSearch?'换一家试试？':'想吃什么？','搜一搜想吃的东西，看看这个时代、这座城市有什么好吃的。'));
        }else{
            const orders=foodItems(state,'foodOrder').slice().reverse();
            body='<h3 class="pp-food-heading">外卖订单</h3>'+(orders.map(order=>{
                const delivery=foodDeliveryStatus(order,chat());
                return '<article class="pp-food-order"><header><strong>'+foodEscape(delivery.label)+'</strong><small>下单 '+foodEscape(clockText(order))+'</small></header><div class="pp-food-order-body"><p class="pp-food-order-shop">'+foodEscape([order.shopName,order.cuisine].filter(Boolean).join(' · '))+'</p><p>收件人：'+foodEscape(order.recipient.name)+'</p>'+order.items.map(i=>'<p class="pp-food-order-line"><span>'+foodEscape(i.name)+' × '+i.quantity+'</span><b>'+foodEscape(foodMoney(i.priceMinor*i.quantity,order.items[0].currency))+'</b></p>').join('')+'<p class="pp-food-order-total">合计 <b>'+foodEscape(Object.entries(order.totals).map(([c,v])=>foodMoney(v,c)).join(' + '))+'</b></p></div></article>';
            }).join('')||empty('parcel','还没有外卖订单','下单后，可以在这里等待美味送达。'));
        }
        return '<div class="pp-snap pp-food"><header class="pp-food-masthead"><b>榴莲外卖</b><span>外卖点餐</span></header><div class="pp-food-body" data-food-page="'+foodEscape(tab+':'+(selectedShop||''))+'"><p class="pp-snap-status" role="status">'+foodEscape(working||state.busy?'正在处理…':state.errorKind==='food'&&state.error?state.error:status)+'</p>'+body+'</div><nav class="pp-snap-tabs pp-food-tabs" aria-label="榴莲外卖页面">'+[['home','外卖','food'],['orders','订单','parcel']].map(([id,label,symbol])=>'<button type="button" data-food-action="tab" data-food-id="'+id+'" aria-pressed="'+(tab===id)+'" aria-label="'+label+'"><span class="pp-food-tab-icon">'+icon(symbol)+'</span><span>'+label+'</span></button>').join('')+'</nav></div>';
    }
    const submit=(name,body,label)=>'<form data-food-form="'+name+'" class="pp-snap-form">'+body+'<button type="submit" class="pp-food-search-btn"'+disabled()+'>'+foodEscape(label)+'</button></form>';
    async function perform(method,args,message=''){
        if(!adapter.food){notice('请在酒馆内使用榴莲外卖。');return null;}if(working||getView().busy)return null;
        const token=epoch;working=true;redraw();
        try{const r=await adapter.food[method](...args);if(token!==epoch)return null;status=r?.ok?message:r?.error||'请重试。';return r;}
        catch(e){if(token===epoch)status=e.message;return null;}finally{working=false;redraw();}
    }
    async function placeOrder(key){
        const target=buy;buy=null;status='';redraw();
        const name=key==='other'?(drafts.foodName??''):'';
        const r=await perform('checkout',[selectedShop,key,name],'下单成功');
        if(r?.ok){tab='orders';selectedShop=null;delete drafts.foodName;redraw();return;}
        buy=target?{...target,hint:r?.error||'请重试。'}:null;redraw();
    }
    return {html,back(){if(tab==='home'&&selectedShop){selectedShop=null;buy=null;redraw();return true;}return false;},reset(){epoch++;tab='home';selectedShop=null;drafts={};status='';buy=null;},input(el){drafts[el.dataset.foodField]=el.value;},
        async action(action,id){
            if(action==='tab'){tab=id;selectedShop=null;status='';buy=null;redraw();return;}
            if(action==='shop'){selectedShop=id;status='';buy=null;redraw();return;}
            if(action==='back'){selectedShop=null;buy=null;redraw();return;}
            if(action==='inc')await perform('add',[selectedShop,id,1]);
            if(action==='dec'){
                const state=getView(),line=lineOf(state,id);
                await perform('update',[selectedShop,id,Math.max(0,(line?.quantity||1)-1)]);
            }
            if(action==='buy'){
                const state=getView();
                if(!shopLines(state,selectedShop).length){status='还没有选择菜品，先挑几样想吃的吧。';redraw();return;}
                buy={step:'target',hint:''};status='';redraw();return;
            }
            if(action==='gift-self')await placeOrder('self');
            if(action==='gift-other'){buy={step:'name',hint:''};status='';delete drafts.foodName;redraw();return;}
            if(action==='gift-back'){buy={step:buy?.step==='name'?'target':'name',hint:''};if(buy.step==='name')delete drafts.foodName;redraw();return;}
            if(action==='gift-cancel'){buy=null;status='';redraw();return;}
        },
        async submit(form){const v=Object.fromEntries(new FormData(form)),kind=form.dataset.foodForm;
            if(kind==='search')await perform('search',[v.query]);
            if(kind==='gift-name'){
                if(!String(v.foodName||'').trim()){buy={step:'name',hint:'请填写收件人的名字。'};status='';redraw();return;}
                await placeOrder('other');
            }
        },
    };
}
