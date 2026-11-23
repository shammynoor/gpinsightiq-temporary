(function(){
'use strict';
const byId=id=>document.getElementById(id),maxValue=500;
const periods=['Mon AM','Mon PM','Tue AM','Tue PM','Wed AM','Wed PM','Thu AM','Thu PM','Fri AM','Fri PM'];
function validate(limits){
 if(!limits||typeof limits!=='object'||Array.isArray(limits))throw Error('Clinician session limits must be a mapping.');
 for(const [name,value] of Object.entries(limits)){
  if(!name.trim()||['__proto__','prototype','constructor'].includes(name)||!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.min)||value.min<0||value.min>maxValue||!(value.max===null||Number.isSafeInteger(value.max)&&value.max>=value.min&&value.max<=maxValue))throw Error('Invalid minimum or maximum clinician sessions.');
  if(value.workingPattern!==undefined&&(!Array.isArray(value.workingPattern)||value.workingPattern.some(period=>!periods.includes(period))||new Set(value.workingPattern).size!==value.workingPattern.length))throw Error('Invalid clinician working pattern.');
  if(value.annualRate!==undefined&&(typeof value.annualRate!=='number'||!Number.isFinite(value.annualRate)||value.annualRate<0||value.annualRate>100000000||Math.abs(value.annualRate*100-Math.round(value.annualRate*100))>1e-6))throw Error('Invalid annualised sessional rate.');
 }
 return true;
}
window.validateSessionBuilderClinicianLimits=validate;
window.renameSessionBuilderClinicianType=(oldName,newName)=>{
 if(!canEditSessionBuilder())return;
 if(Object.hasOwn(sessionBuilderClinicianLimits,oldName)){const next={...sessionBuilderClinicianLimits,[newName]:sessionBuilderClinicianLimits[oldName]};delete next[oldName];sessionBuilderClinicianLimits=next;}
 sessionBuilderTypes=sessionBuilderTypes.map(row=>Array.isArray(row.eligibleClinicians)?{...row,eligibleClinicians:row.eligibleClinicians.map(name=>name===oldName?newName:name)}:row);
};
window.renderSessionBuilderClinicians=()=>{
 const body=byId('sessionBuilderClinicianBody'),empty=byId('sessionBuilderClinicianEmpty');if(!body||!empty)return;
 if(!canEditSessionBuilder()){body.replaceChildren();return;}
 body.replaceChildren();const names=[...new Set(clinicianCategoryNames)].filter(name=>name&&name!=='Uncategorised').sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
 const groups=[...clinicianGroupNames.filter(name=>name&&name!=='Uncategorised'), 'Uncategorised'];
 for(const group of groups){
  const members=names.filter(name=>(groups.includes(clinicianGroupAssignments[name])?clinicianGroupAssignments[name]:'Uncategorised')===group);if(!members.length)continue;
  const heading=document.createElement('tr'),groupCell=document.createElement('th');groupCell.colSpan=5;groupCell.scope='rowgroup';groupCell.className='session-clinician-group';groupCell.textContent=group;heading.append(groupCell);body.append(heading);
  for(const name of members){
   const row=document.createElement('tr'),label=document.createElement('th');label.scope='row';label.textContent=name;row.append(label);
   const saved=sessionBuilderClinicianLimits[name]||{min:0,max:null};
   for(const field of ['min','max']){
    const cell=document.createElement('td'),select=document.createElement('select');select.setAttribute('aria-label',(field==='min'?'Minimum':'Maximum')+' sessions per week for '+name);
    if(field==='max'){const option=document.createElement('option');option.value='';option.textContent='No max';select.append(option);}
    for(let i=0;i<=maxValue;i++){const option=document.createElement('option');option.value=String(i);option.textContent=String(i);select.append(option);}
    select.value=field==='max'&&saved.max===null?'':String(saved[field]);
    select.addEventListener('change',()=>{
     if(!canEditSessionBuilder())return;const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},value=field==='max'&&select.value===''?null:Number(select.value),next={...previous,[field]:value};
     if(next.max!==null&&next.min>next.max){select.value=field==='max'&&previous.max===null?'':String(previous[field]);byId('sessionBuilderClinicianSaveStatus').textContent='Minimum cannot be greater than maximum.';return;}
     const limits={...sessionBuilderClinicianLimits,[name]:next};validate(limits);sessionBuilderClinicianLimits=limits;markCategoryDirty(250);window.renderSessionBuilderRequirements?.();
    });cell.append(select);row.append(cell);
   }
   const patternCell=document.createElement('td'),dropdown=document.createElement('details'),summary=document.createElement('summary'),options=document.createElement('div');
   dropdown.className='session-builder-appointment-dropdown session-clinician-pattern';options.className='session-builder-appointment-options';
   const selected=new Set(Array.isArray(saved.workingPattern)?saved.workingPattern:periods);
   const updateSummary=()=>{summary.textContent=selected.size===periods.length?'All week':selected.size===0?'No periods':selected.size+' of 10 periods';};
   updateSummary();summary.setAttribute('aria-label','Working pattern for '+name);dropdown.append(summary);
   for(const period of periods){
    const label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');checkbox.type='checkbox';checkbox.checked=selected.has(period);text.textContent=period;
    checkbox.addEventListener('change',()=>{if(!canEditSessionBuilder())return;if(checkbox.checked)selected.add(period);else selected.delete(period);const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},limits={...sessionBuilderClinicianLimits,[name]:{...previous,workingPattern:periods.filter(item=>selected.has(item))}};validate(limits);sessionBuilderClinicianLimits=limits;updateSummary();markCategoryDirty(250);window.renderSessionBuilderRequirements?.();});
    label.append(checkbox,text);options.append(label);
   }
   dropdown.append(options);patternCell.append(dropdown);row.append(patternCell);
   const rateCell=document.createElement('td'),rateWrap=document.createElement('div'),symbol=document.createElement('span'),rate=document.createElement('input');rateWrap.className='session-clinician-rate';symbol.textContent='£';symbol.setAttribute('aria-hidden','true');rate.type='number';rate.min='0';rate.max='100000000';rate.step='0.01';rate.inputMode='decimal';rate.value=String(saved.annualRate??0);rate.setAttribute('aria-label','Annualised sessional rate in pounds for '+name);
   rate.addEventListener('input',()=>rate.setCustomValidity(''));
   rate.addEventListener('change',()=>{if(!canEditSessionBuilder())return;try{if(rate.value===''||!rate.checkValidity())throw Error('Enter a non-negative rate with up to two decimal places.');const previous=sessionBuilderClinicianLimits[name]||{min:0,max:null},limits={...sessionBuilderClinicianLimits,[name]:{...previous,annualRate:Number(rate.value)}};validate(limits);sessionBuilderClinicianLimits=limits;rate.setCustomValidity('');markCategoryDirty(250);}catch(error){rate.setCustomValidity(error.message);rate.reportValidity();}});
   rateWrap.append(symbol,rate);rateCell.append(rateWrap);row.append(rateCell);
   body.append(row);
  }
 }
 empty.hidden=names.length>0;
};
})();
