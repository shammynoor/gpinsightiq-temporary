import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {passwordProblem,passwordAuthError} from '../password-policy.mjs';
import {makeHandler} from '../supabase/functions/iq-viewer-access-pages/handler.mjs';

assert.equal(passwordProblem('Example123'), '');
assert.match(passwordProblem('Short1a'),/at least 10/);
assert.match(passwordProblem('lowercase12'),/uppercase/);
assert.match(passwordProblem('UPPERCASE12'),/lowercase/);
assert.match(passwordProblem('NoNumbersHere'),/number/);
assert.equal(passwordProblem('Example123!'), '');
assert.equal(passwordProblem('Aa1'+'x'.repeat(69)), '');
assert.match(passwordProblem('Aa1'+'x'.repeat(70)),/too long/);
assert.match(passwordProblem('Aa1'+'😀'.repeat(18)),/72 bytes/);
assert.match(passwordAuthError({code:'weak_password',reasons:['pwned']}).message,/data breach/);
assert.match(passwordAuthError({code:'weak_password',reasons:['characters']}).message,/uppercase/);
assert.equal(await readFile('password-policy.mjs','utf8'),await readFile('supabase/functions/iq-viewer-access-pages/password-policy.mjs','utf8'));

let created=0,weak=false;
const service={rpc:async()=>({data:{role:'viewer',confirmed:false,administrator_email:null},error:null}),auth:{admin:{createUser:async()=>{created++;return weak?{data:{user:null},error:{code:'weak_password',reasons:['pwned']}}:{data:{user:{id:'test'}},error:null}},updateUserById:async()=>{throw Error('Unexpected update')}}}};
const handler=makeHandler({env:()=> 'present',createClient:()=>service,fetch:()=>{throw Error('Unexpected email')}});
const token='123e4567-e89b-12d3-a456-426614174000';
async function register(body){const response=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'register',token,email:'person@example.test',password:'Example123',...body})}));return {status:response.status,body:await response.json()};}
assert.match((await register({token:'bad'})).body.error,/invitation link/i);
assert.match((await register({email:'bad'})).body.error,/email address/i);
assert.match((await register({password:'short'})).body.error,/at least 10/i);
assert.match((await register({password:'lowercase12'})).body.error,/uppercase/i);
assert.equal(created,0);
assert.equal((await register({})).status,200);assert.equal(created,1);
weak=true;const denied=await register({});assert.equal(denied.status,400);assert.match(denied.body.error,/data breach/i);
console.log('Password tests passed: ten-character policy, missing requirements, byte limit, invitation/email errors and leaked-password response.');
