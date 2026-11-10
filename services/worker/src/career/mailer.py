"""Policy-checked email dispatcher: no credentials in AI agents."""
from __future__ import annotations
import base64
from email.message import EmailMessage
import httpx


class GmailDispatcher:
    def __init__(self,platform,sender):
        self.platform=platform
        self.sender=sender

    def send(self,draft_id:str)->bool:
        db=self.platform.db
        db.execute('BEGIN IMMEDIATE')
        try:
            row=db.execute('''SELECT o.*,c.email,c.email_verified,a.status application_status,p.enabled auto_enabled FROM outreach o JOIN contacts c ON c.id=o.contact_id LEFT JOIN applications a ON a.owner=o.owner AND a.job_id=o.job_id LEFT JOIN auto_policies p ON p.owner=o.owner WHERE o.id=?''',(draft_id,)).fetchone()
            if not row:raise KeyError(draft_id)
            if (row['status']!='approved' or row['application_status'] not in ('applied','interviewing')
                or (row['auth_mode']=='auto' and not row['auto_enabled'])
                or not row['email_verified'] or not row['email']):
                db.commit();return False
            if db.execute('SELECT 1 FROM suppression WHERE email=?',(row['email'].lower(),)).fetchone():
                db.commit();return False
            # Mark ambiguous state before interacting with the outside world. Do not auto-retry.
            db.execute("UPDATE outreach SET status='sending_unknown' WHERE id=? AND status='approved'",(draft_id,))
            db.commit()
        except Exception:
            db.rollback();raise
        try:
            remote_id=self.sender(row['email'],row['subject'],row['body'],draft_id)
        except Exception:
            # Cannot safely deduce whether the email was accepted; leave for reconciliation.
            self.platform._event('send_uncertain',draft_id)
            return False
        db.execute("UPDATE outreach SET status='sent' WHERE id=? AND status='sending_unknown'",(draft_id,))
        self.platform._event('email_sent',draft_id,{'provider_id':str(remote_id)})
        return True


def gmail_api_sender(access_token:str, sender_address:str):
    """Real Gmail API sender. Explicit OAuth access token required; no refresh stored."""
    if not access_token or not sender_address:raise ValueError('Gmail OAuth credentials required')
    def send(to:str,subject:str,body:str,key:str)->str:
        message=EmailMessage()
        message['To']=to
        message['From']=sender_address
        message['Subject']=subject
        message['X-Career-Intent-ID']=key
        message.set_content(body)
        raw=base64.urlsafe_b64encode(message.as_bytes()).decode()
        with httpx.Client(timeout=20) as client:
            response=client.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                headers={'Authorization':f'Bearer {access_token}'},json={'raw':raw})
            response.raise_for_status()
            return response.json()['id']
    return send
