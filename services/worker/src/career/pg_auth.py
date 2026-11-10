"""Fail-closed Supabase authentication for the private Career Intelligence API.

Each token is validated by Supabase Auth, not by trusting unverified JWT claims.
The configured owner UUID must match the returned user id. This prevents
Groundwork's other authenticated users from seeing personal job-search data.
"""
from uuid import UUID
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException


class SupabaseOwnerAuth:
    def __init__(self, supabase_url: str, publishable_key: str,
                 owner_user_id: UUID, client: httpx.AsyncClient | None):
        parsed=urlsplit(supabase_url)
        if parsed.scheme!='https' or not parsed.hostname or not parsed.hostname.endswith('.supabase.co'):
            raise ValueError('secure Supabase URL required')
        if not publishable_key or not isinstance(owner_user_id,UUID):
            raise ValueError('Supabase publishable key and owner UUID required')
        self.url=supabase_url.rstrip('/')+'/auth/v1/user'
        self.key=publishable_key
        self.owner=owner_user_id
        self.client=client

    async def verify(self, token: str | None) -> UUID:
        if not token or len(token)>8192 or any(c.isspace() for c in token):
            raise HTTPException(status_code=401, detail='Supabase access token required')
        if self.client is None:
            raise HTTPException(status_code=503, detail='Authentication unavailable')
        try:
            response=await self.client.get(self.url,headers={
                'apikey':self.key,'Authorization':'Bearer '+token},timeout=8)
        except httpx.HTTPError as err:
            raise HTTPException(status_code=503,detail='Authentication temporarily unavailable') from err
        if response.status_code in (401,403):
            raise HTTPException(status_code=401,detail='Invalid or expired access token')
        if response.status_code!=200:
            raise HTTPException(status_code=503,detail='Authentication temporarily unavailable')
        try:
            data=response.json()
            uid=UUID(data['id'])
            role=data.get('role')
        except (KeyError,ValueError,TypeError) as err:
            raise HTTPException(status_code=503,detail='Malformed authentication response') from err
        if uid!=self.owner or role!='authenticated':
            raise HTTPException(status_code=403,detail='Career Intelligence owner access only')
        return uid
