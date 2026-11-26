const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {routineCompleteWeeks,routineRecentForecast,shift}=require('../data-correctness.js');
const current='2026-11-23';
const weeks=counts=>counts.map((count,index)=>({weekStart:shift(current,-7*(counts.length-index)),count}));
test('a constant seven-day history produces a stable non-seasonal forecast',()=>{
 const p=routineRecentForecast(weeks(Array(16).fill(400)),current);assert.equal(p.range(1).estimate,400);assert.equal(p.range(4).estimate,400);assert.equal(p.range(4).low,400);assert.equal(p.range(4).high,400);
});
test('recent complete weeks dominate old history without imposing a trend',()=>{
 const p=routineRecentForecast(weeks([...Array(8).fill(300),400,450,480,500]),current);assert.ok(p.range(1).estimate>=470);assert.equal(p.range(1).estimate,p.range(4).estimate);assert.ok(p.range(1).low<=p.range(1).estimate);assert.ok(p.range(1).high>=p.range(1).estimate);
});
test('partial current or future weeks do not influence the forecast',()=>{
 const base=weeks(Array(12).fill(400)),a=routineRecentForecast(base,current),b=routineRecentForecast([...base,{weekStart:current,count:900},{weekStart:shift(current,7),count:1000}],current);assert.equal(a.range(1).estimate,b.range(1).estimate);
});
test('missing or stale complete history does not produce an invented forecast',()=>{
 assert.equal(routineRecentForecast(weeks(Array(7).fill(400)),current),null);assert.equal(routineRecentForecast(weeks(Array(12).fill(400)).slice(0,-4),current),null);
});
test('real zero-booking weeks are included and sparse histories do not invent prediction intervals',()=>{
 const p=routineRecentForecast(weeks([100,100,100,100,100,100,100,0]),current);assert.equal(p.range(1).estimate,50);assert.equal(p.range(1).low,null);assert.equal(p.range(1).high,null);
});
test('routine overview uses full report-covered weeks and the recent forecast',()=>{
 const src=fs.readFileSync('home-overview.js','utf8');assert.match(src,/routineCompleteWeeks\(weekDates,adjustedCounts,coverage,holidayWeeks\)/);assert.match(src,/routineRecentForecast\(completedWeeks,presentMonday\)/);assert.match(src,/non-seasonal forecast; includes weekend bookings/);
});

test('seven-day coverage excludes holidays and incomplete snapshots but retains covered zero weeks',()=>{
 const weeks=['2026-10-26','2026-11-02','2026-11-09','2026-11-16'];
 const counts=new Map([['2026-10-26',450],['2026-11-02',460],['2026-11-16',500]]);
 const coverage=[{start:'2026-10-26',end:'2026-11-30',asOf:'2026-11-22'}];
 assert.deepEqual(routineCompleteWeeks(weeks,counts,coverage,new Set(['2026-11-02'])),[{weekStart:'2026-10-26',count:450},{weekStart:'2026-11-09',count:0}]);
});
