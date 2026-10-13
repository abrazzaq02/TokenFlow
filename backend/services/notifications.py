"""Optional Twilio adapter. Provider acceptance is not delivery confirmation."""
import os,requests

def send_sms(phone,message):
 sid,token,sender=(os.getenv(k) for k in ('TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM'))
 if not all((sid,token,sender)):return {'status':'unavailable'}
 try:
  r=requests.post(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',auth=(sid,token),data={'To':phone,'From':sender,'Body':message},timeout=8)
  r.raise_for_status();return {'status':'accepted','providerMessageId':r.json().get('sid')}
 except requests.RequestException:return {'status':'failed'}
