"""Read permitted Gmail replies with explicit OAuth token, storing minimal events.

Never runs without a caller-provided OAuth token; avoids bulk mailbox indexing.
"""
from __future__ import annotations
import base64
from email.utils import parseaddr
import httpx
from career.conversation import process_reply

BASE='https://gmail.googleapis.com/gmail/v1/users/me/messages'

def _decode(data:str)->str:
    if not data:return ''
    try:return base64.urlsafe_b64decode(data+'='*((-len(data))%4)).decode('utf-8',errors='replace')
    except (ValueError,TypeError):return ''


def decode_message(message:dict)->dict:
    payload=message.get('payload') or {}
    headers={h['name'].casefold():h.get('value','') for h in payload.get('headers',[]) if 'name' in h}
    parts=[payload];body=''
    while parts:
        item=parts.pop(0)
        parts.extend(item.get('parts',[]))
        if item.get('mimeType')=='text/plain':
            body=_decode(item.get('body',{}).get('data',''));break
    return {'id':message.get('id',''),'sender':parseaddr(headers.get('from',''))[1].lower(),
            'subject':headers.get('subject',''),'body':body}


async def sync_inbox(platform,client:httpx.AsyncClient,access_token:str,owner:str,limit:int=25)->dict:
    if not access_token or not owner:raise ValueError('explicit Gmail access and owner required')
    headers={'Authorization':f'Bearer {access_token}'}
    response=await client.get(BASE,headers=headers,params={'q':'in:inbox newer_than:14d','maxResults':min(max(limit,1),50)},timeout=15)
    response.raise_for_status()
    processed=0
    for entry in response.json().get('messages',[]):
        msgid=entry.get('id')
        if not msgid or platform.db.execute('SELECT 1 FROM inbox_seen WHERE owner=? AND provider_id=?',(owner,msgid)).fetchone():continue
        resp=await client.get(f'{BASE}/{msgid}',headers=headers,params={'format':'full'},timeout=15)
        resp.raise_for_status()
        content=decode_message(resp.json())
        if not content['sender'] or not content['body']:continue
        # Only process contacts already present in this user's outreach records.
        matched=platform.db.execute('''SELECT o.job_id,c.company_id FROM outreach o JOIN contacts c ON c.id=o.contact_id WHERE o.owner=? AND lower(c.email)=? ORDER BY o.created_at DESC LIMIT 1''',(owner,content['sender'])).fetchone()
        if matched:
            process_reply(platform,owner,content['sender'],content['body'],company_id=matched['company_id'],job_id=matched['job_id'],source_url=f'https://mail.google.com/mail/u/0/#all/{msgid}')
        elif 'do not contact' in content['body'].casefold() or 'remove me' in content['body'].casefold():
            platform.suppress(content['sender'])
        platform.db.execute('INSERT OR IGNORE INTO inbox_seen(owner,provider_id,created_at) VALUES(?,?,datetime(\'now\'))',(owner,msgid))
        processed+=1
    return {'processed':processed}
