(function(){
'use strict';
function validate(rule){
 if(rule.scope!=='week'||!['even','custom'].includes(rule.distributionMode||'even'))throw Error('Weekly distribution requires a weekly period and an even or custom spread.');
 const tolerance=rule.distributionTolerance??5;
 if(typeof tolerance!=='number'||!Number.isFinite(tolerance)||tolerance<0||tolerance>100)throw Error('Distribution tolerance must be between zero and 100 percentage points.');
 const targets=rule.distributionTargets||{};
 if(typeof targets!=='object'||Array.isArray(targets)||Object.entries(targets).some(([day,value])=>!['1','2','3','4','5'].includes(day)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>100))throw Error('Daily distribution targets must be percentages from zero to 100.');
 return true;
}
function targets(rule){return Object.fromEntries([1,2,3,4,5].map(day=>[day,!rule.days.includes(day)?0:rule.distributionMode==='custom'?(rule.distributionTargets?.[day]||0):100/rule.days.length]));}
function initialTargets(days){let assigned=0;return Object.fromEntries(days.map((day,index)=>{const value=index===days.length-1?Math.round((100-assigned)*10)/10:Math.round(1000/days.length)/10;assigned+=value;return [day,value];}));}
function issue(rule,names){
 try{validate(rule);}catch(error){return error.message;}
 if(!Array.isArray(rule.appointmentTypes)||rule.appointmentTypes.length!==1)return 'Choose one appointment type under Allocation.';
 if(names&&!names.includes(rule.appointmentTypes[0]))return 'The allocation appointment type has been removed; choose another.';
 if(rule.distributionMode==='custom'&&Math.abs(rule.days.reduce((n,day)=>n+(rule.distributionTargets?.[day]||0),0)-100)>1e-6)return 'Custom targets for the selected days must add up to 100%.';
 return '';
}
window.SessionBuilderDistribution=Object.freeze({validate,targets,initialTargets,issue});
})();
