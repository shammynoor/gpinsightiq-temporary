(function(){
'use strict';
const byId=id=>document.getElementById(id),maxValue=500;
const periods=['Mon AM','Mon PM','Tue AM','Tue PM','Wed AM','Wed PM','Thu AM','Thu PM','Fri AM','Fri PM'];
const days=['Mon','Tue','Wed','Thu','Fri'];
function validate(limits){
 if(!limits||typeof limits!=='object'||Array.isArray(limits))throw Error('Clinician session limits must be a mapping.');
 for(const [name,value] of Object.entries(limits)){
  if(!name.trim()||['__proto__','prototype','constructor'].includes(name)||!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.min)||value.min<0||value.min>maxValue||!(value.max===null||Number.isSafeInteger(value.max)&&value.max>=value.min&&value.max<=maxValue))throw Error('Invalid minimum or maximum clinician sessions.');
  if(value.workingPattern!==undefined&&(!Array.isArray(value.workingPattern)||value.workingPattern.some(period=>!periods.includes(period))||new Set(value.workingPattern).size!==value.workingPattern.length))throw Error('Invalid clinician working pattern.');
  if(value.dailySessions!==undefined){
   if(!value.dailySessions||typeof value.dailySessions!=='object'||Array.isArray(value.dailySessions))throw Error('Invalid daily session limits.');
   for(const [day,b]of Object.entries(value.dailySessions))if(!days.includes(day)||!b||!Number.isSafeInteger(b.min)||b.min<0||b.min>maxValue||!(b.max===null||Number.isSafeInteger(b.max)&&b.max>=b.min&&b.max<=maxValue))throw Error('Daily minimum must be a whole number no greater than the daily maximum.');
   const rows=days.map(day=>value.dailySessions[day]||{min:0,max:Array.isArray(value.workingPattern)&&!value.workingPattern.some(p=>p.startsWith(day+' '))?0:null});
   if(value.max!=null&&rows.reduce((n,b)=>n+b.min,0)>value.max)throw Error('Daily minimums exceed the weekly maximum.');
   if(rows.every(b=>b.max!=null)&&rows.reduce((n,b)=>n+b.max,0)<value.min)throw Error('Daily maximums cannot cover the weekly minimum.');
  }
  if(value.annualRate!==undefined&&(typeof value.annualRate!=='number'||!Number.isFinite(value.annualRate)||value.annualRate<0||value.annualRate>100000000||Math.abs(value.annualRate*100-Math.round(value.annualRate*100))>1e-6))throw Error('Invalid annualised sessional rate.');
  if(value.annualLeaveWeeks!==undefined&&(typeof value.annualLeaveWeeks!=='number'||!Number.isFinite(value.annualLeaveWeeks)||value.annualLeaveWeeks<0||value.annualLeaveWeeks>52||Math.abs(value.annualLeaveWeeks*2-Math.round(value.annualLeaveWeeks*2))>1e-6))throw Error('Annual leave must be between 0 and 52 weeks in half-week steps.');
  if(value.sicknessPercent!==undefined&&(!Number.isInteger(value.sicknessPercent)||value.sicknessPercent<0||value.sicknessPercent>100||value.sicknessPercent%5!==0))throw Error('Sickness rate must be between 0% and 100% in 5% steps.');
 }
 return true;
}
window.validateSessionBuilderClinicianLimits=validate;
window.renameSessionBuilderClinicianType=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 if(Object.hasOwn(sessionBuilderClinicianLimits,oldName)){const next={...sessionBuilderClinicianLimits,[newName]:sessionBuilderClinicianLimits[oldName]};delete next[oldName];sessionBuilderClinicianLimits=next;}
 sessionBuilderTypes=sessionBuilderTypes.map(row=>Array.isArray(row.eligibleClinicians)?{...row,eligibleClinicians:row.eligibleClinicians.map(name=>name===oldName?newName:name)}:row);
 window.renameSessionBuilderRuleClinicianType?.(oldName,newName);
};
window.renderSessionBuilderClinicians=()=>{
 const body=byId('sessionBuilderClinicianBody'),empty=byId('sessionBuilderClinicianEmpty');if(!body||!empty)return;
 if(!canEditSessionBuilder()){body.replaceChildren();return;}
 body.replaceChildren();const names=[...new Set(clinicianCategoryNames)].filter(name=>name&&name!=='Uncategorised').sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 const groups=[...clinicianGroupNames.filter(name=>name&&name!=='Uncategorised'), 'Uncategorised'];
 for(const group of groups){
  const members=names.filter(name=>(groups.includes(clinicianGroupAssignments[name])?clinicianGroupAssignments[name]:'Uncategorised')===group);if(!members.length)continue;
  const heading=document.createElement('tr'),groupCell=document.createElement('th');groupCell.colSpan=6;groupCell.scope='rowgroup';groupCell.className='session-clinician-group';groupCell.textContent=group;heading.append(groupCell);body.append(heading);
  for(const name of members){
   const row=document.createElement('tr'),label=document.createElement('th');label.scope='row';label.textContent=name;row.append(label);
   const saved=sessionBuilderClinicianLimits[name]||{min:0,max:null};
   const limitCell=document.createElement('td'),limitWrap=document.createElement('div');limitWrap.className='session-clinician-limits';
   for(const field of ['min','max']){
    const select=document.createElement('select');select.setAttribute('aria-label',(field==='min'?'Minimum':'Maximum')+' sessions per week for '+name);
    if(field==='max'){const option=document.createElement('option');option.value='';option.textContent='No max';select.append(option);}
    for(let i=0;i<=maxValue;i++){const option=document.createElement('option');option.value=String(i);option.textContent=String(i);select.append(option);}
    select.value=field==='max'&&saved.max===null?'':String(saved[field]);
    select.addEventListener('change',()=>{
     if(!canEditSessionBuilder())return;const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},value=field==='max'&&select.value===''?null:Number(select.value),next={...previous,[field]:value};
     if(next.max!==null&&next.min>next.max){select.value=field==='max'&&previous.max===null?'':String(previous[field]);byId('sessionBuilderClinicianSaveStatus').textContent='Minimum cannot be greater than maximum.';return;}
     const limits={...sessionBuilderClinicianLimits,[name]:next};try{validate(limits);}catch(error){select.value=field==='max'&&previous.max===null?'':String(previous[field]);byId('sessionBuilderClinicianSaveStatus').textContent=error.message;return;}sessionBuilderClinicianLimits=limits;markCategoryDirty(250);window.renderSessionBuilderRequirements?.();
    });limitWrap.append(select);
    if(field==='min'){const separator=document.createElement('span');separator.textContent='–';separator.setAttribute('aria-hidden','true');limitWrap.append(separator);}
   }
   limitCell.append(limitWrap);row.append(limitCell);
   const patternCell=document.createElement('td'),dropdown=document.createElement('details'),summary=document.createElement('summary'),options=document.createElement('div');
   dropdown.className='session-builder-appointment-dropdown session-clinician-pattern';options.className='session-builder-appointment-options';
   const savedPattern=Array.isArray(saved.workingPattern)?saved.workingPattern:periods;
   const daily=Object.fromEntries(days.map(day=>[day,{...(saved.dailySessions?.[day]||{min:0,max:savedPattern.some(p=>p.startsWith(day+' '))?null:0})}]));
   options.className='session-clinician-daily-options';
   const updateSummary=()=>{const count=days.filter(day=>daily[day].max!==0).length;summary.textContent=count===5?'All week':count===0?'No days':count+' of 5 days';};
   updateSummary();summary.setAttribute('aria-label','Daily session limits for '+name);dropdown.append(summary);
   for(const title of ['Day','Min','Max']){const heading=document.createElement('span');heading.className='session-clinician-daily-heading';heading.textContent=title;options.append(heading);}
   for(const day of days){
    const label=document.createElement('span');label.textContent=({Mon:'Monday',Tue:'Tuesday',Wed:'Wednesday',Thu:'Thursday',Fri:'Friday'})[day];options.append(label);
    for(const field of ['min','max']){
     const input=document.createElement('input');input.type='number';input.min='0';input.max=String(maxValue);input.step='1';input.placeholder=field==='max'?'No max':'0';input.value=daily[day][field]===null?'':String(daily[day][field]);input.setAttribute('aria-label',(field==='min'?'Minimum':'Maximum')+' sessions on '+label.textContent+' for '+name);
     input.addEventListener('input',()=>input.setCustomValidity(''));
     input.addEventListener('change',()=>{if(!canEditSessionBuilder())return;try{
      if(input.value!==''&&!/^\d+$/.test(input.value))throw Error('Enter a whole number from 0 to 500.');
      const value=input.value===''?(field==='max'?null:0):Number(input.value),nextDaily={...daily,[day]:{...daily[day],[field]:value}},previous=sessionBuilderClinicianLimits[name]||{min:0,max:null};
      const next={...previous,dailySessions:nextDaily,workingPattern:periods.filter(p=>nextDaily[p.slice(0,3)].max!==0)},limits={...sessionBuilderClinicianLimits,[name]:next};validate(limits);
      Object.assign(daily,nextDaily);sessionBuilderClinicianLimits=limits;input.value=value===null?'':String(value);input.setCustomValidity('');updateSummary();markCategoryDirty(250);window.renderSessionBuilderRequirements?.();
     }catch(error){input.setCustomValidity(error.message);input.reportValidity();byId('sessionBuilderClinicianSaveStatus').textContent=error.message;}});
     options.append(input);
    }
   }
   const hint=document.createElement('small');hint.className='session-clinician-daily-hint';hint.textContent='Max 0 = not working. Blank max = no limit. Daily limits take priority over distribution.';options.append(hint);
   dropdown.append(options);patternCell.append(dropdown);row.append(patternCell);
   const rateCell=document.createElement('td'),rateWrap=document.createElement('div'),symbol=document.createElement('span'),rate=document.createElement('input');rateWrap.className='session-clinician-rate';symbol.textContent='£';symbol.setAttribute('aria-hidden','true');rate.type='number';rate.min='0';rate.max='100000000';rate.step='0.01';rate.inputMode='decimal';rate.value=String(saved.annualRate??0);rate.setAttribute('aria-label','Annualised sessional rate in pounds for '+name);
   rate.addEventListener('input',()=>rate.setCustomValidity(''));
   rate.addEventListener('change',()=>{if(!canEditSessionBuilder())return;try{if(rate.value===''||!rate.checkValidity())throw Error('Enter a non-negative rate with up to two decimal places.');const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},limits={...sessionBuilderClinicianLimits,[name]:{...previous,annualRate:Number(rate.value)}};validate(limits);sessionBuilderClinicianLimits=limits;rate.setCustomValidity('');markCategoryDirty(250);window.renderSessionBuilderRequirements?.();}catch(error){rate.setCustomValidity(error.message);rate.reportValidity();}});
   rateWrap.append(symbol,rate);rateCell.append(rateWrap);row.append(rateCell);
   const leaveCell=document.createElement('td'),leave=document.createElement('select');leave.setAttribute('aria-label','Annual leave in weeks for '+name);leave.className='session-clinician-leave';
   const savedLeave=saved.annualLeaveWeeks??5;
   if(!Number.isInteger(savedLeave)||savedLeave<0||savedLeave>10){const legacy=document.createElement('option');legacy.value=String(savedLeave);legacy.textContent=savedLeave+' (previous setting)';legacy.disabled=true;leave.append(legacy);}
   for(let weeks=0;weeks<=10;weeks++){const option=document.createElement('option');option.value=String(weeks);option.textContent=String(weeks);leave.append(option);}leave.value=String(savedLeave);
   leave.addEventListener('change',()=>{if(!canEditSessionBuilder())return;const value=Number(leave.value);if(leave.value===''||!Number.isInteger(value)||value<0||value>10){leave.value=String((sessionBuilderClinicianLimits[name]||{}).annualLeaveWeeks??5);return;}const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},limits={...sessionBuilderClinicianLimits,[name]:{...previous,annualLeaveWeeks:value}};validate(limits);sessionBuilderClinicianLimits=limits;markCategoryDirty(250);window.renderSessionBuilderRequirements?.();});leaveCell.append(leave);row.append(leaveCell);
   const sicknessCell=document.createElement('td'),sickness=document.createElement('select');sickness.setAttribute('aria-label','Sickness rate for '+name);sickness.className='session-clinician-sickness';for(let i=0;i<=100;i+=5){const option=document.createElement('option');option.value=String(i);option.textContent=i+'%';sickness.append(option);}sickness.value=String(saved.sicknessPercent??0);
   sickness.addEventListener('change',()=>{if(!canEditSessionBuilder())return;const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},limits={...sessionBuilderClinicianLimits,[name]:{...previous,sicknessPercent:Number(sickness.value)}};validate(limits);sessionBuilderClinicianLimits=limits;markCategoryDirty(250);window.renderSessionBuilderRequirements?.();});sicknessCell.append(sickness);row.append(sicknessCell);

   body.append(row);
  }
 }
 empty.hidden=names.length>0;
};
})();
