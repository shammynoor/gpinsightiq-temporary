const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('full planner preserves bounded trainee spread alongside allocation and clinician share rules',async()=>{
 const c={window:{},Date,Intl};vm.createContext(c);for(const f of ['vendor/javascript-lp-solver-1.0.3.js','session-builder-planning.js','session-builder-distribution.js','session-builder-diagnostics.js','session-builder-mip.js','session-builder-optimisation.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);c.window.solver=c.solver;c.window.SessionBuilderMip.initialize(await require('../vendor/highs.js')());
 const args=JSON.parse(fs.readFileSync('tests/bounded-current-planner-fixture.json')),p=c.window.SessionBuilderOptimisation.estimate(...args),resident=Object.keys(args[5].clinicianLimits).find(n=>args[5].clinicianLimits[n].min===30);
 assert.equal(p.error,undefined);assert.equal(p.verifiedPlan,true);assert.equal(p.clinicianCounts[resident],30);
 const spread=p.ruleResults.find(r=>r.kind==='sessionDistribution');assert.equal(spread.ok,true);assert.equal(spread.adjustedForClinicianSetup,false);
 for(const m of spread.measurements){const expected=m.day===3?2:7;assert.ok(Math.abs(m.target-expected)<1e-6);assert.ok(Math.abs(m.numerator-expected)<=1+1e-6);}
 assert.equal(spread.measurements.find(m=>m.day===3).numerator,2);
 assert.ok(p.ruleResults.filter(r=>r.strength==='must').every(r=>r.ok),'other required rules must stay enforced');
 assert.ok(p.annualCost<=1500000);assert.ok(p.capacitySameDay.every((n,i)=>Number.isInteger(n)&&n>=Math.ceil(args[3].sameDay[i])));
});
