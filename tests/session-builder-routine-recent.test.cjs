const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const correctness=require('../data-correctness.js');const c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('session-builder-planning.js','utf8'),c);const calculate=c.window.SessionBuilderPlanning.recentRoutineDemand;
const currentWeek='2026-11-23',weeks=Array.from({length:12},(_,i)=>correctness.shift(currentWeek,-7*(12-i))),coverage=[{start:weeks[0],end:'2026-11-22',asOf:'2026-11-23'}];
const options={monday:correctness.monday,classify:row=>row.kind?{kind:row.kind,name:row.name}:null,adjust:(_day,n)=>n*2,correctness,coverage,holidayWeeks:new Set([weeks[3]]),currentWeek};
test('planner routine matches the recent-weighted seven-day overview with list-size adjustment',()=>{
 const rows=weeks.flatMap((week,i)=>[{bookedDay:week,count:100+i*10,kind:'routine',name:'Routine'},{bookedDay:correctness.shift(week,6),count:10,kind:'routine',name:'Routine'},{bookedDay:week,count:900,kind:'planned',name:'Follow-up'}]);
 const result=calculate(rows,weeks,options),counts=new Map(weeks.map((week,i)=>[week,(110+i*10)*2])),samples=correctness.routineCompleteWeeks(weeks,counts,coverage,options.holidayWeeks),overview=correctness.routineRecentForecast(samples,currentWeek);
 assert.equal(result.need,overview.range(1).estimate);assert.equal(result.sampleWeeks,11);assert.equal(Math.ceil(result.byType.Routine),result.need);assert.equal(Object.hasOwn(result.byType,'Follow-up'),false);assert.ok(result.need>350);
});
test('multiple routine types remain independently eligible and reconcile with the aggregate',()=>{
 const rows=weeks.flatMap(week=>[{bookedDay:week,count:10,kind:'routine',name:'A'},{bookedDay:correctness.shift(week,6),count:5,kind:'routine',name:'B'}]);const result=calculate(rows,weeks,options);assert.equal(result.need,30);assert.equal(result.byType.A,20);assert.equal(result.byType.B,10);
});
test('incomplete or insufficient recent seven-day history does not silently fall back to a low historical average',()=>{
 assert.equal(calculate([],weeks.slice(0,7),{...options,holidayWeeks:new Set()}),null);assert.equal(calculate([],weeks,{...options,coverage:[]}),null);
});
