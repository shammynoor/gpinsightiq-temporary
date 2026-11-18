(function(root){
'use strict';
// Add a break without changing the observations. In a stack, an extra zero at
// the first positive x creates a vertical edge while preserving stack totals.
function breakTrace(trace){
 if(trace.type!=='scatter'||!String(trace.mode||'lines').includes('lines')||!Array.isArray(trace.x)||!Array.isArray(trace.y)||trace.x.length!==trace.y.length)return trace;
 const breaks=[];for(let i=1;i<trace.y.length;i++)if(trace.y[i-1]===0&&typeof trace.y[i]==='number'&&trace.y[i]>0)breaks.push(i);
 if(!breaks.length)return trace;
 const breakSet=new Set(breaks),n=trace.y.length;
 const expand=(values,field)=>{const result=[];for(let i=0;i<n;i++){if(breakSet.has(i))result.push(field==='x'?trace.x[i]:field==='y'?(trace.stackgroup?0:null):null);result.push(values[i])}return result};
 const out={...trace,connectgaps:false};
 for(const field of ['x','y','customdata','text','hovertext','ids'])if(Array.isArray(trace[field])&&trace[field].length===n)out[field]=expand(trace[field],field);
 if(trace.marker){out.marker={...trace.marker};for(const field of ['size','color','symbol','opacity'])if(Array.isArray(trace.marker[field])&&trace.marker[field].length===n)out.marker[field]=expand(trace.marker[field],field)}
 return out;
}
function segments(values){const out=[];let part=[];for(let i=0;i<values.length;i++){const value=values[i];if(i&&values[i-1]===0&&typeof value==='number'&&value>0){if(part.length)out.push(part);part=[]}part.push(i)}if(part.length)out.push(part);return out}
const api={breakTrace,segments};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GPChartZero=api;
})(typeof window!=='undefined'?window:globalThis);
