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
