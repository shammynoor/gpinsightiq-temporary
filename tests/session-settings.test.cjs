const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Papa=require('../papaparse.min.js');
const src=fs.readFileSync(require.resolve('../app.js'),'utf8');
const code=src.slice(src.indexOf('function weekMonday('),src.indexOf('// Drag-and-drop category editor.'));
const context=vm.createContext({Papa});vm.runInContext(code,context);
test('session categories are collected from valid appointments without changing counts',()=>{
 const header=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',"Session's Session Category"];
 const csv=Papa.unparse([header,['16-Jun-25','09:00','60','GP','Routine','Booked','Locum clinic'],['','09:15','60','GP','Routine','Booked',''],['17-Jun-25','10:00','','GP','Routine','Available','Core clinic']]);
 const maps=Array.from({length:8},()=>new Map());const result=context.aggregateCSV(csv,...maps);
 assert.equal(result.valid,2);assert.deepEqual(Array.from(result.sessionCategories),['Core clinic','Locum clinic']);assert.equal([...maps[1].values()].reduce((a,b)=>a+b,0),3);
});
test('session category heading accepts punctuation and case variations',()=>{
 for(const heading of ['Sessions Session Category',"Session's Session Category",'SESSION’S SESSION CATEGORY']){
  const header=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',heading];
  const csv=Papa.unparse([header,['16-Jun-25','09:00','60','GP','Routine','Booked','Locum clinic']]);
  const maps=Array.from({length:8},()=>new Map());
  assert.deepEqual(Array.from(context.aggregateCSV(csv,...maps).sessionCategories),['Locum clinic']);
 }
});
test('same user type is kept separate for different session categories',()=>{
 const header=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',"Session's Session Category"];
 const csv=Papa.unparse([header,['16-Jun-25','09:00','60','GP','Routine','Booked','Core'],['16-Jun-25','09:00','60','GP','Routine','Booked','Locum']]);
 const maps=Array.from({length:8},()=>new Map());context.aggregateCSV(csv,...maps);
 assert.equal(maps[0].size,2);assert.equal(maps[1].size,2);assert.equal(maps[7].size,2);
 assert.deepEqual([...maps[0].keys()].map(k=>JSON.parse(k).at(-1)).sort(),['Core','Locum']);
});
test('locum if user or session is classified as locum',()=>{
 const start=src.indexOf('function locumCategory(row)'),end=src.indexOf('function locumMatches',start);
 const c=vm.createContext({userTypeLocum:{'GP':'no','Agency':'yes'},sessionCategoryLocum:{'Locum':'yes','Core':'no'}});vm.runInContext(src.slice(start,end),c);
 for(const [row,want] of [[{clinician:'GP',sessionCategory:'Locum'},'Locum'],[{clinician:'Agency',sessionCategory:'Core'},'Locum'],[{clinician:'GP',sessionCategory:'Core'},'Not Locum'],[{clinician:'GP'},'Not Locum']])assert.equal(c.locumCategory(row),want);
});
test('weekly reconciliation preserves session categories in retained booking and waiting data',()=>{
 const {reconcile}=require('../rolling-slot-snapshots.js');
 const header=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability',"Session's Session Category"];
 const make=rows=>{const maps=Array.from({length:8},()=>new Map());context.aggregateCSV(Papa.unparse([header,...rows]),...maps);return {kind:'slot',maps}};
 const old=make([['10-Jun-25','09:00','60','GP','Routine','Booked','Locum'],['17-Jun-25','09:00','60','GP','Routine','Booked','Core']]);
 const newer=make([['17-Jun-25','09:00','60','GP','Routine','Booked','Core']]);newer.snapshotType='rolling-weekly';newer.snapshotFrom='2025-06-16';
 const result=reconcile([{key:'old',clinicalAt:'2025-06-20T12:00:00Z',contribution:old},{key:'new',clinicalAt:'2025-06-23T12:00:00Z',contribution:newer}]);
 for(const index of [0,1,2,5,6,7])assert.ok([...result[0].contribution.maps[index].keys()].some(k=>JSON.parse(k).includes('Locum')),'map '+index);
});
