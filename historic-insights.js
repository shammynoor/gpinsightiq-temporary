(() => {
'use strict';
const number = value => Math.round(value).toLocaleString('en-GB');
const labelDate = (date, monthly) => new Date(date + (monthly ? '-01' : '') + 'T12:00:00Z')
 .toLocaleDateString('en-GB', {day: monthly ? undefined : 'numeric', month:'short', year:'numeric', timeZone:'UTC'});
const sum = values => values.reduce((a,b)=>a+b,0);
const average = values => sum(values)/values.length;
const descending = (a,b) => b[1]-a[1];
const cleanName = name => typeof name==='string' && name.length<=65 && !/[<>*\x00-\x1f]/.test(name);
const batchSize = 8;

function sliceView(view,start,end){
 const periods=view.periods.filter(period=>period>=start&&period<=end);
 const from=view.periods.indexOf(periods[0]);
 const series=view.series.map(row=>({...row,counts:row.counts.slice(from,from+periods.length),raw:row.raw.slice(from,from+periods.length)}));
 return {...view,periods,series};
}
function scopeOf(view){
 return {start:view.periods[0],end:view.periods.at(-1),monthly:view.monthly,adjusted:view.adjusted,
  combined:view.combined,names:view.names};
}
async function snapshot(view){
 const data=['historic-v1',scopeOf(view),view.periods,view.series.map(row=>[row.name,row.raw,row.counts])];
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function makeView(periods,names,totals,{monthly,adjusted,combined,adjust}){
 names=[...names].sort();
 const series=(combined?['Combined']:names).map(name=>{
  const raw=periods.map(period=>combined?sum(names.map(key=>totals[key]?.get(period)||0)):totals[name]?.get(period)||0);
  return {name,raw,counts:raw.map((count,i)=>Math.round(adjust(periods[i],count)*100)/100)};
 });
 return {periods,names,series,monthly,adjusted,combined};
}
function candidates(view){
 const {series,periods,monthly}=view;
 if(periods.length<4||!series.length||!view.names.every(cleanName))return [];
 const unit=monthly?'month':'week', count=periods.length;
 const total=periods.map((_,i)=>sum(series.map(row=>row.counts[i])));
 const raw=periods.map((_,i)=>sum(series.map(row=>row.raw[i])));
 if(sum(raw)<30)return [];
 const selected=series.map(row=>[row,sum(row.counts),sum(row.raw)]).filter(row=>row[2]>=30).sort(descending);
 const cards=[];
 const add=(title,icon,...bullets)=>{if(bullets.length>=2)cards.push({title,icon,bullets:bullets.slice(0,3)});};
 const trend=(length,title)=>{
  if(count<2*length)return;
  const early=total.slice(-2*length,-length),late=total.slice(-length);
  if(sum(raw.slice(-2*length,-length))<30||sum(raw.slice(-length))<30||!sum(early))return;
  const change=Math.round(100*(average(late)/average(early)-1));
  add(title,'trend',
   'The final '+length+' '+unit+'s averaged **'+number(average(late))+' bookings** per '+unit+'.',
   change?'That was **'+number(Math.abs(change))+'% '+(change>0?'higher':'lower')+'** than the preceding '+length+' '+unit+'s.':
    'The two periods had **roughly the same weekly average**.'.replace('weekly',monthly?'monthly':'weekly'));
 };
 trend(monthly?2:4,'Recent booking trend');
 if(count>=(monthly?8:18)){
  const length=Math.floor(count/2),first=total.slice(0,length),last=total.slice(-length);
  if(sum(raw.slice(0,length))>=30&&sum(raw.slice(-length))>=30&&sum(first)>0){
   const change=Math.round(100*(average(last)/average(first)-1));
   add('Longer-term trend','trend',
    'The first '+length+' '+unit+'s averaged **'+number(average(first))+' bookings** per '+unit+'.',
    'The final '+length+' averaged **'+number(average(last))+'**'+(change?', '+number(Math.abs(change))+'% '+(change>0?'higher':'lower')+'.':', broadly in line with that.') );
  }
 }
 if(selected.length>1){
  const [first,second]=selected;
  add('Appointment mix','mix',
   '**'+first[0].name+'** led among reportable types, averaging '+number(first[1]/count)+' bookings per '+unit+'.',
   '**'+second[0].name+'** followed at '+number(second[1]/count)+' per '+unit+'.');
  const len=Math.floor(count/2);
  const selectedTotals=periods.map((_,i)=>sum(selected.map(([row])=>row.counts[i])));
  const before=sum(selectedTotals.slice(0,len)),after=sum(selectedTotals.slice(-len));
  const shifts=selected.filter(([row])=>sum(row.raw.slice(0,len))>=30&&sum(row.raw.slice(-len))>=30).map(([row])=>{
   const a=100*sum(row.counts.slice(0,len))/before,b=100*sum(row.counts.slice(-len))/after;
   return {name:row.name,a,b,gap:Math.round(b-a)};
  }).filter(row=>Number.isFinite(row.gap)&&Math.abs(row.gap)>=3).sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap));
  if(shifts.length){
   const top=shifts[0];
   add('Change in appointment mix','mix',
    '**'+top.name+'** had the biggest share change among reportable types.',
    'Its share went from **'+number(top.a)+'% to '+number(top.b)+'%** between the first and final '+len+' '+unit+'s.');
  }
 }
 const ranked=total.map((value,i)=>[i,value]).filter(([i])=>raw[i]>=10).sort(descending);
 if(ranked.length>=4){
  const [peak,high]=ranked[0], [lowIndex,low]=ranked.at(-1);
  if(high>low){
   add('Busiest '+unit,'peak',
    '**'+labelDate(periods[peak],monthly)+'** had the most bookings, at '+number(high)+'.',
    'Across the selected period, the average was **'+number(average(total))+' bookings** per '+unit+'.');
   if(high>=low*1.25)add('Variation across '+unit+'s','peak',
    'The quietest reportable '+unit+' was **'+labelDate(periods[lowIndex],monthly)+'**, with '+number(low)+' bookings.',
    'The difference between the busiest and quietest was **'+number(high-low)+' bookings**.');
  }
 }
 if(selected.length===1&&series.length===1){
  add('Booking activity','people',
   'We saw **'+number(sum(total))+' bookings** across the '+count+' complete reporting '+unit+'s.',
   'The selected line averaged **'+number(average(total))+' bookings** per '+unit+'.');
 }
 return cards;
}

function selectRanges(periods){
 if(!periods.length)return [];
 const last=periods.at(-1).slice(0,7);
 const [year,month]=last.split('-').map(Number);
 const monthsBack=months=>new Date(Date.UTC(year,month-months,1)).toISOString().slice(0,7);
 const years=[...new Set(periods.map(p=>p.slice(0,4)))].slice(-4).reverse();
 return [[periods[0],periods.at(-1)],...years.map(year=>[year+'-01',year+'-12\uffff']),
  ...[3,6,12].map(months=>[monthsBack(months),periods.at(-1)])];
}
async function prepare(current,allViews,known){
 const views=[current], out=[];
 const groups=allViews.map(view=>({view,ranges:selectRanges(view.periods)}));
 // Cover the full-history view for every preset before filling narrower date windows.
 for(let i=0;i<8;i++)for(const {view,ranges} of groups){
  if(ranges[i])views.push(sliceView(view,...ranges[i]));
 }
 const seen=new Set();
 for(const view of views){
  const facts=candidates(view);
  if(!facts.length||view.names.length>24)continue;
  const key=await snapshot(view);
  if(seen.has(key))continue;
  seen.add(key);
  if(!known.has(key))out.push({snapshot:key,scope:scopeOf(view),candidates:facts});
  if(seen.size>=144)break;
 }
 return out;
}
const state={rows:new Map(),ready:false,busy:false,message:'',view:null,token:0};
function similarScope(view,scope){
 return scope.monthly===view.monthly&&scope.adjusted===view.adjusted&&scope.combined===view.combined&&
  JSON.stringify(scope.names)===JSON.stringify(view.names);
}
async function match(view,rows){
 if(!view?.periods.length||!view.series.length)return null;
 const key=await snapshot(view);
 if(rows.has(key))return rows.get(key);
 const eligible=[...rows.values()].filter(({scope})=>similarScope(view,scope)&&
  scope.start>=view.periods[0]&&scope.end<=view.periods.at(-1))
  .sort((a,b)=>(Date.parse(b.scope.end)-Date.parse(b.scope.start))-(Date.parse(a.scope.end)-Date.parse(a.scope.start))||
   b.scope.end.localeCompare(a.scope.end));
 for(const row of eligible){
  const slice=sliceView(view,row.scope.start,row.scope.end);
  if(slice.periods[0]===row.scope.start&&slice.periods.at(-1)===row.scope.end&&await snapshot(slice)===row.snapshot)return row;
 }
 return null;
}

const byId=id=>document.getElementById(id);
function formatBullet(text){
 const li=document.createElement('li');
 text.split('**').forEach((part,index)=>{
  if(index%2){const bold=document.createElement('b');bold.textContent=part;li.append(bold);}
  else li.append(part);
 });
 return li;
}
function paint(){
 const id=++state.token,bridge=window.parent.DarwinAnalytics;
 const section=byId('historicAiInsights');
 if(!section)return;
 const button=byId('historicAiGenerate'), status=byId('historicAiStatus');
 section.hidden=!bridge?.readHistoricInsights;
 if(section.hidden)return;
 button.hidden=!bridge.manage;
 button.disabled=state.busy||!state.ready||!state.view?.periods.length;
 byId('historicAiCards').replaceChildren();
 byId('historicAiScope').textContent='';
 status.textContent=state.message||state.loadError||(!state.ready?'Loading saved insights…':'');
 void match(state.view,state.rows).then(row=>{
  if(id!==state.token)return;
  if(!row){
   if(state.ready&&!state.busy&&!state.loadError){
    const empty=state.rows.size?'No saved insights match this chart view.':'Saved insights will appear after a practice administrator generates them.';
    status.textContent=[state.message,empty].filter(Boolean).join(' ');
   }
   return;
  }
  const {scope,cards}=row;
  const qualifier=scope.start===state.view.periods[0]&&scope.end===state.view.periods.at(-1)?'':'Saved period · ';
  byId('historicAiScope').textContent=qualifier+labelDate(scope.start,scope.monthly)+' to '+labelDate(scope.end,scope.monthly);
  for(const card of cards){
   const article=document.createElement('article');
   const icon=document.createElement('img');
   const icons={mix:'seasonal-demand',trend:'demand-trend',peak:'peak-demand',people:'forward-availability'};
   icon.src='assets/home-insights/fine-rim-'+(icons[card.icon]||'demand-trend')+'.png';
   icon.alt='';
   const h=document.createElement('h3');h.textContent=card.title;
   const list=document.createElement('ul');
   list.append(...card.bullets.map(formatBullet));
   article.append(icon,h,list);
   byId('historicAiCards').append(article);
  }
 }).catch(()=>{if(id===state.token)status.textContent='Saved insights are unavailable.';});
}
let loadPromise;
function update(view,getPresets){
 if(state.ready&&!state.busy)state.message='';
 state.view=view;
 state.getPresets=getPresets;
 const bridge=window.parent.DarwinAnalytics;
 if(bridge?.readHistoricInsights&&!loadPromise){
  loadPromise=bridge.readHistoricInsights().then(rows=>{state.rows=new Map(rows.map(row=>[row.snapshot,row]));})
   .catch(()=>{state.loadError='Could not load saved insights.';}).finally(()=>{state.ready=true;paint();});
  byId('historicAiGenerate').onclick=generate;
 }
 paint();
}
async function generate(){
 const bridge=window.parent.DarwinAnalytics;
 if(state.busy||!bridge?.manage||!state.view)return;
 const current=state.view,getPresets=state.getPresets;
 state.busy=true;
 state.message='Preparing chart views…';paint();
 try {
  const missing=await prepare(current,getPresets(),state.rows);
  for(let i=0;i<missing.length;i+=batchSize){
   state.message='Generating saved insights · '+i+' of '+missing.length+' views';paint();
   const started=Date.now();
   const {rows}=await bridge.generateHistoricInsights(missing.slice(i,i+batchSize));
   for(const row of rows)state.rows.set(row.snapshot,row);
   if(i+batchSize<missing.length){
    const wait=Math.max(0,2200-(Date.now()-started));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   }
  }
  state.message=missing.length?'Saved insights updated for '+missing.length+' chart views.':
   (state.rows.size?'Saved insights are up to date.':'There is too little data to generate insights for these views.');
 }catch(error){state.message=error.message||'Some views could not be generated. Try again to finish the remaining views.';}
 finally{state.busy=false;paint();}
}
window.GPHistoricInsights={makeView,update};
})();
