(function(){
'use strict';
const byId=id=>document.getElementById(id);
const scopes=[['morning','Every morning'],['afternoon','Every afternoon'],['both','Morning and afternoon separately'],['day','Each whole day'],['week','Each week']];
const visibleScopes=[['day','Each day'],['week','Each week']];
const dayScope=scope=>scope==='week'?'week':'day';
const presets=[['all','Monday–Friday',[1,2,3,4,5]],['mwf','Monday, Wednesday, Friday',[1,3,5]],['tt','Tuesday, Thursday',[2,4]],...['Monday','Tuesday','Wednesday','Thursday','Friday'].map((name,i)=>[String(i+1),name+' only',[i+1]])];
const configuredGroups=()=>clinicianGroupNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
function validateRules(rules){
 if(!Array.isArray(rules))throw Error('Planning rules must be a list.');
 const ids=new Set();
 for(const rule of rules){
  if(!rule||typeof rule!=='object'||Array.isArray(rule)||typeof rule.id!=='string'||!rule.id||ids.has(rule.id))throw Error('Planning rules require unique identifiers.');ids.add(rule.id);
  if(typeof rule.enabled!=='boolean'||!['minimum','share','mix','distribution','sessionDistribution'].includes(rule.kind)||!scopes.some(([key])=>key===rule.scope)||!['must','prefer'].includes(rule.strength))throw Error('Invalid planning rule type, period or strength.');
  if(!Array.isArray(rule.days)||!rule.days.length||rule.days.some(day=>!Number.isInteger(day)||day<1||day>5)||new Set(rule.days).size!==rule.days.length)throw Error('Choose at least one weekday.');
  if(rule.kind==='minimum'){if([rule.minimum,rule.maximum].some(n=>n!=null&&(!Number.isSafeInteger(n)||n<0)))throw Error('Session limits must be non-negative whole numbers or blank for no limit.');if(rule.minimum!=null&&rule.maximum!=null&&rule.maximum<rule.minimum)throw Error('Maximum sessions must be at least the minimum.');}else if(!Number.isFinite(rule.minimum)||rule.minimum<0||rule.minimum>100)throw Error('Use a percentage between zero and 100.');
  if(rule.kind==='distribution')window.SessionBuilderDistribution.validate(rule);
  if(rule.kind==='sessionDistribution'&&(rule.scope!=='week'||typeof rule.sessionTypeId!=='string'||!Number.isInteger(rule.sessionTolerance)||rule.sessionTolerance<1||rule.sessionTolerance>500))throw Error('Choose weekly session spread and a tolerance of at least one session.');
  if(rule.kind==='minimum'&&typeof rule.sessionTypeId!=='string')throw Error('Choose a session type.');
  if(rule.kind==='share'&&(typeof rule.clinicianGroup!=='string'||!['all','pair'].includes(rule.denominator)||typeof rule.comparisonGroup!=='string'))throw Error('Choose a clinician group and appointment denominator.');
  if(rule.appointmentPool!==undefined&&!['all','urgent','selected'].includes(rule.appointmentPool))throw Error('Choose all or urgent appointments.');
  if(rule.comparison!==undefined&&!['atLeast','atMost','exact'].includes(rule.comparison))throw Error('Choose a valid percentage target.');
  if(rule.appointmentTypes!==undefined&&(!Array.isArray(rule.appointmentTypes)||rule.appointmentTypes.some(name=>typeof name!=='string'||!name.trim())||new Set(rule.appointmentTypes).size!==rule.appointmentTypes.length))throw Error('Choose valid appointment types.');
  const validRef=ref=>ref&&typeof ref==='object'&&!Array.isArray(ref)&&['group','type'].includes(ref.kind)&&typeof ref.name==='string'&&!!ref.name.trim();
  if(rule.shareSubject!==undefined&&!validRef(rule.shareSubject))throw Error('Choose a clinician group or type.');
  if(rule.denominatorSelections!==undefined&&(!Array.isArray(rule.denominatorSelections)||rule.denominatorSelections.length>2||rule.denominatorSelections.some(ref=>!validRef(ref))||new Set(rule.denominatorSelections.map(ref=>JSON.stringify([ref.kind,ref.name]))).size!==rule.denominatorSelections.length))throw Error('Choose up to two distinct denominator selections.');
 }
 return true;
}
window.validateSessionBuilderRules=validateRules;
function issuesFor(rule,types,groups){
 if(!rule.enabled)return [];
 const issues=[];
 if(rule.kind==='distribution'){const issue=window.SessionBuilderDistribution.issue(rule,groupUrgencyNames);return issue?[issue]:[];}
 if(rule.kind==='sessionDistribution')return rule.sessionTypeId&&!types.some(type=>type.id===rule.sessionTypeId)?['The session type has been removed; choose another.']:[];
 if(rule.kind==='minimum'&&!types.some(type=>type.id===rule.sessionTypeId))issues.push('Choose an existing session type.');
 if(rule.kind==='share'||rule.kind==='mix'){
  const planning=window.SessionBuilderPlanning,subject=planning.shareSubject(rule),denominators=rule.kind==='mix'?[]:planning.shareDenominators(rule),clinicians=typeof clinicianCategoryNames==='undefined'?[]:clinicianCategoryNames;
  const valid=ref=>ref?.kind==='group'?groups.includes(ref.name):ref?.kind==='type'&&clinicians.includes(ref.name);
  if(!valid(subject))issues.push('Choose an existing clinician group or type.');
  if((rule.kind==='mix'||rule.appointmentPool==='selected')&&(!Array.isArray(rule.appointmentTypes)||!rule.appointmentTypes.length))issues.push('Choose at least one appointment type.');
  if(Array.isArray(rule.appointmentTypes)&&rule.appointmentTypes.some(name=>!groupUrgencyNames.includes(name)))issues.push('An appointment type has been removed; update the rule.');
  if(denominators.some(ref=>!valid(ref)))issues.push('Choose existing clinician groups or types for the denominator.');
  const mapping=typeof clinicianGroupAssignments==='undefined'?{}:clinicianGroupAssignments;
  const matches=(name,ref)=>ref.kind==='type'?name===ref.name:mapping[name]===ref.name;
  if(denominators.length&&valid(subject)&&clinicians.some(name=>matches(name,subject)&&!denominators.some(ref=>matches(name,ref))))issues.push('The denominator must include the selected clinician or group.');

 }
 return issues;
}
window.sessionBuilderRuleIssues=issuesFor;
window.renameSessionBuilderRuleGroup=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderRules=sessionBuilderRules.map(rule=>(rule.kind==='share'||rule.kind==='mix')?{...rule,clinicianGroup:rule.clinicianGroup===oldName?newName:rule.clinicianGroup,comparisonGroup:rule.comparisonGroup===oldName?newName:rule.comparisonGroup, ...(rule.shareSubject?.kind==='group'&&rule.shareSubject.name===oldName?{shareSubject:{kind:'group',name:newName}}:{}), ...(Array.isArray(rule.denominatorSelections)?{denominatorSelections:rule.denominatorSelections.map(ref=>ref.kind==='group'&&ref.name===oldName?{...ref,name:newName}:ref)}:{})}:rule);
};
window.renameSessionBuilderRuleClinicianType=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderRules=sessionBuilderRules.map(rule=>(rule.kind==='share'||rule.kind==='mix')?{...rule,...(rule.shareSubject?.kind==='type'&&rule.shareSubject.name===oldName?{shareSubject:{kind:'type',name:newName}}:{}),...(Array.isArray(rule.denominatorSelections)?{denominatorSelections:rule.denominatorSelections.map(ref=>ref.kind==='type'&&ref.name===oldName?{...ref,name:newName}:ref)}:{})}:rule);
};
window.renameSessionBuilderRuleAppointmentType=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderRules=sessionBuilderRules.map(rule=>Array.isArray(rule.appointmentTypes)?{...rule,appointmentTypes:rule.appointmentTypes.map(name=>name===oldName?newName:name)}:rule);
};
function commit(rules){
 if(!canEditSessionBuilder())throw Error('Practice administrator access is required.');
 validateRules(rules);sessionBuilderRules=rules.map(rule=>({...rule,days:[...rule.days]}));markCategoryDirty();window.renderSessionBuilderRequirements?.();
}
function select(label,options,value,onChange){
 const input=document.createElement('select');input.setAttribute('aria-label',label);
 if(!options.some(([key])=>key===value)&&value){const missing=document.createElement('option');missing.value=value;missing.textContent=label.startsWith('Required session type')?'Removed session type — choose another':'Removed: '+value;input.append(missing);}
 for(const [key,name] of options){const option=document.createElement('option');option.value=key;option.textContent=name;input.append(option);}input.value=value;
 input.addEventListener('change',()=>{try{onChange(input.value)}catch(error){input.value=value;byId('sessionBuilderRulesSaveStatus').textContent=error.message;}});return input;
}
function text(value){const span=document.createElement('span');span.textContent=value;return span;}
function patch(rule,key,value){
 const next=sessionBuilderRules.map(item=>item.id===rule.id?{...item,...((key==='shareSubject'||key==='denominatorSelections')&&item.appointmentPool===undefined?{appointmentPool:window.SessionBuilderPlanning.sharePool(item)}:{}),[key]:value}:item);
 commit(next);renderSessionBuilderRules();
}
function inspectRules(){
 const groups=configuredGroups(),messages=[];
 for(const rule of sessionBuilderRules)for(const issue of issuesFor(rule,sessionBuilderTypes,groups))messages.push({id:rule.id,message:issue});
 // Percentages for distinct groups over the same all-appointment denominator
 // cannot sum above 100 in a single period. Duplicate rules use their maximum.
 for(const day of [1,2,3,4,5])for(const period of ['day']){
  const pools=new Map();
  for(const rule of sessionBuilderRules){
   if(!rule.enabled||rule.strength!=='must'||rule.kind!=='share'||rule.shareSubject||rule.denominatorSelections||!rule.days.includes(day)||dayScope(rule.scope)!==period||issuesFor(rule,sessionBuilderTypes,groups).length)continue;
   const key=window.SessionBuilderPlanning.sharePool(rule)+':'+(rule.denominator==='all'?'all':JSON.stringify([rule.clinicianGroup,rule.comparisonGroup].sort()));
   if(!pools.has(key))pools.set(key,new Map());const lower=pools.get(key);lower.set(rule.clinicianGroup,Math.max(lower.get(rule.clinicianGroup)||0,rule.minimum));
  }
  for(const lower of pools.values()){const total=[...lower.values()].reduce((sum,n)=>sum+n,0);
   if(total>100+1e-9)messages.push({id:'conflict-'+day+'-'+period,message:['Monday','Tuesday','Wednesday','Thursday','Friday'][day-1]+' '+period+': required clinician shares over the same appointment pool sum to '+total+'%, which exceeds 100%.'});
  }
 }
 return messages;
}
window.inspectSessionBuilderRules=inspectRules;
const openRules=new Set();
function ruleSummary(rule){
 const when=(presets.find(([, ,days])=>JSON.stringify([...rule.days].sort())===JSON.stringify(days))?.[1]||'Selected days')+' · '+(visibleScopes.find(([key])=>key===dayScope(rule.scope))?.[1]||'Each day'),strength=rule.strength==='must'?'Must meet':'Prefer';
 if(rule.kind==='sessionDistribution'){const name=rule.sessionTypeId?sessionBuilderTypes.find(type=>type.id===rule.sessionTypeId)?.name||'Removed session type':'Each session type';return name+' · roughly even spread · ±'+rule.sessionTolerance+' session'+(rule.sessionTolerance===1?'':'s')+' · '+when+' · '+strength;}
 if(rule.kind==='distribution'){
  const allocation=rule.appointmentTypes?.[0]||'Choose allocation',spread=rule.distributionMode==='custom'?rule.days.map(day=>['Mon','Tue','Wed','Thu','Fri'][day-1]+' '+(rule.distributionTargets?.[day]||0)+'%').join(', '):'Even spread';
  return allocation+' · '+spread+' · ±'+(rule.distributionTolerance??5)+' percentage points · '+when+' · '+strength;
 }
 if(rule.kind==='minimum'){const session=sessionBuilderTypes.find(type=>type.id===rule.sessionTypeId)?.name||'Choose session type';const limits=rule.minimum==null&&rule.maximum==null?'No minimum or maximum':rule.minimum==null?'At most '+rule.maximum:rule.maximum==null?'At least '+rule.minimum:rule.minimum===rule.maximum?'Exactly '+rule.minimum:rule.minimum+'–'+rule.maximum;return limits+' '+session+' sessions · '+when+' · '+strength;}
 const subject=window.SessionBuilderPlanning.shareSubject(rule),target=({'atLeast':'At least','atMost':'At most','exact':'Exactly'}[rule.comparison||'atLeast']),types=rule.kind==='mix'||rule.appointmentPool==='selected'?(rule.appointmentTypes||[]).join(' + ')||'choose appointment types':window.SessionBuilderPlanning.sharePool(rule)==='urgent'?'urgent':'all';
 if(rule.kind==='mix')return target+' '+rule.minimum+'% of '+subject.name+' appointments are '+types+' · '+when+' · '+strength;
 const refs=window.SessionBuilderPlanning.shareDenominators(rule),total=refs.length?refs.map(ref=>(ref.kind==='group'?'All ':'')+ref.name).join(' + '):'all clinicians';return target+' '+rule.minimum+'% of '+types+' appointments by '+total+' are provided by '+subject.name+' · '+when+' · '+strength;
}
function renderSessionBuilderRules(){
 const page=byId('sessionBuilderRulesPanel'),body=byId('sessionBuilderRulesBody');if(!page||!body)return;
 if(!canEditSessionBuilder()){page.hidden=true;body.replaceChildren();return;}
 const groups=configuredGroups();body.replaceChildren();
 const ruleGroups=new Map();
 for(const [kind,title] of [['minimum','Session limits'],['share','Clinician appointment share'],['mix','Appointment mix'],['distribution','Weekly appointment distribution'],['sessionDistribution','Session spread']]){
  const count=sessionBuilderRules.filter(rule=>rule.kind===kind).length;if(!count)continue;
  const section=document.createElement('section'),heading=document.createElement('h4'),badge=document.createElement('span'),list=document.createElement('div');section.className='session-rule-group';section.dataset.ruleKind=kind;heading.textContent=title;badge.className='session-rule-group-count';badge.textContent=String(count);heading.append(badge);list.className='session-rule-group-list';section.append(heading,list);body.append(section);ruleGroups.set(kind,list);
 }
 for(const rule of sessionBuilderRules){
  const ruleNumber=sessionBuilderRules.indexOf(rule)+1;
  const details=document.createElement('details'),summary=document.createElement('summary'),row=document.createElement('div');details.dataset.ruleId=rule.id;details.className='session-rule-card';details.open=openRules.has(rule.id);summary.textContent=(rule.enabled?'':'Off · ')+ruleSummary(rule);details.append(summary);row.className='session-rule-controls';details.addEventListener('toggle',()=>{if(details.open)openRules.add(rule.id);else openRules.delete(rule.id);});
  const enabled=document.createElement('div'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=rule.enabled;toggle.setAttribute('aria-label','Enable rule '+(sessionBuilderRules.indexOf(rule)+1));toggle.addEventListener('change',()=>{try{patch(rule,'enabled',toggle.checked)}catch(error){toggle.checked=!toggle.checked;byId('sessionBuilderRulesSaveStatus').textContent=error.message;}});enabled.append(toggle);row.append(enabled);
  const when=document.createElement('div');when.append(select('Period for rule '+ruleNumber,['distribution','sessionDistribution'].includes(rule.kind)?[['week','Each week']]:visibleScopes,dayScope(rule.scope),value=>patch(rule,'scope',value)));
  const preset=presets.find(([, ,days])=>JSON.stringify([...rule.days].sort())===JSON.stringify(days));
  const dayOptions=presets.map(([key,label])=>[key,label]);if(!preset)dayOptions.push(['custom','Custom: '+rule.days.map(day=>['Mon','Tue','Wed','Thu','Fri'][day-1]).join(', ')]);
  when.append(select('Weekdays for rule '+ruleNumber,dayOptions,preset?.[0]||'custom',key=>{const choice=presets.find(([id])=>id===key);if(choice){if(rule.kind==='distribution')commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,days:[...choice[2]],distributionTargets:window.SessionBuilderDistribution.initialTargets(choice[2])}:item));else patch(rule,'days',[...choice[2]]);renderSessionBuilderRules();}}));row.append(when);
  const requirement=document.createElement('div');
  requirement.append(select('Rule type '+ruleNumber,[['minimum','Session limits'],['share','Clinician appointment share'],['mix','Appointment mix'],['distribution','Weekly appointment distribution'],['sessionDistribution','Session spread']],rule.kind,kind=>{
   commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,kind,...(kind==='distribution'?{scope:'week',distributionMode:'even',distributionTolerance:5,distributionTargets:{}}:kind==='sessionDistribution'?{scope:'week',sessionTolerance:1}:{}),maximum:null,minimum:kind==='minimum'?1:['distribution','sessionDistribution'].includes(kind)?0:50,comparison:'atLeast',appointmentTypes:kind==='mix'?(groupUrgencyNames.includes('Routine')?['Routine']:[]):[],sessionTypeId:kind==='sessionDistribution'?'':sessionBuilderTypes[0]?.id||'',clinicianGroup:groups[0]||'',denominator:'all',comparisonGroup:''}:item));renderSessionBuilderRules();
  }));
  let clause;
  if(rule.kind==='sessionDistribution'){
   clause=document.createElement('div');clause.className='session-rule-clause';
   clause.append(text('Spread'),select('Session type for rule '+ruleNumber,[['','Each session type'],...sessionBuilderTypes.map(type=>[type.id,type.name])],rule.sessionTypeId||'',value=>patch(rule,'sessionTypeId',value)));
   const tolerance=document.createElement('input');tolerance.type='number';tolerance.min='1';tolerance.max='500';tolerance.step='1';tolerance.value=String(rule.sessionTolerance);tolerance.setAttribute('aria-label','Session spread tolerance for rule '+ruleNumber);
   tolerance.addEventListener('change',()=>{try{if(tolerance.value===''||!tolerance.checkValidity())throw Error('Enter a whole-number tolerance of at least one session.');patch(rule,'sessionTolerance',Number(tolerance.value));}catch(error){tolerance.setCustomValidity(error.message);tolerance.reportValidity();}});
   clause.append(text('Spread across available working days, within ±'),tolerance,text('sessions from each day’s capacity-adjusted target. Clinician Setup minimums and maximums are applied first; remaining sessions are shared across the other working days. Prefer avoids increasing cost; Must meet requires this adjusted spread.'));
  }else if(rule.kind==='distribution'){
   clause=document.createElement('div');clause.className='session-rule-clause session-rule-distribution';
   const appointmentChoices=groupUrgencyNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
   clause.append(text('Allocation'),select('Allocation for rule '+ruleNumber,[['','Choose appointment type'],...appointmentChoices.map(name=>[name,name])],rule.appointmentTypes?.[0]||'',value=>patch(rule,'appointmentTypes',value?[value]:[])));
   clause.append(text('Distribution'),select('Distribution for rule '+ruleNumber,[['even','Even spread'],['custom','Custom percentages']],rule.distributionMode||'even',value=>{
    commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,distributionMode:value,distributionTargets:window.SessionBuilderDistribution.initialTargets(item.days)}:item));renderSessionBuilderRules();
   }));
   const tolerance=document.createElement('input');tolerance.type='number';tolerance.min='0';tolerance.max='100';tolerance.step='0.1';tolerance.value=String(rule.distributionTolerance??5);tolerance.setAttribute('aria-label','Distribution tolerance for rule '+ruleNumber);
   tolerance.addEventListener('input',()=>tolerance.setCustomValidity(''));
   tolerance.addEventListener('change',()=>{try{if(tolerance.value===''||!tolerance.checkValidity())throw Error('Enter a tolerance from zero to 100.');patch(rule,'distributionTolerance',Number(tolerance.value));}catch(error){tolerance.setCustomValidity(error.message);tolerance.reportValidity();}});
   clause.append(text('Tolerance ±'),tolerance,text('percentage points'));
   const daily=document.createElement('div');daily.className='session-rule-distribution-days';
   const targets=window.SessionBuilderDistribution.targets(rule);
   for(const day of rule.days){
    const label=document.createElement('label');label.append(text(['Mon','Tue','Wed','Thu','Fri'][day-1]));
    if(rule.distributionMode==='custom'){
     const input=document.createElement('input');input.type='number';input.min='0';input.max='100';input.step='0.1';input.value=String(rule.distributionTargets?.[day]||0);input.setAttribute('aria-label','Target percentage for '+['Monday','Tuesday','Wednesday','Thursday','Friday'][day-1]+' rule '+ruleNumber);
     input.addEventListener('input',()=>input.setCustomValidity(''));
     input.addEventListener('change',()=>{try{if(input.value===''||!input.checkValidity())throw Error('Enter a percentage from zero to 100.');patch(rule,'distributionTargets',{...rule.distributionTargets,[day]:Number(input.value)});}catch(error){input.setCustomValidity(error.message);input.reportValidity();}});label.append(input,text('%'));
    }else label.append(text(new Intl.NumberFormat('en-GB',{maximumFractionDigits:1}).format(targets[day])+'%'));
    daily.append(label);
   }
   clause.append(daily,text('Prefer seeks a spread without increasing cost; Must meet enforces the ranges. Planned-care types share one pool. Click Reset planner to apply changes.'));
  }else{
  clause=document.createElement('div');clause.className='session-rule-clause';
  if(rule.kind==='minimum'){
   const limits=document.createElement('div');limits.className='session-rule-limits';
   for(const [field,title,placeholder] of [['minimum','Minimum','No minimum'],['maximum','Maximum','No maximum']]){
    const label=document.createElement('label'),input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.placeholder=placeholder;input.value=rule[field]==null?'':String(rule[field]);input.setAttribute('aria-label',title+' sessions');input.addEventListener('input',()=>input.setCustomValidity(''));
    input.addEventListener('change',()=>{try{if(!input.checkValidity())throw Error('Enter a non-negative whole number or leave blank for no limit.');patch(rule,field,input.value===''?null:Number(input.value));}catch(error){input.setCustomValidity(error.message);input.reportValidity();}});label.append(text(title),input);limits.append(label);
   }
   clause.append(limits,select('Required session type for rule '+ruleNumber,[['','Choose session type'],...sessionBuilderTypes.map(type=>[type.id,type.name])],rule.sessionTypeId,value=>patch(rule,'sessionTypeId',value)));
  }else{
   clause.append(select('Comparison for rule '+ruleNumber,[['atLeast','At least'],['exact','Exactly'],['atMost','At most']],rule.comparison||'atLeast',value=>patch(rule,'comparison',value)));
   const minimum=document.createElement('input');minimum.type='number';minimum.min='0';minimum.max='100';minimum.step='0.1';minimum.required=true;minimum.value=String(rule.minimum);minimum.setAttribute('aria-label','Appointment percentage');minimum.addEventListener('input',()=>minimum.setCustomValidity(''));minimum.addEventListener('change',()=>{try{if(minimum.value===''||!minimum.checkValidity())throw Error('Enter a percentage from zero to 100.');patch(rule,'minimum',Number(minimum.value));}catch(error){minimum.setCustomValidity(error.message);minimum.reportValidity();}});clause.append(minimum);
   const key=ref=>JSON.stringify([ref.kind,ref.name]);
   const parse=value=>{const [kind,name]=JSON.parse(value);return {kind,name};};
   const clinicianNames=typeof clinicianCategoryNames==='undefined'?[]:clinicianCategoryNames.filter(name=>name&&name!=='Uncategorised'&&isDashboardToggleOption(name));
   const choices=[...groups.map(group=>[key({kind:'group',name:group}),'All '+group]),...clinicianNames.map(name=>[key({kind:'type',name}),name+' ('+(clinicianGroupAssignments[name]||'Uncategorised')+')'])];
   const selectedSubject=window.SessionBuilderPlanning.shareSubject(rule),selectedDenominators=window.SessionBuilderPlanning.shareDenominators(rule);
   clause.append(text('% of appointments by'),select('Clinician group or type for rule '+ruleNumber,[['','Choose clinician'],...choices],key(selectedSubject),value=>{if(value)patch(rule,'shareSubject',parse(value));}));
   if(rule.kind==='share'){
   const pool=document.createElement('div');pool.className='session-rule-denominator';pool.append(text('Count'),select('Appointment type for rule '+ruleNumber,[['urgent','Urgent appointments'],['all','All appointments'],['selected','Choose appointment types']],window.SessionBuilderPlanning.sharePool(rule),value=>patch(rule,'appointmentPool',value)));clause.append(pool);
   }
   if(rule.kind==='mix'||rule.appointmentPool==='selected'){
    const choicesBox=document.createElement('details'),summary=document.createElement('summary'),choicesList=document.createElement('div');choicesBox.className='session-builder-appointment-dropdown';choicesList.className='session-builder-appointment-options';const picked=new Set(rule.appointmentTypes||[]);summary.textContent=picked.size?picked.size+' appointment type'+(picked.size===1?'':'s')+' selected':'Choose appointment types';choicesBox.append(summary);
    for(const name of groupUrgencyNames.filter(isDashboardToggleOption)){const label=document.createElement('label'),input=document.createElement('input'),caption=text(name);input.type='checkbox';input.checked=picked.has(name);input.addEventListener('change',()=>{if(input.checked)picked.add(name);else picked.delete(name);commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,appointmentTypes:[...picked]}:item));summary.textContent=picked.size?picked.size+' appointment type'+(picked.size===1?'':'s')+' selected':'Choose appointment types';const current=sessionBuilderRules.find(item=>item.id===rule.id);if(current)details.querySelector(':scope > summary').textContent=(current.enabled?'':'Off · ')+ruleSummary(current);});label.append(input,caption);choicesList.append(label);}choicesBox.append(choicesList);clause.append(choicesBox);
   }
   if(rule.kind==='share'){
   const denominator=document.createElement('div');denominator.className='session-rule-denominator';denominator.append(text('Percentage of'));
   denominator.append(select('First denominator for rule '+ruleNumber,[['','All clinicians'],...choices],selectedDenominators[0]?key(selectedDenominators[0]):'',value=>{
    const first=value?parse(value):null,second=selectedDenominators[1];const next=first?[first,...(second&&key(second)!==key(first)?[second]:[])]:[];patch(rule,'denominatorSelections',next);
   }));
   denominator.append(text('+'));
   denominator.append(select('Second denominator for rule '+ruleNumber,[['','None'],...choices],selectedDenominators[1]?key(selectedDenominators[1]):'',value=>{
    const second=value?parse(value):null,first=selectedDenominators[0]||(second?selectedSubject:null);const next=first?[first,...(second&&key(second)!==key(first)?[second]:[])]:[];patch(rule,'denominatorSelections',next);
   }));clause.append(denominator);
   }

  }
  }
  requirement.append(clause);
  const issues=issuesFor(rule,sessionBuilderTypes,groups);if(issues.length){const warning=document.createElement('p');warning.className='session-rule-issue';warning.textContent=issues.join(' ');requirement.append(warning);}row.append(requirement);
  const strength=document.createElement('div');strength.append(select('Strength for rule '+ruleNumber,[['must','Must meet'],['prefer','Prefer']],rule.strength,value=>patch(rule,'strength',value)));row.append(strength);
  const actions=document.createElement('div'),remove=document.createElement('button');remove.type='button';remove.className='session-builder-remove';remove.textContent='Remove';remove.setAttribute('aria-label','Remove rule '+(sessionBuilderRules.indexOf(rule)+1));remove.addEventListener('click',()=>{if(!canEditSessionBuilder())return;commit(sessionBuilderRules.filter(item=>item.id!==rule.id));renderSessionBuilderRules();});actions.append(remove);row.append(actions);details.append(row);ruleGroups.get(rule.kind)?.append(details);
 }
 byId('sessionBuilderRulesEmpty').hidden=sessionBuilderRules.length>0;
 const result=byId('sessionBuilderRuleValidation');if(result.dataset.checked==='true')showValidation();
}
window.renderSessionBuilderRules=renderSessionBuilderRules;
function showValidation(){
 if(!canEditSessionBuilder())return;const messages=inspectRules(),root=byId('sessionBuilderRuleValidation');root.replaceChildren();root.hidden=false;root.dataset.checked='true';
 const summary=document.createElement('p');summary.textContent=messages.length?messages.length+' rule setup issue'+(messages.length===1?'':'s')+' to resolve.':'Rule definitions are valid. This does not verify that a staff schedule can meet them.';root.append(summary);
 for(const item of messages){const line=document.createElement('p');line.className='session-rule-issue';line.textContent=item.message;root.append(line);}
}
byId('sessionBuilderAddRule')?.addEventListener('click',()=>{
 if(!canEditSessionBuilder())return;
 const kind=byId('sessionBuilderNewRuleKind').value,id=crypto.randomUUID();openRules.add(id);
 commit([...sessionBuilderRules,{id,enabled:true,kind,scope:['distribution','sessionDistribution'].includes(kind)?'week':'day',days:[1,2,3,4,5],...(kind==='distribution'?{distributionMode:'even',distributionTolerance:5,distributionTargets:{}}:kind==='sessionDistribution'?{sessionTolerance:1}:{}),maximum:null,minimum:kind==='minimum'?1:['distribution','sessionDistribution'].includes(kind)?0:50,comparison:'atLeast',appointmentTypes:kind==='mix'&&groupUrgencyNames.includes('Routine')?['Routine']:[],sessionTypeId:kind==='sessionDistribution'?'':sessionBuilderTypes[0]?.id||'',clinicianGroup:configuredGroups()[0]||'',denominator:'all',comparisonGroup:'',strength:['distribution','sessionDistribution'].includes(kind)?'prefer':'must'}]);renderSessionBuilderRules();
});
byId('sessionBuilderValidateRules')?.addEventListener('click',showValidation);
const tabs=[['clinician','Clinician'],['types','Types'],['rules','Rules'],['planner','Planner']];
function applyTab(name){
 if(!canEditSessionBuilder())return;
 for(const [key,id] of tabs){const active=name===key,button=byId('sessionBuilder'+id+'Tab');button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;byId('sessionBuilder'+id+'Panel').hidden=!active;}
 if(name==='clinician')window.renderSessionBuilderClinicians?.();
 if(name==='rules')renderSessionBuilderRules();
 if(name==='planner')window.renderSessionBuilderRequirements?.();
}
window.restoreSessionBuilderTab=()=>{const saved=window.gpChartPreferences?.read()?.sessionBuilderTab;applyTab(tabs.some(([key])=>key===saved)?saved:'types');};
function chooseTab(name){if(!canEditSessionBuilder())return;window.gpChartPreferences?.write('sessionBuilderTab',name);applyTab(name);}
for(const [index,[name,id]] of tabs.entries()){
 const button=byId('sessionBuilder'+id+'Tab');button?.addEventListener('click',()=>chooseTab(name));
 button?.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!canEditSessionBuilder())return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;chooseTab(tabs[next][0]);byId('sessionBuilder'+tabs[next][1]+'Tab').focus();});
}
})();
