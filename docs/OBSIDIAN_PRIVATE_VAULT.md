# Obsidian private vault → Career Intelligence

## Security boundary

Your Obsidian vault is a **separate private GitHub repository**. Career Intelligence's application repository must never contain the vault's personal notes, OAuth tokens or Git credentials. The sync runs in GitHub Actions using a fine-grained read-only token, checks that the GitHub repository really is private, and only sends explicitly approved Markdown notes to private `ci_` PostgreSQL tables.

The workflow refuses to operate without explicit opt-in. It never enables Gmail sending, scrapes private services, or automatically modifies Obsidian.

### Configure

1. In GitHub, create a **private** repository under your account, containing your Obsidian vault. Keep your `.obsidian` files, passwords, API keys, journal, health, financial and personal notes out of the approved professional directories.
2. Add just the professional notes you want agents to know about. A matching-only note might look like:

   ```markdown
   ---
   status: approved
   visibility: matching-safe
   ---
   Built a production backend system with Python and PostgreSQL.
   ```

   Other allowed scopes are `outreach-safe` and `agents-safe`. Every note starts unapproved by default. Review the complete text yourself before changing its status to `approved`.
3. In the **Career Intelligence** repository, open **Settings → Secrets and variables → Actions**. Configure `CI_KNOWLEDGE_REPO` as `OWNER/PRIVATE_VAULT_REPO`. Create a GitHub fine-grained token restricted to this private repo with **Contents: read** only; store it as secret `CI_KNOWLEDGE_TOKEN`. Store a dedicated, least-privilege Postgres connection as secret `CI_DATABASE_URL` (never in source code).
4. Set repository variable `CI_KNOWLEDGE_SYNC` to `true`. Run **Career Intelligence Private Knowledge Sync (opt-in)** from Actions → **Run workflow**. It validates that the repo is private, performs dry-run parsing first, and then stores a versioned revision and audit counts.
5. Visit the app's **Knowledge base** page for the last revision, changed/skipped/deleted counts, and explicitly approved paths. The frontend never receives the raw bodies.

## Rules and limitations

- Only explicit frontmatter `status: approved` and `visibility: matching-safe | outreach-safe | agents-safe` enables indexing.
- `07-private`, `private`, `secrets`, hidden directories, symlinks, and files over 32 KiB are excluded or rejected before database writes.
- A sync with an unexpectedly empty approved set **refuses to erase the entire existing index**. To deliberately clear every approved note, run the CLI with `--allow-empty` in an intentionally authorized local operation, after review.
- Approved notes have a 500-document cap and are versioned by content hash. Changes are transactional. Deleted/deapproved notes are tombstoned and excluded from future agent retrieval.
- Sync run audit records contain only revision, counts, and completion time, not raw note contents.
- Background worker matching reads approved `matching-safe` / `agents-safe` notes. It **does not invent** a fit score when matching context or verified jobs are missing.
- `CI_KNOWLEDGE_SYNC` is opt-in; without a configured private repository, the index remains empty. A successful test with synthetic fixtures is not proof that your personal vault has been connected.
- Keep secrets **out** of approved notes. Although only authorized backend roles can read knowledge bodies, they are still stored in Supabase PostgreSQL, not encrypted end-to-end in Obsidian.

### Local validation

```bash
python -m career.cli pg-vault-sync /path/to/private-vault --revision <commit-sha> --dry-run
```

With a configured `DATABASE_URL`, omit `--dry-run` to apply it. To purposely delete all indexed notes after making your approved set empty, pass `--allow-empty`.

The importer does not clone repositories on its own; GitHub Actions' checked-out private repository is its only unattended data source.
