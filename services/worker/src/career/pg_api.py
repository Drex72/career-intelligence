"""Private, owner-authenticated read API for the PostgreSQL career catalog."""
from __future__ import annotations
from datetime import date
from fastapi import FastAPI,Header,HTTPException,Depends
from pydantic import BaseModel,Field
from typing import Literal
from uuid import UUID
from career.persistence.postgres_catalog import PostgresCareerCatalog


class ReplyInput(BaseModel):
    job_id: UUID
    contact_id: UUID
    body: str = Field(min_length=1,max_length=4000)
    source_url: str = Field(min_length=10,max_length=1000)


class DraftRequest(BaseModel):
    job_id: UUID
    contact_id: UUID


class ApplicationInput(BaseModel):
    job_id: UUID
    status: Literal['discovered','saved','applied','interviewing','offer','rejected','withdrawn']
    notes: str = Field(default='',max_length=1000)


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

    @app.get('/api/ci/jobs')
    def jobs(limit:int=100,owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'jobs':catalog.list_jobs(min(max(limit,1),500))}

    @app.get('/api/ci/people')
    def people(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'contacts':catalog.list_contacts()}

    @app.get('/api/ci/knowledge')
    def knowledge(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'documents':catalog.list_knowledge_index()}

    @app.get('/api/ci/applications')
    def applications(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'applications':catalog.list_applications(owner)}

    @app.post('/api/ci/applications')
    def save_application(body:ApplicationInput,owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            try:
                return {'id':catalog.record_application(owner,str(body.job_id),body.status,body.notes)}
            except KeyError:
                raise HTTPException(status_code=404,detail='Job not found')

    @app.get('/api/ci/outreach')
    def outreach(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'drafts':catalog.list_outreach(owner)}

    @app.post('/api/ci/outreach/drafts')
    def draft_outreach(body:DraftRequest,owner=Depends(require_owner)):
        from career.persistence.pg_outreach import prepare_pg_draft
        with store_factory(dsn) as catalog:
            try:
                return {'id':prepare_pg_draft(catalog,owner,str(body.job_id),str(body.contact_id))}
            except ValueError as error:
                raise HTTPException(status_code=422,detail=str(error)) from error

    @app.get('/api/ci/conversations')
    def conversations(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'events':catalog.list_conversations(owner)}

    @app.post('/api/ci/conversations')
    def record_reply(body:ReplyInput,owner=Depends(require_owner)):
        from career.persistence.pg_conversation import record_pg_reply
        with store_factory(dsn) as catalog:
            try:
                return record_pg_reply(catalog,owner,job_id=str(body.job_id),
                    contact_id=str(body.contact_id),body=body.body,source_url=body.source_url)
            except ValueError as error:
                raise HTTPException(status_code=422,detail=str(error)) from error

    @app.get('/api/ci/operations')
    def operations(owner=Depends(require_owner)):
        with store_factory(dsn) as catalog:
            return {'states':catalog.operations()}

    return app
