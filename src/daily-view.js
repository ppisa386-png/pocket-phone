import { dailyArticles, dailyExpiry, dailyStatus, dailyArchives } from './daily-core.js?v=1.0.4';
import { dayDate } from './story-clock.js?v=1.0.4';
const dailyEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createDailyPanel({adapter,getView,redraw,notice}) {
    let working=false,status='',epoch=0,folder=false,archiveId=null;
    const expanded=new Set();
    function back() {
        if (!folder) return false;
        if (archiveId) archiveId=null; else folder=false;
        expanded.clear();redraw();return true;
    }
    function html() {
        const state=getView(),chat=adapter.storyChat?.()||[],archives=dailyArchives(state,chat),busy=working||state.busy;
        const archived=folder&&archiveId?archives.find(e=>e.editionId===archiveId):null;
        if(folder&&!archived) return '<section class="pp-daily pp-daily-folder"><header class="pp-daily-masthead"><small>THE PRESS · 历史收藏</small><h2>过往报纸夹</h2></header><div class="pp-daily-toolbar"><button type="button" data-daily-action="archive-back">‹ 返回本期</button><span>最近三份过期报纸</span></div>'+
            (archives.length?'<div class="pp-daily-archive-list">'+archives.map(e=>'<button type="button" data-daily-action="archive-edition" data-daily-id="'+dailyEscape(e.editionId)+'"><small>'+dailyEscape(dayDate(e.day))+' · 已过期</small><strong>'+dailyEscape(e.publication||e.articles[0]?.outlet||'往期报刊')+'</strong><span>'+e.articles.length+' 篇报道 · 阅读全文</span></button>').join('')+'</div>':'<div class="pp-daily-empty"><p>暂无过期报纸</p></div>')+'</section>';
        const edition=archived||state.daily?.edition,expiry=dailyExpiry(edition,chat);
        const articles=archived?[...archived.articles]:dailyArticles(state),order=new Map((edition?.articleIds||[]).map((id,i)=>[id,i]));articles.sort((a,b)=>order.get(a.id)-order.get(b.id));
        const publication=edition?.publication||articles[0]?.outlet||'今日报刊';
        const date=!edition?'每日选编':edition.day==null?'日期待明确':dayDate(edition.day).replaceAll('-',' / ');
        return '<section class="pp-daily"><header class="pp-daily-masthead"><small>THE PRESS · 今日选读</small><h2>'+dailyEscape(publication)+'</h2><div><span>'+dailyEscape(date)+'</span><span>'+dailyEscape(edition?.location||'今日选读')+'</span></div></header>'
            +(archived?'<div class="pp-daily-toolbar"><button type="button" data-daily-action="archive-back">‹ 返回报纸夹</button><b class="pp-daily-expired">已过期 · 仅供回看</b></div>':'<div class="pp-daily-toolbar"><button type="button" class="pp-daily-folder-button" data-daily-action="archive" aria-label="过往报纸夹" title="过往报纸夹"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h8v3"/></svg></button><span>'+(edition?(expiry==='expired'?'<b class="pp-daily-expired">已过期</b>':expiry==='unknown'?'剧情日期不明确':'本日刊'):'还没有本日报纸')+'</span><button type="button" class="pp-daily-refresh" data-daily-action="update"'+(busy?' disabled':'')+'>看看新闻</button></div>')
            +'<p class="pp-daily-status" role="status">'+dailyEscape(working?'正在取阅…':status)+'</p>'
            +(!articles.length?'<div class="pp-daily-empty"><span>☷</span><p>'+(edition?'本期暂无可刊登的报道':'今天的世界，有什么新鲜事？')+'</p></div>':'<div class="pp-daily-grid">'+articles.map(a=>{
                const used=archived?'expired':dailyStatus(a,state,chat),label=used==='used'?'已采用':used==='expired'?'已过期':used==='unknown'?'日期不明确':used==='old'?'旧报道':a.selected?'已选 · 取消注入':'注入正文';
                return '<article class="pp-daily-article pp-daily-'+a.placement+(a.placement==='lead'||a.body.length>500?' pp-daily-wide':'')+(expanded.has(a.id)?' pp-daily-expanded':'')+'" data-daily-article="'+dailyEscape(a.id)+'"><div class="pp-daily-byline"><span>'+dailyEscape(a.section||(a.placement==='lead'?'头条':a.placement==='brief'?'短讯':'报道'))+'</span><span>'+dailyEscape(a.outlet)+'</span></div><h3>'+dailyEscape(a.headline)+'</h3><p class="pp-daily-deck">'+dailyEscape(a.summary)+'</p>'
                    +(expanded.has(a.id)?'<div class="pp-daily-body">'+dailyEscape(a.body)+'</div>':'')
                    +'<footer><button type="button" data-daily-action="read" data-daily-id="'+dailyEscape(a.id)+'" aria-expanded="'+expanded.has(a.id)+'">'+(expanded.has(a.id)?'收起全文':'阅读全文')+'</button><button type="button" data-daily-action="inject" data-daily-id="'+dailyEscape(a.id)+'" class="pp-daily-inject" aria-label="'+label+'" title="'+label+'" aria-pressed="'+(used==='active'&&a.selected)+'"'+(busy||used!=='active'?' disabled':'')+'><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3H5v18h14V8M14 3v5h5M8 13h8m-4-3 3 3-3 3"/></svg></button></footer></article>';
            }).join('')+'</div>')+'<div class="pp-daily-end">'+dailyEscape(publication)+' · '+dailyEscape(edition?.location||'今日选读')+'</div></section>';
    }
    return {html,back,reset(){epoch++;working=false;status='';folder=false;archiveId=null;expanded.clear();},async action(action,id){
        if(action==='archive'){folder=true;archiveId=null;expanded.clear();redraw();return;}
        if(action==='archive-back'){back();return;}
        if(action==='archive-edition'){if(dailyArchives(getView(),adapter.storyChat?.()||[]).some(e=>e.editionId===id)){folder=true;archiveId=id;expanded.clear();redraw();}return;}
        if(action==='read'){if(expanded.has(id))expanded.delete(id);else expanded.add(id);redraw();return;}
        if(folder||!['update','inject'].includes(action)||working||getView().busy)return;
        if(!adapter.daily){notice('请在酒馆中取阅日报。');return;}
        const token=epoch;working=true;status='';redraw();
        try{const result=await (action==='update'?adapter.daily.update():adapter.daily.toggle(id));if(token===epoch){status=result?.ok?(action==='update'?'本期已更新':''):result?.error||'本次未完成，请重试。';if(result?.ok&&action==='update')expanded.clear();}}
        catch(e){if(token===epoch)status=e.message;}
        finally{if(token===epoch)working=false;redraw();}
    }};
}
