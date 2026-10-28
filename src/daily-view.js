import { dailyArticles, dailyExpiry, dailyStatus } from './daily-core.js?v=0.24.25';
import { dayDate } from './story-clock.js?v=0.24.25';
const dailyEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createDailyPanel({adapter,getView,redraw,notice}) {
    let working=false,status='',epoch=0;
    const expanded=new Set();
    function html() {
        const state=getView(),edition=state.daily?.edition,chat=adapter.storyChat?.()||[],expiry=dailyExpiry(edition,chat),busy=working||state.busy;
        const articles=dailyArticles(state),order=new Map((edition?.articleIds||[]).map((id,i)=>[id,i]));articles.sort((a,b)=>order.get(a.id)-order.get(b.id));
        const publication=edition?.publication||articles[0]?.outlet||'今日报刊';
        const date=!edition?'每日选编':edition.day==null?'日期待明确':dayDate(edition.day).replaceAll('-',' / ');
        return '<section class="pp-daily"><header class="pp-daily-masthead"><small>THE PRESS · 今日选读</small><h2>'+dailyEscape(publication)+'</h2><div><span>'+dailyEscape(date)+'</span><span>'+dailyEscape(edition?.location||'今日选读')+'</span></div></header>'
            +'<div class="pp-daily-toolbar"><span>'+(edition?(expiry==='expired'?'<b class="pp-daily-expired">已过期</b>':expiry==='unknown'?'剧情日期不明确':'本日刊'):'还没有本日报纸')+'</span><button type="button" class="pp-daily-refresh" data-daily-action="update"'+(busy?' disabled':'')+'>看看新闻</button></div>'
            +'<p class="pp-daily-status" role="status">'+dailyEscape(working?'正在取阅…':status)+'</p>'
            +(!articles.length?'<div class="pp-daily-empty"><span>☷</span><p>'+(edition?'本期暂无可刊登的报道':'今天的世界，有什么新鲜事？')+'</p></div>':'<div class="pp-daily-grid">'+articles.map(a=>{
                const used=dailyStatus(a,state,chat),label=used==='used'?'已采用':used==='expired'?'已过期':used==='unknown'?'日期不明确':used==='old'?'旧报道':a.selected?'已选 · 取消注入':'注入正文';
                return '<article class="pp-daily-article pp-daily-'+a.placement+(a.placement==='lead'||a.body.length>500?' pp-daily-wide':'')+(expanded.has(a.id)?' pp-daily-expanded':'')+'" data-daily-article="'+dailyEscape(a.id)+'"><div class="pp-daily-byline"><span>'+dailyEscape(a.section||(a.placement==='lead'?'头条':a.placement==='brief'?'短讯':'报道'))+'</span><span>'+dailyEscape(a.outlet)+'</span></div><h3>'+dailyEscape(a.headline)+'</h3><p class="pp-daily-deck">'+dailyEscape(a.summary)+'</p>'
                    +(expanded.has(a.id)?'<div class="pp-daily-body">'+dailyEscape(a.body)+'</div>':'')
                    +'<footer><button type="button" data-daily-action="read" data-daily-id="'+dailyEscape(a.id)+'" aria-expanded="'+expanded.has(a.id)+'">'+(expanded.has(a.id)?'收起全文':'阅读全文')+'</button><button type="button" data-daily-action="inject" data-daily-id="'+dailyEscape(a.id)+'" class="pp-daily-inject" aria-label="'+label+'" title="'+label+'" aria-pressed="'+(used==='active'&&a.selected)+'"'+(busy||used!=='active'?' disabled':'')+'><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H5v18h14V8M14 3v5h5M8 13h8m-4-3 3 3-3 3"/></svg></button></footer></article>';
            }).join('')+'</div>')+'<div class="pp-daily-end">'+dailyEscape(publication)+' · '+dailyEscape(edition?.location||'今日选读')+'</div></section>';
    }
    return {html,reset(){epoch++;working=false;status='';expanded.clear();},async action(action,id){
        if(action==='read'){if(expanded.has(id))expanded.delete(id);else expanded.add(id);redraw();return;}
        if(!['update','inject'].includes(action)||working||getView().busy)return;
        if(!adapter.daily){notice('请在酒馆中取阅日报。');return;}
        const token=epoch;working=true;status='';redraw();
        try{const result=await (action==='update'?adapter.daily.update():adapter.daily.toggle(id));if(token===epoch){status=result?.ok?(action==='update'?'本期已更新':''):result?.error||'本次未完成，请重试。';if(result?.ok&&action==='update')expanded.clear();}}
        catch(e){if(token===epoch)status=e.message;}
        finally{if(token===epoch)working=false;redraw();}
    }};
}
