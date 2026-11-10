import base64
import httpx
import pytest
from career.gmail_inbox import decode_message, sync_inbox
from career.platform import CareerPlatform


def test_decode_gmail_reply():
    encoded=base64.urlsafe_b64encode(b'Please remove me from your list').decode()
    msg={'id':'msg-1','payload':{'headers':[{'name':'From','value':'Recruiter <r@company.com>'},{'name':'Subject','value':'Re: Hello'}], 'mimeType':'text/plain','body':{'data':encoded}}}
    result=decode_message(msg)
    assert result['sender']=='r@company.com'
    assert result['body']=='Please remove me from your list'


@pytest.mark.asyncio
async def test_inbox_replies_are_processed_idempotently(tmp_path):
    with CareerPlatform(tmp_path/'db') as platform:
        def server(request):
            if request.url.path.endswith('/messages'):
                return httpx.Response(200,json={'messages':[{'id':'msg-1'}]})
            return httpx.Response(200,json={'id':'msg-1','payload':{'headers':[{'name':'From','value':'r@company.com'}],'mimeType':'text/plain','body':{'data':base64.urlsafe_b64encode(b'Please do not contact me again').decode()}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as client:
            first=await sync_inbox(platform,client,'fake-token','owner')
            second=await sync_inbox(platform,client,'fake-token','owner')
        assert first['processed']==1 and second['processed']==0
        assert platform.db.execute('SELECT 1 FROM suppression WHERE email=?',('r@company.com',)).fetchone()
