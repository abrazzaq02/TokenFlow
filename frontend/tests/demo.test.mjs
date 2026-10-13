let chain=Promise.resolve();function test(name,fn){chain=chain.then(async()=>{await fn();console.log('PASS:',name)})}
import assert from 'node:assert/strict';
import {demoAdminUser, demoRequest as api} from '../src/demo.js';
globalThis.location={origin:'https://queue.example.test'};const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};globalThis.window={dispatchEvent:()=>{}};
test('demo admin sign-in accepts a valid email and any non-empty password',async()=>{assert.deepEqual(demoAdminUser(' Admin@Example.test ','x'),{uid:'demo-admin',name:'Demo Administrator',email:'admin@example.test',role:'admin'});assert.throws(()=>demoAdminUser('not-an-email','x'),/valid email address/);assert.throws(()=>demoAdminUser('admin@example.test',''),/Enter a password/)});
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

test('QR ticket reads are public and update with live counter calls',async()=>{await api('/reset','POST');const t=await api('/tokens','POST',{departmentId:'bank',service:'Cash & deposits',requestId:'qr-ticket-0001',displayName:'QR visitor'},'qr-owner');const link=await api(`/tokens/${t.id}/share`,'POST',{},'qr-owner');const shareKey=new URL(link.url).hash.slice(5);let publicTicket=await api(`/public/tokens/${t.id}`,'GET',{shareKey},'scanner-device');assert.equal(publicTicket.displayName,'QR visitor');assert.equal(publicTicket.branch,'Central Bank • City Branch');assert.equal(publicTicket.issueTime,t.arrivalTime);assert.equal(publicTicket.position,8);assert.equal(publicTicket.status,'waiting');assert.equal(publicTicket.counterName,null);assert.equal('ownerUid' in publicTicket,false);assert.equal('requestId' in publicTicket,false);await api('/counters/bank-1/next','POST',{});publicTicket=await api(`/public/tokens/${t.id}`,'GET',{shareKey},'scanner-device');assert.equal(publicTicket.position,7);assert.equal(publicTicket.status,'waiting');assert.deepEqual(publicTicket.nowServing,[{tokenNumber:'BNK-001',counterName:'Counter 01'}])});

await chain;
