const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate,averageWeeklyForecast,historicalRate,historicalCareType,allocateProjectedNeed,calculateAchievable}=require('../workforce-planner.js');
const demand={urgent:40,routine:60};
const rows=[{name:'GP',urgent:0,routine:100,perSession:12,perWte:6},{name:'Urgent team',urgent:100,routine:0,perSession:10,perWte:4}];
test('allocates forecasts and derives sessions and WTE from editable assumptions',()=>{
 const r=calculate(demand,rows);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].appts,60);assert.equal(r.rows[0].sessions,5);assert.equal(r.rows[1].sessions,4);assert.equal(r.totalSessions,9);assert.ok(Math.abs(r.totalWte-11/6)<1e-9);
});
test('requires valid allocations and forecast',()=>{
 assert.ok(calculate(demand,[{...rows[0],routine:80},rows[1]]).errors.length);
 assert.ok(calculate({...demand,urgent:null},rows).errors.length);
 assert.ok(calculate(demand,[{...rows[0],urgent:-1},rows[1]]).errors.length);
});
test('does not invent staffing rates and rejects invalid rates',()=>{
 const r=calculate(demand,[{...rows[0],perWte:null},rows[1]]);assert.equal(r.rows[0].wte,null);assert.equal(r.totalWte,null);
 assert.equal(calculate(demand,[{...rows[0],perSession:null},rows[1]]).totalSessions,null);
 assert.ok(calculate(demand,[{...rows[0],perSession:-1},rows[1]]).errors.length);
});

test('averages every forecast week and refuses incomplete horizons',()=>{
 const weeks=Array.from({length:52},(_,i)=>i+1);
 assert.equal(averageWeeklyForecast(weeks.slice(0,4)),2.5);
 assert.equal(averageWeeklyForecast(weeks.slice(0,12)),6.5);
 assert.equal(averageWeeklyForecast(weeks),26.5);
 weeks[45]=undefined;assert.equal(averageWeeklyForecast(weeks),null);
 assert.equal(averageWeeklyForecast([]),null);
});

test('historical rates and totals use actual sessions as the denominator',()=>{
 const types=[{urgentCount:30,routineCount:10,sessions:4},{urgentCount:10,routineCount:30,sessions:2}];
 assert.equal(historicalRate([types[0]],'urgentCount'),7.5);
 assert.equal(historicalRate([types[1]],'routineCount'),15);
 assert.equal(historicalRate(types,'urgentCount'),40/6);
 assert.equal(historicalRate([{urgentCount:0,sessions:0}],'urgentCount'),null);
});

test('separates follow-up and home visit types from routine and urgent bookings',()=>{
 assert.equal(historicalCareType('Follow-Up','Planned Care',''), 'followup');
 assert.equal(historicalCareType('Follow up','Routine Care','routine'), 'followup');
 assert.equal(historicalCareType('Visit','Home Visiting',''), 'visit');
 assert.equal(historicalCareType('GP home visits','Home Visiting',''), 'visit');
 assert.equal(historicalCareType('Routine','Routine Care','routine'), 'routine');
 assert.equal(historicalCareType('Same Day','Urgent Care','urgent'), 'urgent');
 assert.equal(historicalCareType('Other','Other',''), '');
});

test('allocates total projected need across historical clinician shares',()=>{
 const rows=[{urgentCount:30,followupCount:10},{urgentCount:70,followupCount:0}];
 assert.deepEqual(allocateProjectedNeed(400,rows,'urgentCount'),[120,280]);
 assert.deepEqual(allocateProjectedNeed(12,rows,'followupCount'),[12,0]);
 assert.deepEqual(allocateProjectedNeed(null,rows,'urgentCount'),[null,null]);
 assert.deepEqual(allocateProjectedNeed(12,rows,'visitCount'),[null,null]);
 assert.deepEqual(allocateProjectedNeed(12,[{visitCount:0}],'visitCount'),[null]);
 assert.deepEqual(allocateProjectedNeed(0,[{visitCount:0}],'visitCount'),[0]);
});

test('weekly achievable appointments multiply each type’s historical rate by planned sessions',()=>{
 const a={sessions:10,urgentCount:21,routineCount:24,followupCount:35,visitCount:3};
 const b={sessions:4,urgentCount:8,routineCount:0,followupCount:4,visitCount:0};
 const result=calculateAchievable([{weeklySessions:4,history:a},{weeklySessions:2,history:b}]);
 assert.deepEqual(result.values,{urgent:12.4,routine:9.6,followup:16,visit:1.2});
 assert.equal(result.totalSessions,6);
});
test('blank or invalid planned sessions and missing rates never imply complete capacity',()=>{
 const history={sessions:1,urgentCount:2,routineCount:3,followupCount:1,visitCount:0};
 assert.equal(calculateAchievable([{weeklySessions:null,history}]).values.urgent,null);
 assert.equal(calculateAchievable([{weeklySessions:-1,history}]).values.urgent,null);
 assert.equal(calculateAchievable([{weeklySessions:3,history:{sessions:0}}]).values.urgent,null);
 assert.deepEqual(calculateAchievable([{weeklySessions:0,history:{sessions:0}}]).values,{urgent:0,routine:0,followup:0,visit:0});
});
