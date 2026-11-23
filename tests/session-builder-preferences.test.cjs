const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');const code=source.slice(source.indexOf('function chartControlKey('),source.indexOf('function chartControlValue('));const context={};vm.createContext(context);vm.runInContext(code,context);
function control(page,type,label){return {type,tagName:type==='select'?'SELECT':'INPUT',dataset:{},id:'',matches:()=>true,hasAttribute:()=>false,getAttribute:()=>'',closest:selector=>selector==='[id$="Page"]'?{id:page}:selector==='label'?{textContent:label}:selector==='[id]'?{id:page==='sessionBuilderPage'?'sessionBuilderBody':'chartBody'}:null,parentElement:{textContent:label}};}
test('shared session settings are excluded from personal chart preference restore',()=>{
 for(const type of ['checkbox','select','number','text'])assert.equal(context.chartControlKey(control('sessionBuilderPage',type,'Same Day')),null);
});
test('other chart filters retain personal preferences',()=>{assert.equal(context.chartControlKey(control('chartPage','checkbox','Same Day')),'checkbox:chartPage:chartBody:Same Day');});
