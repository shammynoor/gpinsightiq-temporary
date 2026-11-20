const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Papa=require('../papaparse.min.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const slot=source.slice(source.indexOf('function weekMonday('),source.indexOf('// Drag-and-drop category editor.'));
const signposting=source.slice(source.indexOf('function parseSignpostingDate('),source.indexOf('function renderSignpostingChart('));
const context=vm.createContext({Papa});vm.runInContext(slot+'\n'+signposting+'\nglobalThis.detect=detectAnalyticsReportKind;globalThis.slot=parseSlotReportCSV;globalThis.signpost=parseSignpostingCSV;',context);
const slotHeaders=['Appointment Date','Appointment Time','Booked Time to Slot Time','User Type of the Session Holder of the Session','Slot Type','Availability','Patient Age','Gender','Town of the Location of the Session'];
const slotRow=['16-Jun-2026','09:00','60','GP','Routine','Booked','30','F','Town'];
const signHeaders=['Anonymised Identifier','Age','Gender','Date',"Consultation Details' Time",'Code Term'];
const signRow=['ID-1','30','F','16-Jun-2026','09:00','Pharmacy'];
const preamble=Array.from({length:150},(_,i)=>['Report information '+i]);
test('recognises Slot Reports with headings at the top or after a long preamble',()=>{
 for(const lead of [[],preamble]){
  const csv=Papa.unparse([...lead,slotHeaders,slotRow]);
  assert.equal(context.detect(csv,'report.csv'),'slot');assert.equal(context.slot(csv).rows.length,1);
 }
});
test('recognises signposting reports with headings at the top or after a long preamble',()=>{
 for(const lead of [[],preamble]){
  const csv=Papa.unparse([...lead,signHeaders,signRow]);
  assert.equal(context.detect(csv,'report.csv'),'signposting');assert.equal(context.signpost(csv).length,1);
 }
});
test('recognises headers rather than relying on a misleading filename',()=>{
 assert.equal(context.detect(Papa.unparse([slotHeaders,slotRow]),'Signposting.csv'),'slot');
 assert.equal(context.detect(Papa.unparse([signHeaders,signRow]),'Slot Report.csv'),'signposting');
});
test('keeps supported headerless slot reports and handles heading whitespace and case',()=>{
 const headerless=Papa.unparse([slotRow]);assert.equal(context.detect(headerless,'report.csv'),'slot');assert.equal(context.slot(headerless).rows.length,1);
 const csv=Papa.unparse([slotHeaders.map(name=>' '+name.toLowerCase()+' '),slotRow]);
 assert.equal(context.detect(csv,'report.csv'),'slot');assert.equal(context.slot(csv).columns[0],'Appointment Date');
});
