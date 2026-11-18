const test=require('node:test'),assert=require('node:assert/strict');
const {breakTrace,segments}=require('../chart-zero-transitions.js');
test('line breaks only when zero is followed by a positive value',()=>{
 const input={type:'scatter',mode:'lines+markers',x:[1,2,3,4,5],y:[0,0,5,0,3],customdata:['a','b','c','d','e']};
 const out=breakTrace(input);
 assert.deepEqual(out.x,[1,2,3,3,4,5,5]);assert.deepEqual(out.y,[0,0,null,5,0,null,3]);
 assert.deepEqual(out.customdata,['a','b',null,'c','d',null,'e']);assert.deepEqual(input.y,[0,0,5,0,3]);
});
test('stacked series adds a vertical edge without changing actual totals',()=>{
 const input={type:'scatter',mode:'lines',stackgroup:'a',x:[1,2,3],y:[0,5,8]};const out=breakTrace(input);
 assert.deepEqual(out.x,[1,2,2,3]);assert.deepEqual(out.y,[0,0,5,8]);
});
test('other charts and missing or negative values are unaffected',()=>{
 const bar={type:'bar',x:[1,2],y:[0,5]};assert.equal(breakTrace(bar),bar);
 const gaps={type:'scatter',mode:'lines',x:[1,2,3,4],y:[0,null,3,-1]};assert.equal(breakTrace(gaps),gaps);
 assert.deepEqual(segments([0,0,2,3,0,4]),[[0,1],[2,3,4],[5]]);
});
