(function(){
'use strict';
function normalise(value={}){const horizon=Number(value?.horizonMonths),history=value?.historyMonths;return {horizonMonths:[3,6,12].includes(horizon)?horizon:6,historyMonths:history==='all'?'all':[3,6,12,18,24,36].includes(Number(history))?Number(history):12};}
function addMonths(day,count){const value=new Date(day+'T12:00:00Z'),date=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+count);const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();value.setUTCDate(Math.min(date,last));return value.toISOString().slice(0,10);}
function historyWindow(today,selection,first){const {historyMonths}=normalise(selection),cutoff=historyMonths==='all'?(first||today):addMonths(today,-historyMonths);return {start:first&&first>cutoff?first:cutoff,end:new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10)};}
function forecastWindow(today,selection){const {horizonMonths}=normalise(selection),day=new Date(today+'T12:00:00Z'),dow=(day.getUTCDay()+6)%7;day.setUTCDate(day.getUTCDate()-dow+7);const start=day.toISOString().slice(0,10),end=addMonths(start,horizonMonths),weeks=[];for(let next=start;next<end;next=new Date(Date.parse(next+'T12:00:00Z')+604800000).toISOString().slice(0,10))weeks.push(next);return {start,end,weeks};}
window.SessionBuilderPeriods=Object.freeze({normalise,addMonths,historyWindow,forecastWindow});
})();
