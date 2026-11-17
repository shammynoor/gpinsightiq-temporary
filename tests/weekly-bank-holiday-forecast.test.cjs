const test=require('node:test');
const assert=require('node:assert/strict');
const {weeklyAllocationDay}=require('../data-correctness.js');

test('holiday estimate cannot reduce a weekly allocation, but can increase it',()=>{
 assert.equal(weeklyAllocationDay(86,30),86);
 assert.equal(weeklyAllocationDay(86,105),105);
 assert.equal(weeklyAllocationDay(86,undefined),86);
 assert.equal(weeklyAllocationDay(undefined,105),105);
 assert.equal(weeklyAllocationDay(undefined,undefined),undefined);
 assert.equal(weeklyAllocationDay(0,0),0);
});

test('Christmas and New Year working-day allocations use each weekday forecast',()=>{
 // Fitted weekday and holiday estimates from the practice forecast used for the preview.
 const cases=[
  {days:[[85.194],[52.475],[49.675],[43.721,9.976]],expected:232},
  {days:[[52.835,29.907],[49.847],[43.778,9.976]],expected:147},
  {days:[[86.025,29.907],[53.214],[50.050],[43.870],[26.770]],expected:260},
  {days:[[86.457],[53.612],[50.289],[44.001],[26.926]],expected:262}
 ];
 for(const {days,expected} of cases){
  const sum=days.reduce((total,[normal,holiday])=>total+weeklyAllocationDay(normal,holiday),0);
  assert.equal(Math.ceil(sum),expected);
 }
});

test('a shorter holiday week excludes closed days and preserves a higher holiday forecast',()=>{
 const workingDays=[[70,100],[45],[50],[40]];
 assert.equal(Math.ceil(workingDays.reduce((sum,[normal,holiday])=>sum+weeklyAllocationDay(normal,holiday),0)),235);
});

test('phase-in reduces the increase by 25% in the three specified weeks only',()=>{
 const cases=[
  {week:'2026-12-21',days:[[85.194],[52.475],[49.675],[43.721,9.976]],expected:223},
  {week:'2026-12-28',days:[[52.835,29.907],[49.847],[43.778,9.976]],expected:133},
  {week:'2027-01-04',days:[[86.025,29.907],[53.214],[50.050],[43.870],[26.770]],expected:246}
 ];
 for(const {week,days,expected} of cases){
  const sum=days.reduce((total,[normal,holiday])=>total+weeklyAllocationDay(normal,holiday,week),0);
  assert.equal(Math.ceil(sum),expected);
 }
 assert.equal(weeklyAllocationDay(100,50,'2027-01-11'),100);
 assert.equal(weeklyAllocationDay(100,50,'2027-12-27'),100);
 assert.equal(weeklyAllocationDay(50,100,'2026-12-28'),100);
});
