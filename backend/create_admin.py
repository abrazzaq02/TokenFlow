"""Trusted local operator only. Never expose this as a public API endpoint."""
import argparse
from dotenv import load_dotenv
load_dotenv()
import firebase_admin
from firebase_admin import auth,firestore
p=argparse.ArgumentParser();p.add_argument('--email',required=True);p.add_argument('--departments',nargs='+',default=['*']);a=p.parse_args()
firebase_admin.initialize_app();u=auth.get_user_by_email(a.email)
firestore.client().collection('users').document(u.uid).set({'uid':u.uid,'displayName':u.display_name or 'Admin','role':'admin','departmentIds':a.departments,'isActive':True})
print('Assigned Admin role to the existing Firebase user.')
