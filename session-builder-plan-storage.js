(function(){
'use strict';
const prefix='gp-insight-planner-v1:';
function key(){try{const bridge=window.parent?.DarwinAnalytics||window.DarwinAnalytics;return bridge?.user?.id&&bridge?.practice?.id?prefix+encodeURIComponent(bridge.user.id)+':'+encodeURIComponent(bridge.practice.id):null;}catch{return null;}}
function validPlan(value){const p=value?.plan;return !!p&&p.verifiedPlan===true&&!p.error&&Number.isFinite(p.annualCost)&&p.annualCost>=0&&Array.isArray(p.rows)&&Array.isArray(p.placements)&&Array.isArray(p.ruleResults)&&p.ruleResults.every(r=>r.strength!=='must'||r.ok||r.adjustedForClinicianSetup)&&typeof value.key==='string'&&Array.isArray(value.args)&&value.args.length===6&&value.args[5]?.clinicianLimits&&typeof value.historyText==='string';}
function read(){const scope=key();if(!scope)return null;try{const value=JSON.parse(window.localStorage.getItem(scope)||'null');return value?.version===1?{...value,snapshot:validPlan(value.snapshot)?value.snapshot:null}:null;}catch{return null;}}
function write(value){const scope=key();if(!scope)return false;try{window.localStorage.setItem(scope,JSON.stringify({version:1,...value}));return true;}catch{return false;}}
function saveTime(seconds){if(![5,10,30,60].includes(seconds))return false;return write({...read(),seconds});}
function savePlan(snapshot,seconds){if(!validPlan(snapshot))return false;return write({...read(),seconds:[5,10,30,60].includes(seconds)?seconds:30,snapshot:{...snapshot,savedAt:new Date().toISOString()}});}
function savePeriods(periods){if(![3,6,12].includes(periods?.horizonMonths)||!(periods.historyMonths==='all'||[3,6,12,18,24,36].includes(periods.historyMonths)))return false;return write({...read(),periods});}
window.SessionBuilderPlanStorage=Object.freeze({read,saveTime,savePlan,savePeriods,scope:key});
})();
