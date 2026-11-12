# Oracle Cloud Always Free deployment — Career Intelligence LangGraph

Six independently hosted, ARM64-compatible Python LangGraph specialist processes on **one** Oracle Cloud Ampere A1 VM. Existing Supabase PostgreSQL, CI API, and Edge specialist execution remain hosted; Vercel frontend stays unchanged. The six OCI processes compile actual one-node LangGraph graphs and delegate operations to the existing role-authenticated Supabase workers. They do not host LLM weights locally.

## Current Oracle Free Tier allowance (November 2026)

Oracle's current Free Tier documentation specifies **1,500 A1 OCPU-hours/month** and **9,000 memory GB-hours/month**, equivalent to approximately **2 OCPUs and 12 GB RAM** running continuously. A normal 50-GB boot volume counts toward 200 GB of Always Free combined block storage. The older 4-OCPU / 24-GB numbers are outdated for new Free Tier accounts.

**Important:** the Free Tier compute VM must be created in your **home region**, which cannot be changed after signup. A1 capacity is sometimes unavailable; "Out of host capacity" is a legitimate allocation issue, not a program error. Oracle may reclaim instances considered consistently idle over seven days. It does not provide an always-on uptime SLA. Do not generate artificial workload to evade reclamation; enable independent uptime monitoring and retain the Supabase fallback.

Official sources:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm
- https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://docs.docker.com/engine/install/ubuntu/

## 1. Create your Oracle account and VM

1. Sign up at https://signup.oraclecloud.com/ . Oracle requires real identity/contact details and a payment card for verification, but won't charge the Free account unless you explicitly upgrade. Never post card details or credentials in ChatGPT.
2. Choose your **home region carefully**. Oracle's A1 Always Free allocation is available only in that region. Prefer a region near your users or Supabase, but prioritize being able to provision the A1 shape; the choice becomes permanent.
3. In the OCI Console open **Compute → Instances → Create instance**. Name it `career-intelligence-langgraph`; select **Ubuntu 24.04 LTS ARM64** and shape **VM.Standard.A1.Flex** with **2 OCPUs and 12 GB RAM**.
4. Select only **Always Free-eligible** resources, with one default **50 GB boot volume**. Do not provision extra paid services or oversized volumes during the trial.
5. Create the VM with a **public key** for SSH login. Save the private key only on your own computer. Never send it to ChatGPT or put it into Git.
6. In the VCN subnet/security list restrict inbound traffic to **TCP 22 (SSH) from your current trusted public IP**. No other inbound ports are required. The containers are outbound-only. Ensure egress permits HTTPS 443 and PostgreSQL 5432 to Supabase. If your IP changes, update the SSH rule.
7. Confirm VM status is **RUNNING** and copy the public IP.

The AMD micro shape (1 GB memory) is **not** suitable for this six-container stack.

## 2. First SSH connection and Docker installation

From your Mac terminal:

```bash
chmod 600 ~/.ssh/oci-career.key
ssh -i ~/.ssh/oci-career.key ubuntu@YOUR_VM_PUBLIC_IP
```

On the VM:

```bash
git clone https://github.com/Drex72/career-intelligence.git
cd career-intelligence
sudo bash deploy/oci/bootstrap-ubuntu.sh
```

The script uses Docker's official Ubuntu APT repository and installs the Compose plugin. It does not open inbound ports, expose your secrets, or add your SSH account to the root-equivalent `docker` group.

## 3. Configure secrets only on the VM

```bash
cd ~/career-intelligence/deploy/oci
cp secrets.env.example secrets.env
chmod 600 secrets.env
nano secrets.env
```

Set `DATABASE_URL` to the **exact** PostgreSQL **session pooler** URL from **Supabase Dashboard → Connect → Session pooler (5432)**, including `sslmode=require`. This is required if your Oracle VM is IPv4-only. Do not use the transaction pooler on port 6543: LangGraph checkpoints need persistent session behavior.

Set `CI_WORKER_SIGNING_KEY` to the existing signing secret managed by your Supabase worker infrastructure. Do not create an unrelated random key unless the server is also rotated in an explicitly coordinated deployment. **Do not paste credentials or connection strings into chat or GitHub.**

`CI_WORKER_ENDPOINT` is preconfigured to your existing CI Edge worker. `CI_POLL_SECONDS=30` and `CI_MAX_DISPATCH_PER_CYCLE=2` initially limit network/worker pressure. They can be tuned from actual observed throughput and provider rate-limit errors.

