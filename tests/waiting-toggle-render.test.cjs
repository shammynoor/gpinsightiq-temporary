const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const start=source.indexOf('let waitingTimesRenderQueued=');
const end=source.indexOf('function renderWaitingTimesChart()',start);
assert(start>=0&&end>start,'waiting render scheduler exists');
const frames=[];
let histogram=0,trend=0;
const ctx=vm.createContext({
 requestAnimationFrame:fn=>frames.push(fn),
 renderWaitingTimesChart:()=>histogram++,
 renderWaitingTrendChart:()=>trend++
});
vm.runInContext(source.slice(start,end),ctx);
ctx.scheduleWaitingTimesRender();
ctx.scheduleWaitingTimesRender();
ctx.scheduleWaitingTrendRender();
ctx.scheduleWaitingTrendRender();
assert.equal(frames.length,2,'multiple changes produce one frame per chart');
assert.equal(histogram,0,'redraw waits for the current change event to finish');
while(frames.length)frames.shift()();
assert.equal(histogram,1);
assert.equal(trend,1);
ctx.scheduleWaitingTimesRender();
frames.shift()();
assert.equal(histogram,2,'later changes can schedule another redraw');
console.log('Waiting toggle redraws are deferred and coalesced.');
