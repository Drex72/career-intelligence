-- Defense-in-depth: all remaining public tables are server-worker-only by default.
-- No anon/authenticated policies are granted for these operational records.
alter table agent_checkpoints enable row level security;
alter table companies enable row level security;
alter table company_aliases enable row level security;
alter table company_identity_conflicts enable row level security;
alter table contact_methods enable row level security;
alter table contact_research_tasks enable row level security;
alter table contacts enable row level security;
alter table conversation_events enable row level security;
alter table discovery_runs enable row level security;
alter table discovery_sources enable row level security;
alter table eligibility_assessments enable row level security;
alter table eligibility_evidence enable row level security;
alter table employer_intelligence enable row level security;
alter table job_matches enable row level security;
alter table job_sources enable row level security;
alter table jobs enable row level security;
alter table knowledge_access_audit enable row level security;
alter table knowledge_change_proposals enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_facts enable row level security;
alter table knowledge_versions enable row level security;
alter table outbound_messages enable row level security;
alter table outreach_approvals enable row level security;
alter table outreach_drafts enable row level security;
alter table outreach_policies enable row level security;
alter table provider_usage enable row level security;
alter table relationship_evidence enable row level security;
alter table run_metrics enable row level security;
alter table suppression_records enable row level security;
alter table task_attempts enable row level security;
alter table task_dependencies enable row level security;
alter table task_events enable row level security;
alter table workflow_tasks enable row level security;
alter table workflows enable row level security;

-- Explicitly remove broad client privileges. Server service-role uses dedicated backend.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
-- Re-grant read to owner-scoped views/tables protected by policies created in 0005.
grant select on daily_batches,daily_batch_items,delivered_companies,delivered_jobs,applications,application_events to authenticated;
