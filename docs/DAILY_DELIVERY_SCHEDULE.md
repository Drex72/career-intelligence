# Daily Career Intelligence recommendations (UTC cron, Lagos day)

Migration 0014 registers one named pg_cron job, **ci-daily-recommendations-0700-wat**, only when pg_cron is installed. Groundwork already has pg_cron configured with GMT timezone.

- Runs daily at 06:00 UTC, which is 07:00 WAT.
- Uses an explicit owner allowlist from ci_workspace_owners; does not enumerate other Groundwork users.
- Calls the same atomic ci_generate_daily_batch routine as the dashboard.
- Requires a current open role, a latest verified_eligible assessment and stored official evidence.
- The lifetime company uniqueness constraint prevents repeated delivery even after a retry.
- Does not fetch external websites, spend on paid services, or send any message.
- Creates a truthful empty batch when no roles qualify.

Monitor through the Supabase SQL editor:
```sql
select jobid, jobname, schedule, active from cron.job
where jobname='ci-daily-recommendations-0700-wat';

select jobid, status, start_time, end_time, return_message
from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='ci-daily-recommendations-0700-wat')
order by start_time desc limit 10;
```

To disable:
```sql
select cron.unschedule('ci-daily-recommendations-0700-wat');
```

This only schedules batch assembly. Actual multi-source discovery and eligibility research require independently configured workers and are not completed by this cron job.
