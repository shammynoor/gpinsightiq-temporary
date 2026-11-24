(function(){
'use strict';
// Annualised sessional rates already price one recurring weekly session for a year.
// Equal shares are a review assumption, independent of the planner's assignments.
function equalSplit(sessions,names,limits={}){
 const eligible=[...new Set(names)],share=eligible.length?sessions/eligible.length:0;
 const parts=eligible.map(name=>{
  const rate=limits[name]?.annualRate,missing=sessions>0&&!(typeof rate==='number'&&Number.isFinite(rate)&&rate>=0);
  return {name,sessions:share,missing,pence:missing?0:Math.round(share*(rate||0)*100)};
 });
 return {parts,pence:parts.reduce((n,part)=>n+part.pence,0),complete:!parts.some(part=>part.missing)&&(!sessions||eligible.length>0),unassigned:sessions>0&&!eligible.length};
}
function total(costs){
 const parts=new Map();
 for(const cost of costs)for(const part of cost.parts){
  const current=parts.get(part.name)||{name:part.name,sessions:0,pence:0,missing:false};
  current.sessions+=part.sessions;current.pence+=part.pence;current.missing||=part.missing;parts.set(part.name,current);
 }
 return {parts:[...parts.values()],pence:costs.reduce((n,cost)=>n+cost.pence,0),complete:costs.every(cost=>cost.complete),unassigned:costs.some(cost=>cost.unassigned)};
}
window.SessionBuilderCosting=Object.freeze({equalSplit,total});
})();
