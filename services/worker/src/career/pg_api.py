"""Private, owner-authenticated read API for the PostgreSQL career catalog."""
from __future__ import annotations
from datetime import date
from fastapi import FastAPI,Header,HTTPException,Depends
from career.persistence.postgres_catalog import PostgresCareerCatalog


def make_pg_app(dsn: str, owner_auth, *, store_factory=PostgresCareerCatalog) -> FastAPI:
    if not dsn:
        raise ValueError('DATABASE_URL required')
    app=FastAPI(title='Career Intelligence private API',docs_url=None,redoc_url=None)

    async def require_owner(authorization: str | None = Header(default=None)):
        if not authorization or not authorization.startswith('Bearer '):
            raise HTTPException(status_code=401,detail='Bearer access token required')
        return await owner_auth.verify(authorization[7:])

    @app.get('/health')
    def health():
        return {'ok':True}

    @app.get('/api/ci/metrics')
    def metrics(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return catalog.metrics(owner)

    @app.get('/api/ci/batches/{day}')
    def batch(day:date,owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'items':catalog.list_batch(owner,day)}

    return app
