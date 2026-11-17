const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function section(start,end){
 const from=source.indexOf(start),to=source.indexOf(end,from);
 assert(from>=0&&to>from,'expected chart code');
 return source.slice(from,to);
}
const context=vm.createContext({Date,Set,Map,String,Number});
vm.runInContext(`
 let availabilityRecords=[];
 let monthlyMode=false,thisMonth='2026-11',thisWeek='2026-11-16',showCurrentWeek=true;
 let demandMonthStart=null,demandMonthEnd=null,disabledDemandUrgencyGroups=new Set();
 function historicalBookingRecords(){return [{bookedWeek:'2026-11-09',bookedDay:'2026-11-09',count:1,slot:'blocked'}]}
 function includedRecord(){return true}
 function periodKey(r){return r.bookedWeek}
 function periodIsCurrent(p){return p===thisWeek}
 function mondayOf(d){return d}
 function capacityUrgencyCategory(){return 'Routine'}
 `+section('let historicAvailabilitySource=null','function historicBookingFilterCounts()')+
 section('function historicBookingHasData()','let appointmentBulkFilterChange=false;')+`
 globalThis.setRows=rows=>availabilityRecords=rows;
 globalThis.getSummary=historicAvailabilityDates;
 globalThis.hasData=historicBookingHasData;
 `,context);
let reads=0;
const rows=[{get date(){reads++;return '2026-11-10'},availability:'Booked'},{date:'2026-10-01',availability:'Available'}];
context.setRows(rows);
const summary=context.getSummary();
assert.equal(summary.first,'2026-11-10');
assert.equal(summary.last,'2026-11-10');
assert.deepEqual(Array.from(summary.months),['2026-10','2026-11']);
const previousReads=reads;
context.getSummary();
assert.equal(reads,previousReads,'repeated toggles should not rescan availability');
context.setRows([{date:'2026-10-01',availability:'Booked'}]);
assert.equal(context.getSummary().first,'2026-10-01','replacing reports invalidates cache');
// The availability bounds are absent so the assumed booked row is eligible.
context.setRows([]);
assert.equal(context.hasData(),true,'past blocked-only bookings must allow filters to remain selected');
console.log('Historic toggle cache and blocked-only history checks passed.');
