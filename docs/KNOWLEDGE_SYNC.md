# Private Obsidian knowledge sync

The Career Intelligence application repository is public. **Never push your Obsidian vault or contacts here.**

1. Create a second **private** GitHub repository containing only approved notes (Obsidian supports Markdown).
2. Use YAML front matter `status: approved` and `visibility: matching-safe`, `outreach-safe`, or `agents-safe`. These tags determine what agents can retrieve.
3. Keep `07-private/` on your local computer; the ingestion code excludes it even if the directory exists in the private vault repository. Avoid committing personal secrets anywhere.
4. Add a fine-grained GitHub read-only token for *only the private vault* as `CI_KNOWLEDGE_TOKEN` in the Career Intelligence repo's Actions secrets.
5. Set Actions variable `CI_KNOWLEDGE_REPO` to `Drex72/<private-vault-repo>`.
6. Add private `CI_DATABASE_URL` with a narrowly restricted backend database identity. Never put this secret into variables, frontend builds, or logs.
7. Once access and deletion behavior are reviewed, set Actions variable `CI_KNOWLEDGE_SYNC=true`. Until then the workflow is an inert no-op.

The workflow records a Git commit SHA, handles additions and tombstones, and provides an auditable revision for each approved note. All writes target `ci_knowledge_*` tables. GitHub does not provide encrypted-at-rest end-to-end isolation from authorized repository collaborators, so store only professional knowledge needed for this use case.

**Important:** A vault synchronization is treated as an authoritative snapshot. Do not run two separate repositories/vaults against one `ci_knowledge_documents` registry, because a partial snapshot could mark other approved documents deleted. Use a single approved vault source per owner until multi-vault namespace partitioning is implemented.
