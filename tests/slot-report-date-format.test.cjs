const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const start=source.indexOf('function parseDate(s)'),end=source.indexOf('\n',start);
const context=vm.createContext({});vm.runInContext(source.slice(start,end),context);
test('slot report dates accept two- and four-digit years and reject invalid dates',()=>{
 assert.equal(context.parseDate('16-Jun-25').toISOString().slice(0,10),'2025-06-16');
 assert.equal(context.parseDate('16-Jun-2025').toISOString().slice(0,10),'2025-06-16');
 assert.equal(context.parseDate('29-Feb-25'),null);
 assert.equal(context.parseDate('31-Feb-2025'),null);
});
