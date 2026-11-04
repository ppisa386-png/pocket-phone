// A page exposes only editable display fields. IDs, private state and ownership
// stay in the journal. Each field retains its original value for stale-edit checks.
export function pageFields(state,scope){
    const rows=Object.values(state.x||{}),fields=[];
    const add=(r,path,label,number=false)=>{
        const v=path.reduce((a,k)=>a?.[k],r);
        fields.push({id:r.id,path,label,number,value:String(v??(number?'0':''))});
    };
    const name=id=>id==='user'?'你':state.x[id]?.name||'用户';
    if(scope.tab==='messages'){
        const a=state.x[scope.accountId];if(a?.type!=='account')return [];
        for(const m of rows.filter(r=>r.type==='message'&&r.accountId===a.id)){
            if(a.inboundRequest&&!a.dmAccepted&&m.kind&&m.kind!=='text')continue;
            add(m,['text'],m.role==='user'?'你的私信':a.name+'的私信');
        }
    }else if(scope.tab==='search'){
        const edition=state.x['trend-edition'];
        for(const [i] of (edition?.topics||[]).entries()){
            for(const [k,label] of [['title','话题'],['scope','范围'],['summary','摘要'],['postCount','讨论数']])
                add(edition,['topics',i,k],'趋势 '+(i+1)+' · '+label,k==='postCount');
        }
        for(const a of rows.filter(r=>r.type==='account'&&(!scope.ids||scope.ids.includes(r.id)))){
            for(const [k,label] of [['name','名称'],['handle','账号'],['bio','简介']])add(a,[k],a.name+' · '+label);
        }
    }else if(['home','square'].includes(scope.tab)){
        const square=scope.tab==='square',edition=state.x['square-edition'];
        for(const p of rows.filter(r=>r.type==='post'&&!state.x[r.author]?.blocked&&(square?r.feed==='square'&&(!edition||r.publication?.editionId===edition.editionId):r.feed!=='square'&&(!scope.following||r.author==='user'||state.x[r.author]?.following)))){
            const author=name(p.author);add(p,['text'],author+' · 推文');
            for(const [k,label] of [['likes','点赞'],['reposts','转发'],['replies','回复']])add(p,['metrics',k],author+' · '+label,true);
            for(const c of rows.filter(r=>r.type==='comment'&&r.postId===p.id))add(c,['text'],name(c.author)+' · 回复');
        }
    }
    return fields;
}
export function pageEdits(state,scope,edits){
    const available=new Map(pageFields(state,scope).map(f=>[JSON.stringify([f.id,f.path]),f])),records=new Map();
    for(const edit of edits){
        const f=available.get(JSON.stringify([edit.id,edit.path]));
        if(!f||f.value!==edit.before)throw Error('页面内容已变化，请重新打开编辑。');
        let value=String(edit.value).trim();
        if(f.number){if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('互动数量须为非负安全整数。');value=Number(value);}
        else if((!value&&f.path.at(-1)!=='bio')||value.length>6000)throw Error('请填写有效的页面内容。');
        const row=records.get(f.id)||structuredClone(state.x[f.id]);
        let obj=row;for(const k of f.path.slice(0,-1)){obj[k]??={};obj=obj[k];}
        obj[f.path.at(-1)]=value;records.set(f.id,row);
    }
    return [...records.values()].map(value=>({collection:'x',key:value.id,value}));
}
