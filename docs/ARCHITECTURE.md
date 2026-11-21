# Architecture

## System components

The frontend is a Next.js App Router application in `apps/web`. It owns browser presentation, feature composition, and future authenticated user flows. It must not contain route-solving algorithms or privileged service credentials.

The optimizer is an independent FastAPI service in `services/optimizer`. It owns future request validation, optimization orchestration, and independent solution validation. In Task 00 it exposes only `GET /health`.

`supabase/` is a future integration boundary for PostgreSQL migrations, Row Level Security policies, storage, authentication, and realtime capabilities. No Supabase client, project, schema, or credentials are present.

## Responsibility boundaries

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Next.js web | UI, user interactions, typed API clients | Solver implementation, service secrets |
| FastAPI optimizer | API schemas, optimization, independent validation | Browser UI, authentication UI |
| Supabase (future) | Durable data, RLS, files, auth state | Route solving decisions |
| AI integration (future) | Server-side structured extraction and explanations | Unverified order persistence or final routing authority |

## Frontend/backend interaction

A future server-side or authenticated frontend API client will call versioned FastAPI endpoints over HTTPS. Requests and responses will use explicit schemas. The optimizer will return validated results; frontend display code must not be treated as solver validation.

## Future data integration

Supabase PostgreSQL will store orders, fleet records, assignments, inspections, optimization history, and auditable approvals. Migrations and RLS policies will be reviewed before database access is enabled. Storage will hold approved documents rather than raw secrets.

## Future identity and authorization

Supabase Auth will provide identity. Authorization will be enforced with roles and Row Level Security, with separate dispatcher/admin and driver scopes. The frontend will not rely solely on hidden controls for authorization; protected API operations must validate identity and authorization server-side.
