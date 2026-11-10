-- Agent research, outreach and conversation data. Never expose raw contact data to anon.
create table if not exists ci_contacts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references ci_companies(id),
 name text not null, current_title text not null, profile_url text not null,
 profile_source_url text not null, identity_verified boolean not null default false,
 created_at timestamptz not null default now(), unique(company_id,profile_url)
);
create table if not exists ci_contact_methods (
 id uuid primary key default gen_random_uuid(), contact_id uuid not null references ci_contacts(id),
 method text not null check(method in ('professional_email','public_contact_form')),
 value text not null, verified boolean not null default false,
 source_url text not null, observed_at timestamptz not null default now(),
 unique(contact_id,method,value)
);
create table if not exists ci_relationship_evidence (
 id uuid primary key default gen_random_uuid(), contact_id uuid not null references ci_contacts(id),
 organization text not null, relation_type text not null,
 source_url text not null, verified boolean not null default false,
 knowledge_revision text not null, observed_at timestamptz not null default now()
);
create table if not exists ci_contact_research_tasks (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references ci_companies(id),
 workflow_id uuid references ci_workflows(id), state text not null default 'pending',
 created_at timestamptz not null default now(), unique(company_id,workflow_id)
);
create table if not exists ci_outreach_policies (
 owner_user_id uuid primary key, auto_enabled boolean not null default false,
 daily_limit int not null default 10 check(daily_limit between 0 and 20),
 per_company_daily_limit int not null default 1 check(per_company_daily_limit between 0 and 2),
 allow_automatic_followups boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists ci_outreach_drafts (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 job_id uuid not null references ci_jobs(id), contact_id uuid not null references ci_contacts(id),
 subject text not null, body text not null, knowledge_revision text,
 personalization_evidence jsonb not null default '[]'::jsonb,
 status text not null default 'draft' check(status in ('draft','approved','cancelled','sent','sending_unknown')),
 created_at timestamptz not null default now()
);
create table if not exists ci_outreach_approvals (
 id uuid primary key default gen_random_uuid(), draft_id uuid not null references ci_outreach_drafts(id),
 owner_user_id uuid not null, mode text not null check(mode in ('manual','standing')),
 policy_snapshot jsonb not null default '{}'::jsonb,
 approved_at timestamptz not null default now(), revoked_at timestamptz
);
create table if not exists ci_outbound_messages (
 id uuid primary key default gen_random_uuid(), draft_id uuid not null references ci_outreach_drafts(id),
 intent_key text not null unique, provider text not null default 'gmail',
 status text not null default 'pending' check(status in ('pending','sending_unknown','sent','failed','cancelled')),
 provider_message_id text unique, sent_at timestamptz,
 last_attempt_at timestamptz, error_code text, created_at timestamptz not null default now()
);
create table if not exists ci_conversation_events (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 job_id uuid references ci_jobs(id), contact_id uuid references ci_contacts(id),
 event_type text not null, provider_message_id text,
 evidence jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now(),
 unique(provider_message_id,event_type)
);
create table if not exists ci_suppression_records (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null,
 normalized_contact_hash text not null, reason text not null,
 created_at timestamptz not null default now(),
 unique(owner_user_id,normalized_contact_hash)
);
create table if not exists ci_knowledge_access_audit (
 id uuid primary key default gen_random_uuid(), workflow_id uuid references ci_workflows(id),
 agent_role text not null, knowledge_revision text not null,
 document_paths jsonb not null, accessed_at timestamptz not null default now()
);
