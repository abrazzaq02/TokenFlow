"""Run without installing third-party packages: python -m unittest discover -s tests -p '*stdlib.py' -v."""
import os,sys,unittest,uuid,tempfile
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
from services.engine import initial,mutate,estimates,analytics,Problem
from storage import SQLiteStore
A={'uid':'admin','role':'admin','departmentIds':['*']}
def issue(s,uid=None,key=None,at=1000):return mutate(s,'create',{'departmentId':'bank','service':'Cash & deposits','requestId':key or uuid.uuid4().hex},{'uid':uid or uuid.uuid4().hex,'role':'customer'},at)
class QueueTests(unittest.TestCase):
 def test_unique_and_retry(self):
  s=initial();a=issue(s,'u','request-001');b=issue(s,'u','request-001');self.assertEqual(a['id'],b['id']);self.assertEqual(len(s['tokens']),1)
  with self.assertRaises(Problem):issue(s,'u','request-002')
 def test_waiting_and_opening(self):
  s=initial();ts=[issue(s) for _ in range(7)];self.assertEqual([estimates(s,1000)[t['id']]['estimatedWaitMinutes'] for t in ts],[0,0,5,5,10,10,15])
  mutate(s,'open',{'counterId':'bank-3'},A,1000);self.assertEqual(estimates(s,1000)[ts[-1]['id']]['estimatedWaitMinutes'],10)
 def test_fifo_and_double_assignment(self):
  s=initial();ts=[issue(s) for _ in range(2)]
  for c,t in zip(['bank-1','bank-2'],ts):self.assertEqual(mutate(s,'next',{'counterId':c},A,1000)['id'],t['id'])
  with self.assertRaises(Problem):mutate(s,'next',{'counterId':'bank-1'},A)
 def test_closed_and_busy_closure(self):
  s=initial();t=issue(s)
  with self.assertRaises(Problem):mutate(s,'next',{'counterId':'bank-3'},A)
  mutate(s,'next',{'counterId':'bank-1'},A);mutate(s,'close',{'counterId':'bank-1'},A);self.assertEqual(s['counters'][0]['currentTokenId'],t['id'])
 def test_recorded_durations(self):
  s=initial();t=issue(s);mutate(s,'next',{'counterId':'bank-1'},A,1030);mutate(s,'start',{'tokenId':t['id']},A,1120);mutate(s,'complete',{'tokenId':t['id']},A,1420)
  stats=analytics(s,['*']);self.assertEqual(stats['averageWait'],2);self.assertEqual(stats['averageService'],5);self.assertEqual(stats['completed'],1)
 def test_recall_at_end(self):
  s=initial();t=issue(s);mutate(s,'next',{'counterId':'bank-1'},A);mutate(s,'skip',{'tokenId':t['id']},A);b=issue(s);mutate(s,'recall',{'tokenId':t['id']},A);self.assertEqual(mutate(s,'next',{'counterId':'bank-1'},A)['id'],b['id'])
 def test_permissions(self):
  s=initial();t=issue(s,'owner')
  with self.assertRaises(Problem):mutate(s,'cancel',{'tokenId':t['id']},{'uid':'intruder','role':'customer'})
  with self.assertRaises(Problem):mutate(s,'open',{'counterId':'bank-3'},{'role':'staff','departmentIds':['hospital']})
  with self.assertRaises(Problem):mutate(s,'department',{'name':'x','branch':'y'},{'role':'staff'})
 def test_notification_and_no_counters(self):
  s=initial()
  for c in ['bank-1','bank-2']:mutate(s,'close',{'counterId':c},A,900)
  t=issue(s);self.assertIsNone(estimates(s,1000)[t['id']]['estimatedWaitMinutes']);self.assertFalse(t['notificationState'])
  mutate(s,'open',{'counterId':'bank-1'},A,1100);stamp=t['notificationAt'];issue(s,at=1200);self.assertEqual(t['notificationAt'],stamp)
 def test_atomic_concurrent_allocation(self):
  with tempfile.TemporaryDirectory() as d:
   db=SQLiteStore(os.path.join(d,'q.db'))
   with ThreadPoolExecutor(max_workers=8) as pool:ts=list(pool.map(lambda _:db.transact(lambda s:issue(s)),range(30)))
   self.assertEqual(len({t['tokenNumber'] for t in ts}),30)
   with ThreadPoolExecutor(max_workers=2) as pool:ts=list(pool.map(lambda c:db.transact(lambda s:mutate(s,'next',{'counterId':c},A)),['bank-1','bank-2']))
   self.assertNotEqual(ts[0]['id'],ts[1]['id'])
 def test_validation_and_rollback(self):
  with tempfile.TemporaryDirectory() as d:
   db=SQLiteStore(os.path.join(d,'q.db'))
   with self.assertRaises(Problem):db.transact(lambda s:mutate(s,'create',{'departmentId':'bank','service':'invalid','requestId':'request-1'},{'uid':'u','role':'customer'}))
   self.assertEqual(db.read()['tokens'],[])
if __name__=='__main__':unittest.main()
