const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../workforce-planner.js');
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
