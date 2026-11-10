# Security boundaries

This repository is **public**. Do not commit credentials, real application histories, personal knowledge, raw contact information, or email contents.

- Store OAuth credentials and private notes in access-controlled storage outside Git.
- Automatic email sending and paid API calls remain disabled unless the owner explicitly configures and approves them.
- The bundled SQLite dashboard is a development interface; it is not a hardened Internet-facing service.
- Never expose its bearer token in logs or version-controlled configuration.
- Supabase migrations require an isolated verification database and RLS audit before production use.
- Report suspected vulnerabilities privately to the repository owner rather than in a public issue.
