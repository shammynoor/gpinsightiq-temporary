const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Papa=require('../papaparse.min.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const code=source.slice(source.indexOf('function parseSignpostingDate('),source.indexOf('function renderSignpostingChart('));
const context=vm.createContext({Papa});vm.runInContext(code+'\nglobalThis.parse=parseSignpostingCSV;globalThis.detect=signpostingHeader;',context);
const headers=['Anonymised Identifier','Age','Gender','Date',"Consultation Details' Time",'Code Term',''];
const rows=[['ID-1','40','F','02-Nov-2026','09:00','Pharmacy',''],['','','','','09:05','Community service',''],['ID-2','50','M','03-Nov-2026','10:00','GP','']];
test('recognises a signposting report with title and metadata before its header',()=>{
 const csv=Papa.unparse([['Signposting Auto Report'],[],['Parent Population','Signposting'],[],...Array.from({length:5},()=>[]),headers,...rows]);
 const preview=Papa.parse(csv,{header:false,preview:100,skipEmptyLines:false});
 assert.equal(context.detect(preview.data).index,9);
 const result=context.parse(csv);assert.equal(result.length,3);
 assert.equal(result[0].date,'2026-11-02');assert.equal(result[1].date,'2026-11-02');assert.equal(result[1].destination,'Community service');
 assert.deepEqual(Object.keys(result[0]).sort(),['date','destination','time']);assert.ok(!JSON.stringify(result).includes('ID-1'));
});
test('still recognises reports starting directly with headings and trims heading whitespace',()=>{
 const csv=Papa.unparse([headers.map((h,i)=>i<6?' '+h+' ':h),...rows]);
 const preview=Papa.parse(csv,{header:false,preview:100,skipEmptyLines:false});assert.equal(context.detect(preview.data).index,0);assert.equal(context.parse(csv).length,3);
});
test('reports missing required headings without creating a contribution',()=>{
 const csv=Papa.unparse([['Report'],['Date','Code Term'],['02-Nov-2026','Pharmacy']]);
 assert.throws(()=>context.parse(csv),/missing expected columns/);
});
