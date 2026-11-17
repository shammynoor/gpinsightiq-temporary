const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
function section(start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert(a>=0&&b>a);return src.slice(a,b)}

test('multiple capacity toggle changes request only one redraw per page',()=>{
 const queue=[],calls=[];
 const context={requestAnimationFrame:f=>queue.push(f),renderAvailabilityChart:()=>calls.push('urgent'),renderRoutineAvailabilityChart:()=>calls.push('routine'),renderPlannedAvailabilityChart:()=>calls.push('planned')};
 vm.runInNewContext(section('const pendingAvailabilityFilterRenders=new Set();','function removeInvalidDashboardToggles()')+'\nthis.schedule=scheduleAvailabilityFilterRender;',context);
 context.schedule('urgent');context.schedule('urgent');context.schedule('routine');context.schedule('urgent');
 assert.equal(queue.length,2);queue.forEach(f=>f());assert.deepEqual(calls,['urgent','routine']);
 context.schedule('urgent');assert.equal(queue.length,3);
});

test('multiple day view toggle changes request one redraw',()=>{
 const queue=[],calls=[];
 const context={requestAnimationFrame:f=>queue.push(f),renderDayView2:()=>calls.push('draw')};
 vm.runInNewContext(section('let dayViewFilterRenderPending=false;','function renderDayView2(){')+'\nthis.schedule=scheduleDayViewFilterRender;',context);
 context.schedule();context.schedule();assert.equal(queue.length,1);queue[0]();assert.deepEqual(calls,['draw']);
});
