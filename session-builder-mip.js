(function(root){
'use strict';
let engine=null;
function initialize(highs){if(!highs||typeof highs.createModel!=='function')throw Error('The HiGHS mixed-integer solver could not initialize.');engine=highs;}
function solve(model,{timeLimit=30000,values:initial,onIncumbent}={}){
 if(!engine)throw Error('The HiGHS mixed-integer solver is not initialized.');
 const names=Object.keys(model.variables),rowNames=Object.keys(model.constraints),rowIndex=new Map(rowNames.map((name,i)=>[name,i])),starts=[0],indices=[],coefficients=[];
 for(const name of names){for(const [key,value]of Object.entries(model.variables[name]))if(value&&rowIndex.has(key)){indices.push(rowIndex.get(key));coefficients.push(value);}starts.push(indices.length);}
 const infinity=engine.infinity;
 const problem={numCols:names.length,numRows:rowNames.length,sense:model.opType==='max'?engine.constants.objectiveSense.maximize:engine.constants.objectiveSense.minimize,colCost:names.map(name=>model.variables[name][model.optimize]||0),colLower:names.map(name=>model.unrestricted?.[name]?-infinity:0),colUpper:names.map(name=>model.binaries?.[name]?1:infinity),rowLower:rowNames.map(name=>model.constraints[name].equal??model.constraints[name].min??-infinity),rowUpper:rowNames.map(name=>model.constraints[name].equal??model.constraints[name].max??infinity),integrality:names.map(name=>model.ints?.[name]||model.binaries?.[name]?engine.constants.variableType.integer:engine.constants.variableType.continuous),matrix:{format:'csc',numCols:names.length,numRows:rowNames.length,starts,indices,values:coefficients}};
 const native=engine.createModel(problem),toValues=vector=>Object.fromEntries(names.map((name,i)=>[name,vector[i]===0?0:vector[i]]));
 try{
  native.options.set({output_flag:false,time_limit:Math.max(.001,timeLimit/1000),mip_rel_gap:0,mip_abs_gap:.000001,mip_feasibility_tolerance:1e-8,primal_feasibility_tolerance:1e-8,random_seed:0});
  if(initial)native.setSolution({colValue:names.map(name=>initial[name]||0)});
  const callbacks={};
  if(typeof onIncumbent==='function')callbacks[engine.constants.callbackType.mipImprovingSolution]=event=>{const vector=event.data.mip_solution;if(vector?.length===names.length)try{onIncumbent(toValues(vector));}catch(error){/* Observers cannot alter a solve. */}};
  native.run(callbacks);
  const status=native.getModelStatus(),optimal=status===engine.constants.modelStatus.optimal,primalStatus=native.info.get('primal_solution_status'),feasible=primalStatus===2;
  const solution=feasible?toValues(native.getSolution().colValue):null;
  if(solution&&typeof onIncumbent==='function')try{onIncumbent({...solution});}catch(error){/* Observers cannot alter a solve. */}
  const integer=Object.keys(model.ints||{}).length>0||Object.keys(model.binaries||{}).length>0;
  const lowerBound=optimal?native.getObjectiveValue():integer?native.info.get('mip_dual_bound'):undefined,gap=optimal?0:integer?native.info.get('mip_gap'):undefined;
  return {values:solution,status,optimal,feasible,infeasible:status===engine.constants.modelStatus.infeasible,lowerBound:Number.isFinite(lowerBound)?lowerBound:undefined,gap:Number.isFinite(gap)?gap:undefined,objective:feasible?native.getObjectiveValue():undefined,engine:'HiGHS '+engine.version.string};
 }finally{native.dispose();}
}
root.SessionBuilderMip=Object.freeze({initialize,solve});
})(typeof window==='undefined'?globalThis:window);


