(function(){
'use strict';
const days=['Monday','Tuesday','Wednesday','Thursday','Friday'];
const kinds={minimum:'Session limits',share:'Clinician appointment share',mix:'Appointment mix',distribution:'Weekly appointment distribution',sessionDistribution:'Session spread'};
const fmt=n=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(n);
function ruleLabel(rule,types){
 const name=types.find(t=>t.id===rule.sessionTypeId)?.name||'session type';
 if(rule.kind==='minimum')return name+' · '+(rule.minimum==null?'no minimum':'minimum '+rule.minimum)+' / '+(rule.maximum==null?'no maximum':'maximum '+rule.maximum)+' · '+(rule.scope==='week'?'weekly':'per '+(rule.scope==='day'?'day':rule.scope));
 const subject=rule.shareSubject?.name||rule.clinicianGroup||'';
 return (kinds[rule.kind]||'Rule')+' · '+[subject,(rule.appointmentTypes||[]).join(' + ')].filter(Boolean).join(' · ');
}
function analyse(types=[],modes=[],groups=[],demand,rules=[],options={}){
 const issues=[],checks=[],add=(level,title,detail,target='rules',ruleId)=>issues.push({level,title,detail,target,ruleId});
 if(!demand)return {issues:[{level:'confirmed',title:'Demand is unavailable',detail:'The urgent forecast must load before a session plan can be calculated.',target:'planner'}],checks};
 const clinicians=options.clinicians||{},limits=options.clinicianLimits||{},pools=new Map(Object.entries(options.appointmentPools||{}));
 for(const [pool,names]of Object.entries(demand.types||{}))for(const name of names||[])if(!pools.has(name))pools.set(name,pool);
 for(const name of demand.eligibleDailyTypes||[])if(!pools.has(name))pools.set(name,'sameDay');
 for(const name of demand.eligiblePlannedTypes||[])pools.set(name,'planned');
 const required=rules.filter(r=>r.enabled&&r.strength==='must'),candidates=[];
 const available=(name,day,period)=>{const pattern=limits[name]?.workingPattern;return !Array.isArray(pattern)||pattern.some(p=>p.startsWith(days[day].slice(0,3)+' ')&&(!period||p.endsWith(period==='morning'?'AM':'PM')));};
 for(const [name,group]of Object.entries(clinicians)){
  if(!groups.includes(group))continue;const limit=limits[name]||{};
  if(limit.max!=null&&limit.max<(limit.min||0))add('confirmed',name+': minimum exceeds maximum','Clinician Setup requires '+limit.min+' sessions/week but permits only '+limit.max+'.','clinician');
  if((limit.min||0)>0&&Array.isArray(limit.workingPattern)&&!limit.workingPattern.length)add('confirmed',name+': no available working days','The clinician has a minimum of '+limit.min+' sessions/week and an empty working pattern.','clinician');
  if(limit.max===0||Array.isArray(limit.workingPattern)&&!limit.workingPattern.length)continue;
  const eligible=types.filter(t=>(t.eligibleClinicians||[]).includes(name));
  if((limit.min||0)>0&&!eligible.length)add('confirmed',name+': no eligible session type','The minimum is '+limit.min+' sessions/week, but no session type can be assigned to this clinician.','types');
  if(eligible.length&&(typeof limit.annualRate!=='number'||!Number.isFinite(limit.annualRate)||limit.annualRate<0))add('confirmed',name+': annualised rate is missing','Enter an annualised sessional rate in Clinician Setup. A missing rate cannot be treated as zero.','clinician');
  const availability=(52-(limit.annualLeaveWeeks??5))/52*(1-(limit.sicknessPercent??0)/100);
  for(const type of eligible){
   let nonHome=0,home=0;for(const mode of modes){const n=type.appointmentsByMode?.[mode]||0;if(window.SessionBuilderPlanning?.isHomeVisit(mode)||/home\s*visit/i.test(mode))home+=n;else nonHome+=n;}
   const allowed=[...pools].filter(([name,pool])=>pool&&(!Array.isArray(type.appointmentTypes)||type.appointmentTypes.includes(name)));
   candidates.push({name,type,nonHome:nonHome*availability,home:home*availability,allowed});
  }
 }
 for(const type of types){const eligible=candidates.filter(c=>c.type.id===type.id);if(!eligible.length)continue;
  for(const [mode,field,home]of [['home-visit','home',true],['face-to-face / phone','nonHome',false]])if(eligible.some(c=>c[field]>0)&&!eligible.some(c=>c.allowed.some(([,pool])=>(pool==='homeVisit')===home)))add('review',type.name+': '+mode+' capacity has no eligible appointment type','This session has '+mode+' capacity, but its selected appointment types do not offer that category. Check Session Setup.','types');
 }
 const upper=(pool,day)=>{
  let total=0;
  for(const name of Object.keys(clinicians)){const limit=limits[name]||{};
   const choices=candidates.filter(c=>c.name===name&&(day==null?days.some((_,d)=>available(name,d)):available(name,day))&&c.allowed.some(([,p])=>pool==='all'||p===pool));
   if(!choices.length)continue;
   const cap=Math.max(...choices.map(c=>pool==='homeVisit'?c.home:pool==='all'?c.nonHome+c.home:c.nonHome));if(cap<=0)continue;
   if(limit.max==null)return Infinity;total+=Math.floor(cap*limit.max+1e-7);
  }return total;
 };
 const targets=[...days.flatMap((day,d)=>[['sameDay',d,demand.sameDay?.[d]||0,day+' urgent appointments'],['homeVisit',d,demand.homeVisit?.[d]||0,day+' home visits']]),['weekly',null,demand.weekly||0,'Weekly urgent allocation'],['routine',null,demand.routine||0,'Weekly routine allocation'],['planned',null,demand.planned||0,'Weekly planned-care allocation']];
 for(const [pool,day,need,title]of targets){if(need<=0)continue;const ceiling=upper(pool,day),requiredSlots=Math.ceil(need);
  if(ceiling<requiredSlots)add('confirmed',title+': capacity shortfall','Need '+requiredSlots+' whole appointments; eligible clinicians can provide at most '+fmt(ceiling)+' under their weekly maxima and working patterns, even before sharing their sessions with other demand.','clinician');
  checks.push(title+': need '+requiredSlots+'; '+(Number.isFinite(ceiling)?'optimistic capacity ceiling '+fmt(ceiling):'capacity ceiling is unrestricted because an eligible clinician has no weekly maximum')+'.');
 }
 const totalNeed=targets.reduce((n,t)=>n+Math.ceil(t[2]),0),totalUpper=upper('all',null);
 if(totalUpper<totalNeed)add('confirmed','Total appointment capacity is below demand','Need at least '+totalNeed+' appointments/week; the optimistic total capacity ceiling is '+fmt(totalUpper)+'. Individual appointment categories share those sessions.','clinician');
 const bounds=required.filter(r=>r.kind==='minimum'),weekly=new Map();
 for(const rule of bounds){
  const type=types.find(t=>t.id===rule.sessionTypeId),label=ruleLabel(rule,types);
  if(!type){add('confirmed','A session rule refers to a removed type',label,'rules',rule.id);continue;}
  if(rule.minimum!=null&&rule.maximum!=null&&rule.minimum>rule.maximum){add('confirmed',type.name+': conflicting bounds',label,'rules',rule.id);continue;}
  let state=weekly.get(type.id);if(!state){state={name:type.name,day:Array(5).fill(0),morning:Array(5).fill(0),afternoon:Array(5).fill(0),week:0,rules:[]};weekly.set(type.id,state);}state.rules.push(rule.id);
  if(rule.scope==='week')state.week=Math.max(state.week,rule.minimum||0);else for(const d of rule.days||[])for(const p of rule.scope==='both'?['morning','afternoon']:[rule.scope])state[p][d-1]=Math.max(state[p][d-1],rule.minimum||0);
  if((rule.minimum||0)>0){const scopes=rule.scope==='week'?[null]:rule.days.map(d=>d-1);for(const day of scopes){
   const names=[...new Set(candidates.filter(c=>c.type.id===type.id&&(day==null?(rule.days||[]).some(d=>available(c.name,d-1)):available(c.name,day,['morning','afternoon'].includes(rule.scope)?rule.scope:null))).map(c=>c.name))];
   const cap=names.reduce((n,name)=>n+(limits[name]?.max??Infinity),0);if(cap<rule.minimum)add('confirmed',type.name+': required sessions cannot be staffed',(day==null?'Selected week':days[day])+': rule needs '+rule.minimum+' sessions; available eligible clinicians permit at most '+fmt(cap)+'.','rules',rule.id);
  }}
 }
 for(const state of weekly.values())state.minimum=Math.max(state.week,state.day.reduce((n,v,d)=>n+Math.max(v,state.morning[d]+state.afternoon[d]),0));
 for(const rule of bounds)if(rule.maximum!=null){const state=weekly.get(rule.sessionTypeId);if(!state)continue;
  const needed=rule.scope==='week'?Math.max(0,...bounds.filter(r=>r.sessionTypeId===rule.sessionTypeId&&r.scope==='week'&&(r.days||[]).every(d=>(rule.days||[]).includes(d))).map(r=>r.minimum||0),(rule.days||[]).reduce((n,d)=>n+Math.max(state.day[d-1],state.morning[d-1]+state.afternoon[d-1]),0)):Math.max(0,...(rule.days||[]).map(d=>rule.scope==='day'?Math.max(state.day[d-1],state.morning[d-1]+state.afternoon[d-1]):rule.scope==='both'?Math.max(state.morning[d-1],state.afternoon[d-1]):state[rule.scope]?.[d-1]||0));
  if(needed>rule.maximum)add('confirmed',state.name+': session rules contradict one another','Other required rules imply at least '+needed+' sessions in this scope, but '+ruleLabel(rule,types)+' permits at most '+rule.maximum+'.','rules',rule.id);
 }
 // A small max-flow check detects required session minima competing for the same clinician maxima.
 const needs=[...weekly].filter(([,s])=>s.minimum>0),names=Object.keys(clinicians),size=needs.length+names.length+2,source=size-2,sink=size-1,graph=Array.from({length:size},()=>[]),edge=(a,b,cap)=>{graph[a].push({to:b,cap,rev:graph[b].length});graph[b].push({to:a,cap:0,rev:graph[a].length-1});};
 const requiredTotal=needs.reduce((n,[,s])=>n+s.minimum,0);
 needs.forEach(([id,state],i)=>{edge(source,i,state.minimum);for(const name of new Set(candidates.filter(c=>c.type.id===id&&days.some((_,d)=>available(c.name,d))).map(c=>c.name)))edge(i,needs.length+names.indexOf(name),requiredTotal);});
 names.forEach((name,i)=>edge(needs.length+i,sink,Math.max(0,limits[name]?.max??requiredTotal)));let staffed=0;
 while(requiredTotal>staffed){const prev=Array(size).fill(null),queue=[source];prev[source]=[];for(let q=0;q<queue.length&&!prev[sink];q++)for(let i=0;i<graph[queue[q]].length;i++){const e=graph[queue[q]][i];if(e.cap>0&&!prev[e.to]){prev[e.to]=[queue[q],i];queue.push(e.to);}}if(!prev[sink])break;let amount=Infinity;for(let n=sink;n!==source;n=prev[n][0])amount=Math.min(amount,graph[prev[n][0]][prev[n][1]].cap);for(let n=sink;n!==source;n=prev[n][0]){const e=graph[prev[n][0]][prev[n][1]];e.cap-=amount;graph[n][e.rev].cap+=amount;}staffed+=amount;}
 if(staffed<requiredTotal)add('confirmed','Required sessions exceed shared clinician limits','Session rules require at least '+requiredTotal+' sessions/week across '+needs.map(([,s])=>s.name).join(', ')+'. Eligible clinician maxima can cover only '+staffed+' of those obligations; at least '+(requiredTotal-staffed)+' cannot be assigned.','clinician');
 checks.push(required.length+' required rules and '+Object.keys(clinicians).length+' clinician types checked for direct capacity, eligibility, working-pattern and session-limit conflicts.');
 return {issues,checks};
}
function checkModel(model,ruleSources,deadline){
 const solver=window.solver;if(!solver?.Solve)return null;
 const test=removed=>{const constraints=Object.fromEntries(Object.entries(model.constraints).filter(([id])=>!removed.has(id)).map(([id,bounds])=>[id,{...bounds}])),variables=Object.fromEntries(Object.entries(model.variables).map(([id,data])=>[id,Object.fromEntries(Object.entries(data).filter(([key])=>!removed.has(key)))]));return solver.Solve({...model,constraints,variables,ints:{},options:{...model.options,timeout:Math.max(1,deadline-Date.now()),tolerance:0}},1e-8,true);};
 try{const result=test(new Set());if(result.feasible&&result.bounded){const values=result.generateSolutionSet(),fractional=Object.keys(model.variables).filter(id=>model.ints?.[id]&&Math.abs((values[id]||0)-Math.round(values[id]||0))>1e-6),fractionalRules=ruleSources.filter(source=>fractional.some(id=>source.constraints.some(key=>model.variables[id][key]))).map(({id,label})=>({id,label}));return {status:'relaxation-feasible',fractionalDecisionCount:fractional.length,fractionalRules,detail:'The fractional-capacity check passed. A whole-session, whole-appointment plan has not been verified; no specific conflicting rule has been proven by this check.'};}if(result.feasible)return {status:'unknown'};
  let removed=new Set(),core=[...ruleSources];for(const source of ruleSources){if(Date.now()>=deadline)break;const trial=new Set([...removed,...source.constraints]);const r=test(trial);if(!r.feasible){removed=trial;core=core.filter(s=>s!==source);}}
  return {status:'conflict',rules:core.map(({id,label})=>({id,label})),detail:core.length?'These required rules are jointly incompatible with the current demand, eligibility or clinician capacity, even before requiring whole numbers. Review them together with their dependent settings.':'Demand and available capacity conflict even with planning rules removed. Review clinician maxima, working patterns and session appointment eligibility.'};
 }catch(error){return {status:'unknown',detail:'The additional model check could not finish. No specific conflict has been confirmed.'};}
}
function render(diagnostics,result){
 const root=document.getElementById('sessionBuilderPlanDiagnostics');if(!root)return;root.replaceChildren();root.hidden=!result?.error;if(root.hidden)return;
 const add=(tag,text,parent=root)=>{const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;};
 add('h3','Planner checks');const issues=diagnostics?.issues||[],confirmed=issues.filter(i=>i.level==='confirmed'),reviews=issues.filter(i=>i.level!=='confirmed'),model=diagnostics?.model;
 add('p',confirmed.length||model?.status==='conflict'?'The checks found the following conflicts to review.':result.errorCode==='TIMEOUT'?'The search timed out. These checks have not proven that your settings are impossible.':'No plan was returned. The checks below explain what could be verified.');
 const link=(target,label,parent,ruleId)=>{const button=add('button',label,parent);button.type='button';button.addEventListener('click',()=>{const id={rules:'Rules',types:'Types',clinician:'Clinician',planner:'Planner'}[target]||'Rules';document.getElementById('sessionBuilder'+id+'Tab')?.click?.();if(ruleId){const card=[...(document.querySelectorAll?.('details[data-rule-id]')||[])].find(n=>n.dataset.ruleId===ruleId);if(card){card.open=true;card.querySelector('summary')?.focus?.();card.scrollIntoView?.({block:'center'});}}});};
 for(const [heading,items]of [['Confirmed conflicts',confirmed],['Settings to review',reviews]])if(items.length){add('h4',heading);const list=add('ul','');for(const item of items){const li=add('li','',list);add('strong',item.title,li);add('p',item.detail,li);link(item.target,'Review '+({rules:'Planning Rules',types:'Session Setup',clinician:'Clinician Setup',planner:'Optimised Planner'}[item.target]||'settings'),li,item.ruleId);}}
 if(model?.detail){add('p',model.detail);for(const rule of model.rules||[]){const p=add('p',rule.label);link('rules','Open rule',p,rule.id);}}
 if(model?.fractionalRules?.length){add('h4','Rules involving fractional decisions');add('p','The preliminary solution used fractional values in decisions covered by these rules. These are settings to review; a conflict has not been confirmed.');for(const rule of model.fractionalRules){const p=add('p',rule.label);link('rules','Open rule',p,rule.id);}}
 const checks=diagnostics?.checks||[];if(checks.length){const details=add('details','');add('summary','Checks completed ('+checks.length+')',details);const list=add('ul','',details);for(const check of checks)add('li',check,list);}
 if(!diagnostics)add('p','Detailed checks were unavailable for this attempt. No individual setting has been identified as the cause.');
}
function safeAnalyse(...args){try{return analyse(...args);}catch(error){return {issues:[],checks:['Detailed setting checks could not complete for this attempt.'],unavailable:true};}}
window.SessionBuilderDiagnostics=Object.freeze({analyse:safeAnalyse,checkModel,render,ruleLabel});
})();
