const assert=require('node:assert/strict');
const {reconcile}=require('../rolling-slot-snapshots.js');
const add=(m,k,n)=>m.set(JSON.stringify(k),(m.get(JSON.stringify(k))||0)+n);
function contribution(rows,snapshotFrom){
 const maps=Array.from({length:8},()=>new Map());
 for(const r of rows){const {date,status,slot='GP',clinician='Doctor',count=1,bookedDay='2026-10-31',minute=600,lead=1440}=r,person='',month=date.slice(0,7);
  add(maps[1],[date,slot,status,clinician,person,minute,'slot'],count);
  const stat=maps[4].get(slot)||{count:0,min:date,max:date};stat.count+=count;stat.min=stat.min<date?stat.min:date;stat.max=stat.max>date?stat.max:date;maps[4].set(slot,stat);
  if(status==='Booked'){
   add(maps[7],[date,bookedDay,minute,slot,clinician,person,'slot'],count);
   add(maps[0],[bookedDay,slot,clinician,person],count);
   add(maps[2],[bookedDay,minute,slot,clinician,person],count);
   add(maps[6],[slot,clinician,person,month,date,lead],count);
   add(maps[5],[slot,Math.floor(lead/1440),clinician,person,month],count);
  }
 }
 return {kind:'slot',maps,valid:0,skipped:0,...(snapshotFrom?{snapshotType:'rolling-weekly',snapshotFrom}:{})};
}
const entry=(key,at,c)=>({key,clinicalAt:at+'T12:00:00Z',contribution:c});
const baseline=entry('old','2026-11-08',contribution([{date:'2026-11-01',status:'Booked',count:3},{date:'2026-11-10',status:'Available',count:4},{date:'2026-11-17',status:'Booked',count:8}]));
const w1=entry('week1','2026-11-16',contribution([{date:'2026-11-10',status:'Booked',count:2},{date:'2026-11-17',status:'Blocked',count:3},{date:'2026-11-22',status:'Available',count:4}],'2026-11-09'));
const w2=entry('week2','2026-11-20',contribution([{date:'2026-11-17',status:'Booked',count:5},{date:'2026-11-23',status:'Available',count:1}],'2026-11-13'));
const combined=es=>{const counts=new Map();for(const e of reconcile(es))for(const [key,value] of e.contribution.maps[1]){const [d,,s]=JSON.parse(key);counts.set(d+' '+s,(counts.get(d+' '+s)||0)+value)}return Object.fromEntries(counts)};
assert.deepEqual(combined([baseline,w1]),{'2026-11-01 Booked':3,'2026-11-10 Booked':2,'2026-11-17 Blocked':3,'2026-11-22 Available':4});
assert.deepEqual(combined([w2,baseline,w1]),{'2026-11-17 Booked':5,'2026-11-23 Available':1,'2026-11-01 Booked':3,'2026-11-10 Booked':2});
const effective=reconcile([baseline,w1,w2]);assert.equal([...effective[0].contribution.maps[0].values()].reduce((a,b)=>a+b,0),3);assert.equal([...effective[1].contribution.maps[0].values()].reduce((a,b)=>a+b,0),2);assert.equal([...effective[2].contribution.maps[0].values()].reduce((a,b)=>a+b,0),5);
const {validateHistoricalReplacement}=require('../rolling-slot-snapshots.js');
const historicalReplacement=contribution([{date:'2026-11-01',status:'Booked',count:7},{date:'2026-11-10',status:'Blocked',count:3},{date:'2026-11-17',status:'Booked',count:99}]);
validateHistoricalReplacement(baseline.contribution,historicalReplacement);
assert.deepEqual(combined([{...baseline,contribution:historicalReplacement},w1,w2]),{'2026-11-01 Booked':7,'2026-11-10 Booked':2,'2026-11-17 Booked':5,'2026-11-23 Available':1});
assert.throws(()=>validateHistoricalReplacement(baseline.contribution,contribution([{date:'2026-10-31',status:'Booked',count:1}])),/outside the original report/);
assert.throws(()=>validateHistoricalReplacement(w1.contribution,historicalReplacement),/historical Slot Report/);
for(const idx of [2,5,6,7]){assert.equal([...effective[0].contribution.maps[idx].values()].reduce((a,b)=>a+b,0),3);assert.equal([...effective[1].contribution.maps[idx].values()].reduce((a,b)=>a+b,0),2);assert.equal([...effective[2].contribution.maps[idx].values()].reduce((a,b)=>a+b,0),5);}
assert.equal([...effective[0].contribution.maps[4].values()][0].max,'2026-11-01');
const broken=entry('broken','2026-11-08',contribution([{date:'2026-11-17',status:'Booked'}]));broken.contribution.maps[0].clear();assert.throws(()=>reconcile([broken,w1]),/lacks the date detail/);
const vm=require('node:vm');
const crossFrame={...baseline,contribution:{...baseline.contribution,maps:baseline.contribution.maps.map(map=>vm.runInNewContext('new Map(entries)',{entries:[...map]}))}};
assert.deepEqual(combined([crossFrame,w1]),combined([baseline,w1]));
const notMap={...baseline,contribution:{...baseline.contribution,maps:baseline.contribution.maps.map((map,i)=>i===2?{}:map)}};
assert.throws(()=>reconcile([notMap,w1]),/cannot be reconciled safely/);
assert.equal(reconcile([baseline])[0],baseline);
const invalid=entry('invalid','2026-11-20',contribution([], '2026-11-14'));assert.throws(()=>reconcile([baseline,invalid]),/inconsistent coverage dates/);
assert.deepEqual(combined([baseline,w1]),combined([baseline,w1]));
console.log('Rolling snapshots: history, status changes, removed appointments, repeated overlapping windows, future bookings, unordered sources, safe rejection and original reports passed.');
