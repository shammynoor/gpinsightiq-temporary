const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {calculate,holderTokens,holderColumn}=require('../sessions-history.js');
const clock={date:'2026-11-20',minute:720};
const row=(person,date,minute,clinician='Partner',sessionCategory='Core')=>({person,date,minute,clinician,sessionCategory,slot:'Routine',source:'slot',availability:'Booked',count:1});
const type=r=>r.clinician,locum=r=>r.sessionCategory==='Locum';
test('distinct clinicians and half-days are counted once with requested cutoffs',()=>{
 const rows=[row('h1:a','2026-11-16',540),row('h1:a','2026-11-16',779),row('h1:a','2026-11-16',780),row('h1:a','2026-11-16',839),row('h1:a','2026-11-16',840),row('h1:b','2026-11-16',600,'GP','Locum'),row('h1:c','2026-11-20',730),row('h1:c','2026-11-21',500)];
 const result=calculate(rows,clock,type,locum);
 assert.equal(result.totals.get('2026-11-16').get('Partner'),2);
 assert.equal(result.totals.get('2026-11-16').get('GP · Locum'),1);
 assert.ok(!result.totals.get('2026-11-16').has('Other'));
});
test('unknown identities and missing times mark incomplete weeks; unavailable slots do not count',()=>{
 const missing={...row('','2026-11-16',550)},unknownTime=row('h1:a','2026-11-16',null);
 const available={...row('h1:b','2026-11-16',600),availability:'Available'};
 const result=calculate([missing,unknownTime,available],clock,type,locum);
 assert.equal(result.incomplete.get('2026-11-16'),true);assert.equal(result.totals.size,0);
});
test('partial coverage and the current week are marked incomplete',()=>{
 const rows=[row('h1:a','2026-11-09',600),row('h1:a','2026-11-16',600)];
 const coverage=[{start:'2026-11-09',end:'2026-12-01',asOf:'2026-11-20'}];
 const result=calculate(rows,clock,type,locum,new Set(),coverage);
 assert.equal(result.incomplete.has('2026-11-09'),false);
 assert.equal(result.incomplete.has('2026-11-16'),true);
});
test('a clinician is counted once even when type classifications disagree',()=>{
 const result=calculate([row('h1:a','2026-11-16',600,'Partner'),row('h1:a','2026-11-16',610,'Salaried','Locum')],clock,type,locum);
 assert.equal(result.totals.get('2026-11-16').get('Multiple clinician types · Locum'),1);
});
test('holder names become stable practice-scoped pseudonyms',async()=>{
 const parsed={columns:[holderColumn],rows:[['Alice Example'],[' Alice Example '],['Bob Example']]};
 const a=await holderTokens(parsed,'practice-1',crypto.webcrypto),b=await holderTokens(parsed,'practice-2',crypto.webcrypto);
 assert.equal(a.get('Alice Example'),a.get(' Alice Example '.trim()));
 assert.notEqual(a.get('Alice Example'),b.get('Alice Example'));
 assert.match(a.get('Alice Example'),/^h1:[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify([...a.values()]).includes('Alice'));
});
test('uploaded names are replaced by pseudonyms in saved report aggregates',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),Papa=require('../papaparse.min.js');
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const code=source.slice(source.indexOf('function weekMonday('),source.indexOf('// Drag-and-drop category editor.'));
 const context=vm.createContext({Papa});vm.runInContext(code,context);
 const header=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',holderColumn];
 const csv=Papa.unparse([header,['16-Jun-25','09:00','60','GP','Routine','Booked','Alice Example']]);
 const parsed=context.parseSlotReportCSV(csv),tokens=await holderTokens(parsed,'practice',crypto.webcrypto);
 const maps=Array.from({length:8},()=>new Map());context.aggregateCSV(csv,...maps,tokens);
 assert.ok([...maps[1].keys()][0].includes('h1:'));
 for(const map of maps)assert.ok(!JSON.stringify([...map]).includes('Alice Example'));
});
test('weekly snapshot reconciliation preserves holder pseudonyms',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),Papa=require('../papaparse.min.js'),{reconcile}=require('../rolling-slot-snapshots.js');
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const context=vm.createContext({Papa});vm.runInContext(source.slice(source.indexOf('function weekMonday('),source.indexOf('// Drag-and-drop category editor.')),context);
 const h=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',holderColumn,"Session's Session Category"];
 const make=async rows=>{const csv=Papa.unparse([h,...rows]),parsed=context.parseSlotReportCSV(csv),tokens=await holderTokens(parsed,'practice',crypto.webcrypto),maps=Array.from({length:8},()=>new Map());context.aggregateCSV(csv,...maps,tokens);return {kind:'slot',maps}};
 const old=await make([['10-Jun-25','09:00','60','GP','Routine','Booked','Alice Example','Core'],['17-Jun-25','09:00','60','GP','Routine','Booked','Alice Example','Core']]);
 const next=await make([['17-Jun-25','09:00','60','GP','Routine','Booked','Alice Example','Core']]);next.snapshotType='rolling-weekly';next.snapshotFrom='2025-06-16';
 const rows=reconcile([{key:'old',clinicalAt:'2025-06-20T12:00:00Z',contribution:old},{key:'new',clinicalAt:'2025-06-23T12:00:00Z',contribution:next}]);
 for(const map of [0,1,2,5,6,7])assert.ok([...rows[0].contribution.maps[map].keys()].some(key=>key.includes('h1:')),'map '+map);
});
test('sessions history rendering exits before accessing data for non-admins',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../workforce-planning.js'),'utf8');
 const code=source.slice(source.indexOf('function renderSessionsHistory(){'),source.indexOf('function renderWorkforcePlanning(){'));
 const context=vm.createContext({isOwner:false,$:()=>{throw Error('Viewer must not access history')}});
 vm.runInContext(code,context);assert.doesNotThrow(()=>context.renderSessionsHistory());
});
