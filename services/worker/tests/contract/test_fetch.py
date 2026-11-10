import json
from datetime import datetime,timezone
import httpx,pytest
from career.discovery.fetch import fetch_board
NOW=datetime(2026,11,10,tzinfo=timezone.utc)

@pytest.mark.asyncio
async def test_fetch_greenhouse_with_mock_transport():
    seen=[]
    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200,json={'jobs':[{'id':2,'title':'Software Engineer','absolute_url':'https://example.com/2'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result=await fetch_board('greenhouse','acme','Acme','acme.com',client,NOW)
    assert len(result)==1 and result[0].source=='greenhouse'
    assert 'boards-api.greenhouse.io' in seen[0]

@pytest.mark.asyncio
async def test_fetch_ashby_with_mock_transport():
    def handler(request):
        return httpx.Response(200,json={'jobs':[{'id':'a','title':'AI','jobUrl':'https://example.com/a'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result=await fetch_board('ashby','demo','Demo','demo.com',client,NOW)
    assert result[0].source_job_id=='a'

@pytest.mark.asyncio
async def test_bad_board_identifier_rejected():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(200,json={}))) as client:
        with pytest.raises(ValueError):
            await fetch_board('greenhouse','../../private','Example','example.com',client,NOW)

@pytest.mark.asyncio
async def test_429_deferred_not_retried_aggressively():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(429,headers={'Retry-After':'60'}))) as client:
        with pytest.raises(Exception,match='rate limited'):
            await fetch_board('lever','demo','Demo','demo.com',client,NOW)
