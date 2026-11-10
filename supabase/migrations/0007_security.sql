-- Defense-in-depth: all remaining public tables are server-worker-only by default.
-- No anon/authenticated policies are granted for these operational records.
alter table ci_agent_checkpoints enable row level security;
alter table ci_companies enable row level security;
alter table ci_company_aliases enable row level security;
alter table ci_company_identity_conflicts enable row level security;
alter table ci_contact_methods enable row level security;
alter table ci_contact_research_tasks enable row level security;
alter table ci_contacts enable row level security;
alter table ci_conversation_events enable row level security;
alter table ci_discovery_runs enable row level security;
alter table ci_discovery_sources enable row level security;
alter table ci_eligibility_assessments enable row level security;
alter table ci_eligibility_evidence enable row level security;
alter table ci_employer_intelligence enable row level security;
alter table ci_job_matches enable row level security;
alter table ci_job_sources enable row level security;
alter table ci_jobs enable row level security;
alter table ci_knowledge_access_audit enable row level security;
alter table ci_knowledge_change_proposals enable row level security;
alter table ci_knowledge_documents enable row level security;
alter table ci_knowledge_facts enable row level security;
alter table ci_knowledge_versions enable row level security;
alter table ci_outbound_messages enable row level security;
alter table ci_outreach_approvals enable row level security;
alter table ci_outreach_drafts enable row level security;
alter table ci_outreach_policies enable row level security;
alter table ci_provider_usage enable row level security;
alter table ci_relationship_evidence enable row level security;
alter table ci_run_metrics enable row level security;
alter table ci_suppression_records enable row level security;
alter table ci_task_attempts enable row level security;
alter table ci_task_dependencies enable row level security;
alter table ci_task_events enable row level security;
alter table ci_workflow_tasks enable row level security;
alter table ci_workflows enable row level security;

-- Explicitly remove broad client privileges. Server service-role uses dedicated backend.
revoke all on table ci_agent_checkpoints,ci_application_events,ci_applications,ci_companies,ci_company_aliases,ci_company_identity_conflicts,ci_contact_methods,ci_contact_research_tasks,ci_contacts,ci_conversation_events,ci_daily_batch_items,ci_daily_batches,ci_delivered_companies,ci_delivered_jobs,ci_discovery_runs,ci_discovery_sources,ci_eligibility_assessments,ci_eligibility_evidence,ci_employer_intelligence,ci_job_matches,ci_job_sources,ci_jobs,ci_knowledge_access_audit,ci_knowledge_change_proposals,ci_knowledge_documents,ci_knowledge_facts,ci_knowledge_versions,ci_outbound_messages,ci_outreach_approvals,ci_outreach_drafts,ci_outreach_policies,ci_provider_usage,ci_relationship_evidence,ci_run_metrics,ci_suppression_records,ci_task_attempts,ci_task_dependencies,ci_task_events,ci_workflow_tasks,ci_workflows from anon, authenticated;
-- Re-grant read to owner-scoped views/tables protected by policies created in 0005.
grant select on ci_daily_batches,ci_daily_batch_items,ci_delivered_companies,ci_delivered_jobs,ci_applications,ci_application_events to authenticated;
