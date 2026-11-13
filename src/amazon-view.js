import { shopItems, shopMoney } from './amazon.js?v=1.2.14';
import { dayDate, readStoryClock } from './story-clock.js?v=1.2';
import { deliveryStatus } from './delivery.js?v=1.2.57';
import { icon } from './icons.js?v=1.2.57';
import { shopImageKey, shopImageSrc } from './amazon-art.js?v=1.2.14';
const shopEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createAmazonPanel({adapter,getView,redraw,notice}){
    let tab='shop',selected=null,status='',working=false,epoch=0,drafts={},gift=null;
    const chat=()=>adapter.storyChat?.()||[];
    const disabled=()=>working||getView().busy?' disabled':'';
    const btn=(action,label,id='')=>'<button type="button" class="pp-snap-button" data-shop-action="'+action+'" data-shop-id="'+shopEscape(id)+'"'+disabled()+'>'+shopEscape(label)+'</button>';
    const input=(name,label,value='',type='text')=>'<label class="pp-field"><span>'+label+'</span><input data-shop-field="'+name+'" name="'+name+'" type="'+type+'" value="'+shopEscape(drafts[name]??value)+'"'+(name==='query'?' placeholder="搜索 Amazon 商品"':'')+(type==='number'?' min="1" max="99"':'')+'></label>';
    const submit=(name,body,label)=>'<form data-shop-form="'+name+'" class="pp-snap-form">'+body+'<button type="submit" class="pp-snap-primary"'+disabled()+'>'+label+'</button></form>';
    const amount=items=>{const sums=Object.create(null);for(const i of items)sums[i.product.currency]=(sums[i.product.currency]||0)+i.quantity*i.product.priceMinor;return Object.entries(sums).map(([c,v])=>shopMoney(v,c)).join(' + ');};
    const parcel=()=>'<span class="pp-shop-parcel" aria-hidden="true">'+icon('parcel')+'</span>';
    const art=(product, extra='')=>{
        const key=shopImageKey(product?.image,[product?.name,product?.brand].filter(Boolean).join(' '));
        return '<span class="pp-shop-art pp-shop-art-'+key+(extra?' '+extra:'')+'"><img src="'+shopEscape(shopImageSrc(key))+'" alt="" loading="lazy" decoding="async" width="72" height="72"></span>';
    };
    const rating=product=>{
        const reviews=product.reviews||[];
        if(!reviews.length)return '';
        const average=reviews.reduce((sum,r)=>sum+Number(r.rating||0),0)/reviews.length;
        const score=Math.max(1,Math.min(5,average));
        return '<span class="pp-shop-rating" aria-label="买家评价平均 '+score.toFixed(1)+' 星"><span aria-hidden="true">★</span> '+score.toFixed(1)+' <small>('+reviews.length+' 条评价)</small></span>';
    };
    const itemHTML=i=>'<div class="pp-shop-item">'+art(i.product,'pp-shop-art-inline')+'<div><strong>'+shopEscape([i.product.brand,i.product.name].filter(Boolean).join(' '))+'</strong><p>'+shopEscape(i.variant)+(i.variant?' · ':'')+'数量 '+i.quantity+'</p><b class="pp-shop-price">'+shopEscape(shopMoney(i.product.priceMinor,i.product.currency))+'</b></div></div>';
    const empty=(symbol,title,text)=>'<div class="pp-shop-empty">'+icon(symbol)+'<h3>'+title+'</h3><p>'+text+'</p></div>';
    const bubble=(label,inner)=>'<div class="pp-shop-bubble" role="dialog" aria-label="'+label+'">'+inner+'<span class="pp-shop-bubble-tail" aria-hidden="true"></span></div>';
    const bubbleOption=(action,id,title,note='')=>'<button type="button" class="pp-shop-bubble-option" data-shop-action="'+action+'" data-shop-id="'+shopEscape(id)+'"'+disabled()+'><b>'+shopEscape(title)+'</b>'+(note?'<small>'+shopEscape(note)+'</small>':'')+'</button>';
    function giftBubble(){
        if(!gift)return '';
        const cancel='<button type="button" class="pp-shop-bubble-quiet" data-shop-action="gift-cancel"'+disabled()+'>取消</button>';
        const hint=gift.hint?'<p class="pp-shop-bubble-hint">'+shopEscape(gift.hint)+'</p>':'';
        if(gift.step==='target')return bubble('选择收货对象','<p class="pp-shop-bubble-title">选择收货对象</p><div class="pp-shop-bubble-options">'+bubbleOption('gift-self','self','寄到自己的地址','收件人是 '+String(adapter.userName?.()||'user'))+bubbleOption('gift-other','','买给别人','输入角色名，不需要电话号码')+'</div>'+hint+cancel);
        if(gift.step==='name')return bubble('买给别人','<p class="pp-shop-bubble-title">买给别人</p><form data-shop-form="gift-name" class="pp-shop-bubble-form">'+hint+'<label class="pp-field"><span>输入角色名</span><input data-shop-field="giftName" name="giftName" type="text" placeholder="输入角色名，可以是单个名字" value="'+shopEscape(drafts.giftName??'')+'"'+disabled()+'></label><div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-shop-action="gift-back"'+disabled()+'>上一步</button><button type="submit" class="pp-shop-bubble-confirm"'+disabled()+'>确认</button></div></form>'+cancel);
        if(gift.step==='pick')return bubble('选择角色','<p class="pp-shop-bubble-title">「'+shopEscape(drafts.giftName??'')+'」对应多位角色，请选择收件人</p><div class="pp-shop-bubble-options">'+gift.candidates.map(c=>bubbleOption('gift-pick',c.key,c.name)).join('')+'</div>'+hint+'<div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-shop-action="gift-back"'+disabled()+'>重新输入</button>'+cancel+'</div>');
        if(gift.step==='payer')return bubble('请 NPC 代付','<p class="pp-shop-bubble-title">请 TA 代付</p><form data-shop-form="payer-name" class="pp-shop-bubble-form">'+hint+'<label class="pp-field"><span>代付角色名字</span><input data-shop-field="payerName" name="payerName" type="text" placeholder="名字、昵称都可以" value="'+shopEscape(drafts.payerName??'')+'"'+disabled()+'></label><div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-shop-action="gift-back"'+disabled()+'>上一步</button><button type="submit" class="pp-shop-bubble-confirm"'+disabled()+'>询问对方</button></div></form>'+cancel);
        return bubble('选择付款方式','<p class="pp-shop-bubble-title">选择付款方式</p><div class="pp-shop-bubble-options">'+bubbleOption('pay-self','self','自己付款','从小榴莲余额中支付')+bubbleOption('pay-npc','','请 TA 代付','输入名字，由对方决定是否愿意')+'</div>'+hint+cancel);
    }
    function html(){
        const state=getView(),products=shopItems(state,'product'),cart=state.orders?.cart?.items||[];
        const p=products.find(p=>p.id===selected);if(selected&&!p)selected=null;
        let body='';
        if(tab==='shop'&&p){
            body='<section class="pp-shop-detail">'+btn('back','‹ 返回商品列表')+
                '<div class="pp-shop-detail-visual">'+art(p,'pp-shop-art-large')+'</div>'+
                '<div class="pp-shop-detail-copy">'+
                '<small class="pp-shop-brand">'+shopEscape(p.brand)+'</small>'+
                '<h3>'+shopEscape(p.name)+'</h3>'+rating(p)+
                '<div class="pp-shop-detail-price"><small>商品价格</small><strong class="pp-shop-price">'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong></div>'+
                '<p class="pp-snap-copy">'+shopEscape(p.description)+'</p>'+
                submit('add',(p.variants.length?'<label class="pp-field"><span>选择规格</span><select name="variant" data-shop-field="variant">'+p.variants.map(v=>'<option'+((drafts.variant??p.variants[0])===v?' selected':'')+'>'+shopEscape(v)+'</option>').join('')+'</select></label>':'')+input('quantity','数量',1,'number'),'加入购物车')+'</div></section>'+
                '<section class="pp-shop-reviews"><h3>买家评价 <small>'+p.reviews.length+' 条</small></h3>'+p.reviews.map(r=>'<article class="pp-shop-review"><header><span class="pp-shop-review-avatar" aria-hidden="true">'+shopEscape(Array.from(r.name||'客')[0])+'</span><strong>'+shopEscape(r.name)+'</strong></header><span class="pp-shop-stars" aria-label="'+r.rating+' 星，满分 5 星">'+'★'.repeat(r.rating)+'<span aria-hidden="true">'+'☆'.repeat(5-r.rating)+'</span></span><p class="pp-snap-copy">'+shopEscape(r.text)+'</p></article>').join('')+(!p.reviews.length?'<p class="pp-snap-empty">暂无评价</p>':'')+'</section>';
        }else if(tab==='shop'){
            body='<div class="pp-shop-search">'+submit('search',input('query','搜索商品',state.orders?.catalog?.query||''),'<span class="pp-shop-sr">搜索商品</span>'+icon('search'))+'</div>'+
                (products.length?
                    '<section class="pp-shop-discover"><div class="pp-shop-section-eyebrow">探索你的好物</div><h3 class="pp-shop-heading">搜索结果 <span>'+products.length+' 件商品</span></h3><div class="pp-shop-results">'+
                    products.map(p=>'<article class="pp-shop-product">'+art(p,'pp-shop-art-list')+
                        '<div class="pp-shop-product-info"><small class="pp-shop-brand">'+shopEscape(p.brand)+'</small><h3>'+shopEscape(p.name)+'</h3>'+rating(p)+
                        '<strong class="pp-shop-price">'+shopEscape(shopMoney(p.priceMinor,p.currency))+'</strong>'+btn('product','查看详情',p.id)+'</div></article>').join('')+'</div></section>':
                    '<section class="pp-shop-welcome"><div class="pp-shop-welcome-visual">'+art({image:'shopping'},'pp-shop-art-welcome')+'</div><span class="pp-shop-section-eyebrow">AMAZON · 发现好物</span><h3>'+ (state.orders?.catalog?'暂时没有找到商品':'今天想买点什么？') +'</h3><p>搜索商品名称、品牌或购物需求，找到适合你的选择。</p></section>');
        }else if(tab==='cart'){
            const clock=readStoryClock(chat());
            body='<div class="pp-shop-section-eyebrow">你的购物清单</div><h3 class="pp-shop-heading">购物车'+(cart.length?' <span>'+cart.reduce((sum,i)=>sum+i.quantity,0)+' 件商品</span>':'')+'</h3>'+
                (cart.length?cart.map(i=>'<article class="pp-shop-cart-item">'+itemHTML(i)+btn('remove','移除',i.id)+'</article>').join('')+'<section class="pp-shop-checkout"><h3>合计 <b class="pp-shop-price">'+shopEscape(amount(cart))+'</b></h3>'+submit('checkout','<div class="pp-shop-date-fields">'+input('date','下单日期',dayDate(clock.day),'date')+input('time','下单时间',clock.hour!==null?String(Math.floor(clock.hour)).padStart(2,'0')+':'+String(Math.round(clock.hour%1*60)).padStart(2,'0'):'','time')+'</div>','确认下单')+giftBubble()+'</section>':empty('cart','购物车是空的','挑选喜欢的商品，加入购物车。'));
        }else{
            body='<div class="pp-shop-section-eyebrow">购物记录</div><h3 class="pp-shop-heading">我的订单</h3>'+(shopItems(state,'order').reverse().map(o=>{const delivery=deliveryStatus(o,chat());return '<article class="pp-shop-order"><header><strong>'+icon('parcel')+shopEscape(delivery.label)+'</strong><small>预计 '+dayDate(o.dueDay)+' 白天送达</small></header><div class="pp-shop-order-body"><p>收件人：'+shopEscape(o.recipient.name)+'</p>'+o.items.map(itemHTML).join('')+'<p class="pp-shop-order-total">合计 <b>'+shopEscape(Object.entries(o.totals).map(([c,v])=>shopMoney(v,c)).join(' + '))+'</b></p></div></article>';}).join('')||empty('parcel','暂无订单','下单后，可以在这里查看配送进度。'));
        }
        return '<div class="pp-snap pp-shop" data-shop-tab="'+shopEscape(tab)+'"><header class="pp-shop-masthead"><b>amazon<span aria-hidden="true"></span></b><span>购物 · 轻松选购</span></header><div class="pp-shop-body" data-shop-page="'+shopEscape(tab+':'+(selected||''))+'"><p class="pp-snap-status" role="status">'+shopEscape(working||state.busy?'正在处理…':state.errorKind==='amazon'&&state.error?state.error:status)+'</p>'+body+'</div><nav class="pp-snap-tabs pp-shop-tabs" aria-label="Amazon 页面">'+[['shop','商品','amazon'],['cart','购物车','cart'],['orders','订单','parcel']].map(([id,label,symbol])=>'<button type="button" data-shop-action="tab" data-shop-id="'+id+'" aria-pressed="'+(tab===id)+'" aria-label="'+label+(id==='cart'&&cart.length?' '+cart.length:'')+'"><span class="pp-shop-tab-icon">'+icon(symbol)+(id==='cart'&&cart.length?'<b aria-hidden="true">'+cart.length+'</b>':'')+'</span><span>'+label+'</span></button>').join('')+'</nav></div>';
    }
    async function perform(method,args,message=''){
        if(!adapter.amazon){notice('请在酒馆内使用 Amazon。');return null;}if(working||getView().busy)return null;
        const token=epoch;working=true;redraw();
        try{const r=await adapter.amazon[method](...args);if(token!==epoch)return null;status=r?.ok?message:r?.error||'请重试。';return r;}
        catch(e){if(token===epoch)status=e.message;return null;}finally{working=false;redraw();}
    }
    return {html,back(){if(tab==='shop'&&selected){selected=null;redraw();return true;}return false;},reset(){epoch++;tab='shop';selected=null;drafts={};status='';gift=null;},input(el){drafts[el.dataset.shopField]=el.value;},
        async action(action,id){
            if(action==='tab'){tab=id;selected=null;status='';gift=null;redraw();return;}
            if(action==='product'){selected=id;delete drafts.variant;drafts.quantity=1;redraw();return;}
            if(action==='back'){selected=null;redraw();return;}
            if(action==='remove')await perform('remove',[id]);
            if(action==='gift-self'){gift={step:'pay',recipientKey:'self',origin:'target',hint:''};status='';redraw();return;}
            if(action==='gift-other'){gift={step:'name',hint:''};status='';delete drafts.giftName;redraw();return;}
            if(action==='gift-back'){
                if(gift?.step==='payer')gift={...gift,step:'pay',hint:''};
                else if(gift?.step==='pay')gift={...gift,step:gift.origin||'target',hint:''};
                else {gift={step:gift?.step==='pick'?'name':'target',hint:''};if(gift.step==='target')delete drafts.giftName;}
                redraw();return;
            }
            if(action==='gift-cancel'){gift=null;status='';redraw();return;}
            if(action==='gift-pick'){gift={...(gift||{}),step:'pay',recipientKey:id,origin:'name',hint:''};status='';redraw();return;}
            if(action==='pay-self')await placeOrder(gift?.recipientKey||'self','self');
            if(action==='pay-npc'){gift={...(gift||{}),step:'payer',hint:''};status='';delete drafts.payerName;redraw();return;}
        },
        async submit(form){const v=Object.fromEntries(new FormData(form)),kind=form.dataset.shopForm;
            if(kind==='search')await perform('search',[v.query]);
            if(kind==='add')await perform('add',[selected,v.variant,Number(v.quantity)],'已加入购物车');
            if(kind==='checkout'){drafts.date=v.date;drafts.time=v.time;gift={step:'target',hint:''};status='';redraw();return;}
            if(kind==='gift-name')await resolveGift(String(v.giftName||''));
            if(kind==='payer-name'){
                const name=String(v.payerName||'').trim();
                if(!name){gift={...(gift||{}),step:'payer',hint:'请填写代付角色的名字。'};status='';redraw();return;}
                await placeOrder(gift?.recipientKey||'self','npc',name);
            }
        },
    };
    async function placeOrder(key,method='self',payerName=''){
        const target=gift;gift=null;status='';redraw();
        const r=await perform('checkout',[key,drafts.date??'',drafts.time??'',method,payerName],'下单成功');
        if(r?.ok){
            // NPC 拒绝不是请求失败：回到付款方式选择，收件人与购物车原样保留。
            if(r.value?.rejected){gift={...target,step:'pay',hint:'对方拒绝了你的代付要求'};status='';redraw();return;}
            tab='orders';delete drafts.date;delete drafts.time;delete drafts.giftName;delete drafts.payerName;redraw();return;
        }
        // AI 请求失败或格式错误：显示真实错误，保留原有选择，可重试。
        gift=target?{...target,step:method==='npc'?'payer':'pay',hint:r?.error||'请重试。'}:null;redraw();
    }
    async function resolveGift(query){
        if(!adapter.amazon?.recipientMatches){notice('请在酒馆内使用 Amazon。');return;}
        if(working||getView().busy)return;
        const token=epoch;working=true;redraw();
        let matched=null;
        try{
            const r=await adapter.amazon.recipientMatches(query);
            if(token!==epoch)return;
            if(r.kind==='unique')matched=r.matches[0].key;
            else if(r.kind==='ambiguous'){gift={step:'pick',hint:'',candidates:r.matches};status='';}
            else{gift={step:'name',hint:'没有找到这个角色，请重新输入。'};status='';}
        }catch(e){if(token===epoch)status=e.message;}
        finally{working=false;}
        if(token!==epoch)return;
        if(matched!==null){gift={...(gift||{}),step:'pay',recipientKey:matched,origin:'name',hint:''};status='';}
        redraw();
    }
}
