from uuid import uuid4
import httpx
import pytest
from fastapi import HTTPException
from career.pg_auth import SupabaseOwnerAuth


@pytest.mark.asyncio
async def test_supabase_owner_verified_by_auth_server():
    user=uuid4()
    def serve(request):
        assert request.url.path=='/auth/v1/user'
        assert request.headers['authorization']=='Bearer test-access-token'
        return httpx.Response(200,json={'id':str(user),'role':'authenticated'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
        verifier=SupabaseOwnerAuth('https://test.supabase.co','public-key',user,client)
        assert await verifier.verify('test-access-token') == user


@pytest.mark.asyncio
async def test_supabase_different_user_rejected():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(200,json={'id':str(uuid4()),'role':'authenticated'}))) as client:
        verifier=SupabaseOwnerAuth('https://test.supabase.co','public-key',uuid4(),client)
        with pytest.raises(HTTPException) as exc:
            await verifier.verify('token')
        assert exc.value.status_code==403


@pytest.mark.asyncio
async def test_supabase_auth_unavailable_fails_closed():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(503))) as client:
        verifier=SupabaseOwnerAuth('https://test.supabase.co','public-key',uuid4(),client)
        with pytest.raises(HTTPException) as exc:
            await verifier.verify('token')
        assert exc.value.status_code==503


def test_supabase_auth_rejects_insecure_url():
    with pytest.raises(ValueError):
        SupabaseOwnerAuth('http://example.com','key',uuid4(),None)
