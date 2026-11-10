create table if not exists ci_knowledge_documents (
 id uuid primary key default gen_random_uuid(), path text not null unique,
 git_sha text not null, content_sha text not null,
 visibility text not null check(visibility in ('matching-safe','outreach-safe','agents-safe')),
 status text not null default 'approved' check(status in ('approved','deleted')),
 updated_at timestamptz not null default now()
);
create table if not exists ci_knowledge_versions (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references ci_knowledge_documents(id),
 revision text not null, body text not null, parsed_metadata jsonb not null,
 created_at timestamptz not null default now(), unique(document_id,revision)
);
create table if not exists ci_knowledge_facts (
 id uuid primary key default gen_random_uuid(), document_version_id uuid not null references ci_knowledge_versions(id),
 claim_key text not null, claim_text text not null,
 verification text not null, visibility text not null,
 source_ref text, active boolean not null default true,
 unique(document_version_id,claim_key)
);
create table if not exists ci_knowledge_change_proposals (
 id uuid primary key default gen_random_uuid(), document_id uuid references ci_knowledge_documents(id),
 proposed_diff text not null, origin text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now()
);
