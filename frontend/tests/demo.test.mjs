let chain=Promise.resolve();function test(name,fn){chain=chain.then(async()=>{await fn();console.log('PASS:',name)})}
import assert from 'node:assert/strict';
import {demoRequest as api} from '../src/demo.js';
const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};globalThis.window={dispatchEvent:()=>{}};
test('demo customer journey, idempotency and counter transitions',async()=>{
 await api('/reset','POST');
 const ds=await api('/departments');assert.equal(ds.departments.length,5);assert.equal(ds.departments.reduce((n,d)=>n+d.openCounters,0),10);
 const p={departmentId:'bank',service:'Cash & deposits',requestId:'request-test'};const t=await api('/tokens','POST',p);assert.equal((await api('/tokens','POST',p)).id,t.id);
 let own=await api(`/tokens/${t.id}`);assert.equal(own.position,8);assert.equal(own.estimatedWaitMinutes,15);
 await api('/counters/bank-3/open','POST');own=await api(`/tokens/${t.id}`);assert.equal(own.estimatedWaitMinutes,10);
 const next=await api('/counters/bank-1/next','POST');const s=await api('/dashboard');const called=s.tokens.find(t=>t.id===next.currentTokenId);assert.equal(called.tokenNumber,'BNK-001');
 await assert.rejects(()=>api('/counters/bank-1/next','POST'));
 await api(`/tokens/${called.id}/start`,'POST');await api('/counters/bank-1/close','POST');assert.equal((await api('/dashboard')).counters.find(c=>c.id==='bank-1').currentTokenId,called.id);
 await api(`/tokens/${called.id}/complete`,'POST');assert.equal((await api('/analytics')).completed,1);
 await api(`/tokens/${t.id}/cancel`,'POST');assert.equal((await api(`/tokens/${t.id}`)).status,'cancelled');
});
test('simulator adds explicit synthetic arrivals and reset restores baseline',async()=>{await api('/reset','POST');const before=(await api('/analytics')).issued;await api('/simulate','POST',{departmentId:'hospital',count:5});assert.equal((await api('/analytics')).issued,before+5);await api('/reset','POST');assert.equal((await api('/analytics')).issued,before)});

test('showcase accounts keep customer tickets private',async()=>{await api('/reset','POST');const first=await api('/tokens','POST',{departmentId:'bank',service:'Cash & deposits',requestId:'account-a-0001'},'user-a');const second=await api('/tokens','POST',{departmentId:'bank',service:'Cash & deposits',requestId:'account-b-0001'},'user-b');assert.equal((await api('/tokens','GET',{},'user-a')).length,1);assert.equal((await api('/tokens','GET',{},'user-b')).length,1);assert.notEqual(first.id,second.id);await assert.rejects(()=>api(`/tokens/${first.id}`,'GET',{},'user-b'),/another demo visitor/)});

await chain;
