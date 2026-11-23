(function(){
'use strict';
const byId=id=>document.getElementById(id),maxValue=500;
function validate(limits){
 if(!limits||typeof limits!=='object'||Array.isArray(limits))throw Error('Clinician session limits must be a mapping.');
 for(const [name,value] of Object.entries(limits)){
  if(!name.trim()||['__proto__','prototype','constructor'].includes(name)||!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.min)||value.min<0||value.min>maxValue||!(value.max===null||Number.isSafeInteger(value.max)&&value.max>=value.min&&value.max<=maxValue))throw Error('Invalid minimum or maximum clinician sessions.');
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
  const heading=document.createElement('tr'),groupCell=document.createElement('th');groupCell.colSpan=3;groupCell.scope='rowgroup';groupCell.className='session-clinician-group';groupCell.textContent=group;heading.append(groupCell);body.append(heading);
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
   body.append(row);
  }
 }
 empty.hidden=names.length>0;
};
})();
