import { dailyArticles, dailyExpiry, dailyStatus, dailyArchives } from './daily-core.js?v=1.2.63';
import { dayDate } from './story-clock.js?v=1.2';
const dailyEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function createDailyPanel({adapter,getView,redraw,notice,editPart}) {
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
        if(folder&&!archived){
            const archiveRows=archives.map(e=>{
                const dateLabel=e.printDate||dayDate(e.day)||'日期待明确';
                const paperName=e.publication||e.articles[0]?.outlet||'往期报刊';
                return '<button type="button" class="pp-daily-archive-entry" data-daily-action="archive-edition" data-press="daily-archive" title="长按删除这期报纸" data-daily-id="'+dailyEscape(e.editionId)+'" aria-label="打开 '+dailyEscape(paperName)+' 的过往报纸">'+
                    '<span class="pp-daily-archive-copy"><small>'+dailyEscape(dateLabel)+' · 已过期</small><strong>'+dailyEscape(paperName)+'</strong><span>'+e.articles.length+' 篇报道 · 阅读全文</span></span>'+
                    '<span class="pp-daily-archive-arrow" aria-hidden="true">›</span></button>';
            }).join('');
            return '<section class="pp-daily pp-daily-folder"><header class="pp-daily-masthead">'+
                '<div class="pp-daily-masthead-top"><span>榴莲日报<br>现代中文日报</span><span>关注世界<br>深度思考</span></div>'+
                '<h2>过往报纸夹</h2><div class="pp-daily-date-line"><span>最近三份过期报纸</span><span>仅供回看</span></div></header>'+
                '<div class="pp-daily-toolbar pp-daily-toolbar--archive"><button type="button" class="pp-daily-back-button" data-daily-action="archive-back">‹ 返回本期</button><span>报纸档案</span></div>'+
                (archives.length?'<div class="pp-daily-archive-list">'+archiveRows+'</div>':'<div class="pp-daily-empty"><span>档案</span><p>暂无过期报纸</p></div>')+
                '<div class="pp-daily-end"><span>榴莲日报</span><span> · </span><span>过往刊期</span></div></section>';
        }
        const edition=archived||state.daily?.edition,expiry=dailyExpiry(edition,chat);
        const articles=archived?[...archived.articles]:dailyArticles(state),order=new Map((edition?.articleIds||[]).map((id,i)=>[id,i]));
        articles.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
        const publication=edition?.publication||articles[0]?.outlet||'今日选编';
        const dateValue=edition?String(edition.printDate||dayDate(edition.day)||''):'';
        const date=dateValue?dateValue.replaceAll('-',' / '):'日期待明确';
        const parsedDate=/^\d{4}-\d{2}-\d{2}$/.test(dateValue)?new Date(dateValue+'T00:00:00Z'):null;
        const validDate=parsedDate&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===dateValue;
        const weekday=validDate?'星期'+['日','一','二','三','四','五','六'][parsedDate.getUTCDay()]:'';
        const location=edition?.location||'地区待明确';
        const renderArticle=a=>{
            const placement=a.placement==='lead'?'lead':a.placement==='brief'?'brief':'feature';
            const isExpanded=expanded.has(a.id);
            const label=a.section||(placement==='lead'?'要闻':placement==='brief'?'简讯':'报道');
            const outletName=String(a.outlet||'').trim();
            const outletMarkup=outletName&&outletName!==String(publication||'').trim()?'<span class="pp-daily-outlet">'+dailyEscape(outletName)+'</span>':'';
            return '<article class="pp-daily-article pp-daily-'+placement+(isExpanded?' pp-daily-expanded':'')+'" data-daily-article="'+dailyEscape(a.id)+'" data-press="daily-article" data-daily-id="'+dailyEscape(a.id)+'">'+
                '<div class="pp-daily-article-copy"><div class="pp-daily-byline"><span class="pp-daily-section-label">'+dailyEscape(label)+'</span>'+outletMarkup+'</div>'+
                '<h3>'+dailyEscape(a.headline)+'</h3><p class="pp-daily-deck">'+dailyEscape(a.summary)+'</p>'+
                (isExpanded?'<div class="pp-daily-body">'+dailyEscape(a.body)+'</div>':'')+'</div>'+
                '<footer><button type="button" data-daily-action="read" data-daily-id="'+dailyEscape(a.id)+'" aria-expanded="'+isExpanded+'"><span>'+(isExpanded?'收起全文':'阅读全文')+'</span><span aria-hidden="true">'+(isExpanded?'⌃':'›')+'</span></button></footer></article>';
        };
        const lead=articles.find(a=>a.placement==='lead')||articles[0];
        const features=articles.filter(a=>a!==lead&&a.placement!=='brief');
        const briefs=articles.filter(a=>a!==lead&&a.placement==='brief');
        const content=!articles.length
            ?'<div class="pp-daily-empty"><span>今日选读</span><p>'+(edition?'本期暂无可刊登的报道':'今天的世界，有什么新鲜事？')+'</p></div>'
            :'<div class="pp-daily-grid">'+
                (lead?'<section class="pp-daily-lead-section" aria-label="头条">'+renderArticle(lead)+'</section>':'')+
                (features.length?'<section class="pp-daily-feature-section" aria-label="本期报道"><div class="pp-daily-feature-grid">'+features.map(renderArticle).join('')+'</div></section>':'')+
                (briefs.length?'<section class="pp-daily-brief-section"><div class="pp-daily-brief-heading"><span>今日简讯</span><small>BRIEFS</small></div><div class="pp-daily-brief-list">'+briefs.map(renderArticle).join('')+'</div></section>':'')+
            '</div>';
        const currentLabel=edition?(expiry==='expired'?'已过期':expiry==='unknown'?'日期未明确':'本日刊'):'尚未出刊';
        return '<section class="pp-daily"><header class="pp-daily-masthead">'+
            '<div class="pp-daily-masthead-top"><span class="pp-daily-publication-meta"><span>现代中文日报</span><strong class="pp-daily-publication-name" data-press="daily-meta" data-daily-field="publication" title="长按修改出版物">'+dailyEscape(publication)+'</strong></span><span>关注世界<br>深度思考</span></div>'+
            '<h2>榴莲日报</h2>'+
            '<div class="pp-daily-date-line"><span data-press="daily-meta" data-daily-field="date" title="长按修改刊登日期">'+dailyEscape(date)+'</span>'+(weekday?'<span class="pp-daily-weekday">'+weekday+'</span>':'')+'<span class="pp-daily-date-divider" aria-hidden="true">|</span><span data-press="daily-meta" data-daily-field="location" title="长按修改地区">'+dailyEscape(location)+'</span></div></header>'+
            (archived?'<div class="pp-daily-toolbar pp-daily-toolbar--archive"><button type="button" class="pp-daily-back-button" data-daily-action="archive-back">‹ 返回报纸夹</button><b class="pp-daily-expired">已过期 · 仅供回看</b></div>':
                '<div class="pp-daily-toolbar"><button type="button" class="pp-daily-folder-button" data-daily-action="archive" aria-label="过往报纸夹" title="过往报纸夹"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h8v3"/></svg><span>报纸档案</span></button><span class="pp-daily-toolbar-current">'+currentLabel+'</span><button type="button" class="pp-daily-refresh" data-daily-action="update"'+(busy?' disabled':'')+'>看看新闻 <span aria-hidden="true">›</span></button></div>')+
            '<p class="pp-daily-status" role="status">'+dailyEscape(working?'正在取阅…':status)+'</p>'+content+
            '<div class="pp-daily-end"><span>榴莲日报</span><span> · </span><span>'+dailyEscape(location)+'</span></div></section>';
    }
    const api={html,back,reset(){epoch++;working=false;status='';folder=false;archiveId=null;expanded.clear();},
        press(element){
            const state=getView(),chat=adapter.storyChat?.()||[],archives=dailyArchives(state,chat);
            const archived=folder&&archiveId?archives.find(e=>e.editionId===archiveId):null;
            const edition=archived||state.daily?.edition;
            const busy=!!(working||state.busy);
            if(element.dataset.press==='daily-archive'){
                const id=element.dataset.dailyId;
                if(!folder||!archives.some(e=>e.editionId===id))return [];
                return [{icon:'delete',label:'删除这期报纸',danger:true,disabled:busy,run:()=>{
                    if(!window.confirm('确定删除这期过往报纸吗？删除后将从报纸夹中移除。'))return;
                    return api.action('delete-archive',id);
                }}];
            }
            if(!edition)return [];
            if(element.dataset.dailyField){
                const field=element.dataset.dailyField;
                const label={publication:'出版物',date:'刊登日期',location:'地区'}[field]||'报纸信息';
                return [{icon:'edit',label:'修改'+label,disabled:busy,run:()=>editPart?.(edition.editionId,{kind:'meta',field})}];
            }
            const id=element.dataset.dailyId;
            const article=(archived?archived.articles:dailyArticles(state)).find(a=>a.id===id);
            if(!article)return [];
            const used=archived?'expired':dailyStatus(article,state,chat);
            const actions=[{icon:'edit',label:'修改这篇报道',disabled:busy,run:()=>editPart?.(edition.editionId,{kind:'article',id})}];
            actions.push({icon:'inject',label:article.selected?'取消注入这篇报道':'注入这篇报道',active:used==='active'&&article.selected===true,
                disabled:busy||used!=='active',run:()=>api.action('inject',id)});
            return actions;
        },
        async action(action,id){
        if(action==='archive'){folder=true;archiveId=null;expanded.clear();redraw();return;}
        if(action==='archive-back'){back();return;}
        if(action==='archive-edition'){if(dailyArchives(getView(),adapter.storyChat?.()||[]).some(e=>e.editionId===id)){folder=true;archiveId=id;expanded.clear();redraw();}return;}
        if(action==='read'){if(expanded.has(id))expanded.delete(id);else expanded.add(id);redraw();return;}
        if(action==='delete-archive'){
            if(!folder||working||getView().busy)return;
            if(!adapter.daily?.deleteArchive){notice('请在酒馆中管理报纸夹。');return;}
            const token=epoch;working=true;status='';redraw();
            try{
                const result=await adapter.daily.deleteArchive(id);
                if(token===epoch){
                    if(result?.ok){archiveId=null;expanded.clear();status='这期报纸已删除';}
                    else status=result?.error||'删除失败，请重试。';
                }
            }catch(error){if(token===epoch)status=error.message;}
            finally{if(token===epoch){working=false;redraw();}}
            return;
        }
        if(folder||!['update','inject'].includes(action)||working||getView().busy)return;
        if(!adapter.daily){notice('请在酒馆中取阅日报。');return;}
        const token=epoch;working=true;status='';redraw();
        try{const result=await (action==='update'?adapter.daily.update():adapter.daily.toggle(id));if(token===epoch){status=result?.ok?(action==='update'?'本期已更新':''):result?.error||'本次未完成，请重试。';if(result?.ok&&action==='update')expanded.clear();}}
        catch(e){if(token===epoch)status=e.message;}
        finally{if(token===epoch)working=false;redraw();}
    }};
    return api;
}