### Preflight (does NOT run the pipeline)

```bash
bash check-host.sh
sudo docker compose -f compose.yaml build
# Initialize the private checkpoint schema once, before simultaneous startup.
sudo docker compose -f compose.yaml run --rm discovery --dry-run --once
sudo docker compose -f compose.yaml up -d --no-build
sudo docker compose -f compose.yaml ps
```

All six workers now run in dry-run mode, compiling their real role-specific graphs and periodically recording private heartbeats **without dispatching any jobs**.

Check private heartbeat rows using an authorized Supabase SQL connection:

```sql
select role,state,last_heartbeat_at
from ci_langgraph.runtime_processes
order by last_heartbeat_at desc limit 20;
```

Expected: six distinct role values, recent heartbeats, and `state='polling'` during normal operation. The `ci_langgraph.checkpoints` table must exist. Verify logs locally:

```bash
sudo docker compose -f compose.yaml logs --tail 40 --no-color
```

Never share logs containing credentials or URLs with embedded passwords.

## 4. Cutover without dual schedulers

**Do not cut over unless all six OCI containers pass the preflight.** The currently working Supabase `ci-role-aware-specialist-pool-15m` job stays running until then.

1. Check the current Supabase job and ensure no work is in-flight that would be disrupted:
   `select jobname,active from cron.job where jobname='ci-role-aware-specialist-pool-15m';`
2. Disable the old scheduler from your authorized Supabase SQL session:
   `select cron.unschedule('ci-role-aware-specialist-pool-15m');`
3. Start the active override stack:

```bash
cd ~/career-intelligence/deploy/oci
sudo docker compose -f compose.yaml -f compose.active.yaml up -d --no-build --force-recreate
sudo docker compose -f compose.yaml -f compose.active.yaml ps
```

4. Observe all six role heartbeats, job claims, and CI worker telemetry for a full activity cycle. The Python graphs will now make **role-signed HMAC requests** only when their assigned queue reports work.
5. If any container crashes or work stops, **immediately roll back**:

```bash
sudo docker compose -f compose.yaml -f compose.active.yaml down
sudo docker compose -f compose.yaml up -d --no-build
```

Then restore the Supabase scheduler:

```sql
select cron.schedule('ci-role-aware-specialist-pool-15m','*/15 * * * *',
 'select public.ci_run_specialist_pool(false)');
```

The old Supabase API and worker do **not** need to be redeployed. The two schedulers must never deliberately dispatch the same queues at once.

## 5. Operating costs, monitoring and caveats

- OCI VM hosting should remain within Always Free **only if Oracle marks the resource Always Free-eligible and total account usage stays within published limits**. AI API calls, premium contact research, and Supabase usage are billed separately according to their providers.
- Docker Compose deploys six persistent background processes on a single VM. Each process has a protective CPU/memory cap; actual **worker requests** are allocated from the current queue and failure feedback. One free VM cannot dynamically add unlimited physical CPU/RAM.
- No HTTP health endpoint is exposed. Monitor running containers, checkpoint heartbeats, actual worker task completion, OCI CPU/RAM, provider failures, and Supabase database connection count. Set an external alert for VM disappearance or stale heartbeats.
- Oracle may reclaim consistently idle Free Tier VMs. The exact reclaimed-instance policy is documented by Oracle; rely on recovery procedures and the Supabase scheduler rather than trying to bypass it.
- Since Supabase acts as the durable source of truth, a destroyed VM can be reprovisioned and restarted from this runbook. Do not store irreplaceable state solely on its boot disk.
- **This is NOT evidence that the 100 verified suitable jobs/day target is met.** That still requires stronger eligibility verification, real job-requirements matching, and enough verified job supply.
- The current Python graphs are role-scoped **LangGraph wrappers around the hardened Supabase Edge specialist implementations**, not six duplicated LLMs and not six fully Python-native rewrites of all business logic.

## 6. Updates

```bash
cd ~/career-intelligence
git pull --ff-only
cd deploy/oci
sudo docker compose -f compose.yaml -f compose.active.yaml build
sudo docker compose -f compose.yaml -f compose.active.yaml up -d --no-build
```

For pre-cutover updates omit `-f compose.active.yaml` and remain in dry-run mode.
