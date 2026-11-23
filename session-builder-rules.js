(function(){
'use strict';
const byId=id=>document.getElementById(id);
const scopes=[['morning','Every morning'],['afternoon','Every afternoon'],['both','Morning and afternoon separately'],['day','Each whole day']];
const presets=[['all','Monday–Friday',[1,2,3,4,5]],['mwf','Monday, Wednesday, Friday',[1,3,5]],['tt','Tuesday, Thursday',[2,4]],...['Monday','Tuesday','Wednesday','Thursday','Friday'].map((name,i)=>[String(i+1),name+' only',[i+1]])];
const configuredGroups=()=>clinicianGroupNames.filter(name=>name!=='Uncategorised'&&isDashboardToggleOption(name));
function validateRules(rules){
 if(!Array.isArray(rules))throw Error('Planning rules must be a list.');
 const ids=new Set();
 for(const rule of rules){
  if(!rule||typeof rule!=='object'||Array.isArray(rule)||typeof rule.id!=='string'||!rule.id||ids.has(rule.id))throw Error('Planning rules require unique identifiers.');ids.add(rule.id);
  if(typeof rule.enabled!=='boolean'||!['minimum','share'].includes(rule.kind)||!scopes.some(([key])=>key===rule.scope)||!['must','prefer'].includes(rule.strength))throw Error('Invalid planning rule type, period or strength.');
  if(!Array.isArray(rule.days)||!rule.days.length||rule.days.some(day=>!Number.isInteger(day)||day<1||day>5)||new Set(rule.days).size!==rule.days.length)throw Error('Choose at least one weekday.');
  if(!Number.isFinite(rule.minimum)||rule.kind==='minimum'&&(!Number.isSafeInteger(rule.minimum)||rule.minimum<1)||rule.kind==='share'&&(rule.minimum<0||rule.minimum>100))throw Error('Use a whole number of sessions, or a percentage between zero and 100.');
  if(rule.kind==='minimum'&&typeof rule.sessionTypeId!=='string')throw Error('Choose a session type.');
  if(rule.kind==='share'&&(typeof rule.clinicianGroup!=='string'||!['all','pair'].includes(rule.denominator)||typeof rule.comparisonGroup!=='string'))throw Error('Choose a clinician group and appointment denominator.');
 }
 return true;
}
window.validateSessionBuilderRules=validateRules;
function issuesFor(rule,types,groups){
 if(!rule.enabled)return [];
 const issues=[];
 if(rule.kind==='minimum'&&!types.some(type=>type.id===rule.sessionTypeId))issues.push('Choose an existing session type.');
 if(rule.kind==='share'){
  if(!groups.includes(rule.clinicianGroup))issues.push('Choose an existing clinician group.');
  if(rule.denominator==='pair'&&(!groups.includes(rule.comparisonGroup)||rule.comparisonGroup===rule.clinicianGroup))issues.push('Choose a different existing group for the comparison.');
 }
 return issues;
}
window.sessionBuilderRuleIssues=issuesFor;
window.renameSessionBuilderRuleGroup=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 sessionBuilderRules=sessionBuilderRules.map(rule=>rule.kind==='share'?{...rule,clinicianGroup:rule.clinicianGroup===oldName?newName:rule.clinicianGroup,comparisonGroup:rule.comparisonGroup===oldName?newName:rule.comparisonGroup}:rule);
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
 const next=sessionBuilderRules.map(item=>item.id===rule.id?{...item,[key]:value}:item);
 commit(next);renderSessionBuilderRules();
}
function inspectRules(){
 const groups=configuredGroups(),messages=[];
 for(const rule of sessionBuilderRules)for(const issue of issuesFor(rule,sessionBuilderTypes,groups))messages.push({id:rule.id,message:issue});
 // Percentages for distinct groups over the same all-appointment denominator
 // cannot sum above 100 in a single period. Duplicate rules use their maximum.
 for(const day of [1,2,3,4,5])for(const period of ['morning','afternoon','day']){
  const pools=new Map();
  for(const rule of sessionBuilderRules){
   if(!rule.enabled||rule.strength!=='must'||rule.kind!=='share'||!rule.days.includes(day)||rule.scope!==period&&(period==='day'||rule.scope!=='both')||issuesFor(rule,sessionBuilderTypes,groups).length)continue;
   const key=rule.denominator==='all'?'all':JSON.stringify([rule.clinicianGroup,rule.comparisonGroup].sort());
   if(!pools.has(key))pools.set(key,new Map());const lower=pools.get(key);lower.set(rule.clinicianGroup,Math.max(lower.get(rule.clinicianGroup)||0,rule.minimum));
  }
  for(const lower of pools.values()){const total=[...lower.values()].reduce((sum,n)=>sum+n,0);
   if(total>100+1e-9)messages.push({id:'conflict-'+day+'-'+period,message:['Monday','Tuesday','Wednesday','Thursday','Friday'][day-1]+' '+period+': required clinician shares over the same appointment pool sum to '+total+'%, which exceeds 100%.'});
  }
 }
 return messages;
}
window.inspectSessionBuilderRules=inspectRules;
function renderSessionBuilderRules(){
 const page=byId('sessionBuilderRulesPanel'),body=byId('sessionBuilderRulesBody');if(!page||!body)return;
 if(!canEditSessionBuilder()){page.hidden=true;body.replaceChildren();return;}
 const groups=configuredGroups();body.replaceChildren();
 for(const rule of sessionBuilderRules){
  const ruleNumber=sessionBuilderRules.indexOf(rule)+1;
  const row=document.createElement('tr');row.dataset.ruleId=rule.id;
  const enabled=document.createElement('td'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=rule.enabled;toggle.setAttribute('aria-label','Enable rule '+(sessionBuilderRules.indexOf(rule)+1));toggle.addEventListener('change',()=>{try{patch(rule,'enabled',toggle.checked)}catch(error){toggle.checked=!toggle.checked;byId('sessionBuilderRulesSaveStatus').textContent=error.message;}});enabled.append(toggle);row.append(enabled);
  const when=document.createElement('td');when.append(select('Period for rule '+ruleNumber,scopes,rule.scope,value=>patch(rule,'scope',value)));
  const preset=presets.find(([, ,days])=>JSON.stringify([...rule.days].sort())===JSON.stringify(days));
  const dayOptions=presets.map(([key,label])=>[key,label]);if(!preset)dayOptions.push(['custom','Custom: '+rule.days.map(day=>['Mon','Tue','Wed','Thu','Fri'][day-1]).join(', ')]);
  when.append(select('Weekdays for rule '+ruleNumber,dayOptions,preset?.[0]||'custom',key=>{const choice=presets.find(([id])=>id===key);if(choice)patch(rule,'days',[...choice[2]]);}));row.append(when);
  const requirement=document.createElement('td');
  requirement.append(select('Rule type '+ruleNumber,[['minimum','Minimum sessions'],['share','Clinician appointment share']],rule.kind,kind=>{
   commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,kind,minimum:kind==='minimum'?1:40,sessionTypeId:sessionBuilderTypes[0]?.id||'',clinicianGroup:groups[0]||'',denominator:'all',comparisonGroup:''}:item));renderSessionBuilderRules();
  }));
  const clause=document.createElement('div');clause.className='session-rule-clause';clause.append(text('At least'));
  const minimum=document.createElement('input');minimum.type='number';minimum.min=rule.kind==='share'?'0':'1';minimum.step=rule.kind==='share'?'0.1':'1';if(rule.kind==='share')minimum.max='100';minimum.required=true;minimum.value=String(rule.minimum);minimum.setAttribute('aria-label',rule.kind==='share'?'Minimum appointment percentage':'Minimum sessions');minimum.addEventListener('input',()=>minimum.setCustomValidity(''));
  minimum.addEventListener('change',()=>{try{if(minimum.value===''||!minimum.checkValidity())throw Error(rule.kind==='share'?'Enter a percentage from zero to 100.':'Enter at least one whole session.');patch(rule,'minimum',Number(minimum.value));}catch(error){minimum.setCustomValidity(error.message);minimum.reportValidity();}});clause.append(minimum);
  if(rule.kind==='minimum'){
   clause.append(select('Required session type for rule '+ruleNumber,[['','Choose session type'],...sessionBuilderTypes.map(type=>[type.id,type.name])],rule.sessionTypeId,value=>patch(rule,'sessionTypeId',value)));
  }else{
   clause.append(text('% of appointments by'),select('Required clinician group for rule '+ruleNumber,[['','Choose clinician group'],...groups.map(group=>[group,group])],rule.clinicianGroup,value=>{
    commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,clinicianGroup:value,denominator:item.comparisonGroup===value?'all':item.denominator,comparisonGroup:item.comparisonGroup===value?'':item.comparisonGroup}:item));renderSessionBuilderRules();
   }));
   const denominator=document.createElement('div');denominator.className='session-rule-denominator';denominator.append(text('Percentage of'));
   const pairs=groups.filter(group=>group!==rule.clinicianGroup).map(group=>[group,rule.clinicianGroup+' + '+group+' appointments']);
   denominator.append(select('Appointment denominator for rule '+ruleNumber,[['','All appointments'],...pairs],rule.denominator==='pair'?rule.comparisonGroup:'',value=>{
    commit(sessionBuilderRules.map(item=>item.id===rule.id?{...item,denominator:value?'pair':'all',comparisonGroup:value}:item));renderSessionBuilderRules();
   }));clause.append(denominator);
  }
  requirement.append(clause);
  const issues=issuesFor(rule,sessionBuilderTypes,groups);if(issues.length){const warning=document.createElement('p');warning.className='session-rule-issue';warning.textContent=issues.join(' ');requirement.append(warning);}row.append(requirement);
  const strength=document.createElement('td');strength.append(select('Strength for rule '+ruleNumber,[['must','Must meet'],['prefer','Prefer']],rule.strength,value=>patch(rule,'strength',value)));row.append(strength);
  const actions=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.className='session-builder-remove';remove.textContent='Remove';remove.setAttribute('aria-label','Remove rule '+(sessionBuilderRules.indexOf(rule)+1));remove.addEventListener('click',()=>{if(!canEditSessionBuilder())return;commit(sessionBuilderRules.filter(item=>item.id!==rule.id));renderSessionBuilderRules();});actions.append(remove);row.append(actions);body.append(row);
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
 const kind=byId('sessionBuilderNewRuleKind').value;
 commit([...sessionBuilderRules,{id:crypto.randomUUID(),enabled:true,kind,scope:'both',days:[1,2,3,4,5],minimum:kind==='share'?40:1,sessionTypeId:sessionBuilderTypes[0]?.id||'',clinicianGroup:configuredGroups()[0]||'',denominator:'all',comparisonGroup:'',strength:'must'}]);renderSessionBuilderRules();
});
byId('sessionBuilderValidateRules')?.addEventListener('click',showValidation);
function applyTab(name){
 if(!canEditSessionBuilder())return;
 for(const tab of ['Types','Rules']){const active=(name==='rules')===(tab==='Rules');byId('sessionBuilder'+tab+'Tab').setAttribute('aria-selected',String(active));byId('sessionBuilder'+tab+'Panel').hidden=!active;}
 if(name==='rules')renderSessionBuilderRules();
}
window.restoreSessionBuilderTab=()=>applyTab(window.gpChartPreferences?.read()?.sessionBuilderTab==='rules'?'rules':'types');
function chooseTab(name){if(!canEditSessionBuilder())return;window.gpChartPreferences?.write('sessionBuilderTab',name);applyTab(name);}
for(const name of ['types','rules']){
 const id=name==='types'?'Types':'Rules',button=byId('sessionBuilder'+id+'Tab');button?.addEventListener('click',()=>chooseTab(name));
 button?.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!canEditSessionBuilder())return;event.preventDefault();const next=event.key==='Home'?'types':event.key==='End'?'rules':name==='types'?'rules':'types';chooseTab(next);byId('sessionBuilder'+(next==='types'?'Types':'Rules')+'Tab').focus();});
}
})();
