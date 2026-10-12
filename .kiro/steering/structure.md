---
inclusion: always
---

# Project Structure

Monorepo with four packages (`frontend/`, `backend/`, `infra/`, `e2e/`), each with its own `package.json`. No workspace-level package manager — run `npm install` inside each package independently.

## Directory Layout

```
transcription-improvement/
├── frontend/                        # React 19 SPA (Vite 8, TailwindCSS 4)
│   └── src/
│       ├── components/              # Reusable UI (flat — NO subdirectories)
│       ├── pages/                   # Route-level pages (PascalCase filenames)
│       ├── hooks/                   # Custom React hooks
│       ├── services/                # API client wrappers
│       ├── types/                   # TypeScript interfaces/types
│       ├── utils/                   # Pure utility functions
│       ├── test-utils/              # Shared test helpers (render wrappers, mocks)
│       ├── __tests__/               # Integration/E2E tests
│       ├── App.tsx                  # Root component with routing
│       └── main.tsx                 # Entry point
│
├── backend/                         # AWS Lambda handlers (ESM, TypeScript)
│   └── src/
│       ├── handlers/                # Lambda entry points (one file per endpoint)
│       ├── services/                # Business logic layer
│       ├── repositories/            # DynamoDB data access layer
│       ├── utils/                   # Cross-cutting utilities
│       ├── types/                   # Shared TypeScript types (index.ts)
│       ├── test-utils/              # Shared test helpers (factories, mocks)
│       └── __tests__/integration/   # Integration tests (require LocalStack)
│
├── infra/                           # AWS CDK (TypeScript)
│   ├── bin/app.ts                   # CDK App entry point
│   ├── lib/
│   │   ├── stacks/                  # CloudFront WAF (us-east-1) + Foundation → API → CDN → Monitoring
│   │   └── constructs/              # Reusable L3 constructs
│   ├── scripts/                     # Operational scripts (destroy, etc.)
│   └── test/                        # CDK snapshot/assertion tests
│
├── e2e/                             # Playwright E2E tests (own package.json)
│   ├── helpers/                     # Cognito / API test helpers
│   ├── seed/                        # Seed data / media scripts
│   └── *.spec.ts                    # Test specs + global setup/teardown
│
└── .kiro/
    ├── specs/                       # Feature specifications
    ├── steering/                    # AI assistant guidance
    └── settings/                    # Kiro configuration (mcp.json)
```

## File Placement Rules

Do NOT create directories outside this structure. Place new files according to this table:

| What you're adding | Where it goes | Naming pattern |
|--------------------|---------------|----------------|
| New API endpoint | `backend/src/handlers/` | `{endpoint-name}.ts` (kebab-case) |
| Business logic | `backend/src/services/` | `{domain}-service.ts` (kebab-case) |
| DynamoDB access | `backend/src/repositories/` | `{domain}-repository.ts` (kebab-case) |
| Backend shared types | `backend/src/types/index.ts` | Append to existing file |
| Backend test helpers | `backend/src/test-utils/` | `{purpose}.ts` (kebab-case) |
| New React page | `frontend/src/pages/` | `{PageName}.tsx` (PascalCase) |
| Reusable UI component | `frontend/src/components/` | `{ComponentName}.tsx` (PascalCase) |
| Custom hook | `frontend/src/hooks/` | `use{HookName}.ts` (camelCase with `use` prefix) |
| Frontend API calls | `frontend/src/services/` | `{service-name}.ts` (kebab-case) |
| Frontend shared types | `frontend/src/types/` | `{domain}.ts` (kebab-case) |
| Frontend test helpers | `frontend/src/test-utils/` | `{purpose}.ts` (kebab-case) |
| New CDK stack | `infra/lib/stacks/` | `{stack-name}-stack.ts` (kebab-case) |
| Reusable CDK construct | `infra/lib/constructs/` | `{construct-name}.ts` (kebab-case) |
| CDK tests | `infra/test/` | `{stack-name}.test.ts` (kebab-case) |
| Unit/property test | Co-located next to source | `{source-file}.test.ts` or `{source-file}.property.test.ts` |
| Integration test | `backend/src/__tests__/integration/` | `{feature}.integration.test.ts` |

## Structural Constraints

These rules are strict. Do not deviate from them:

1. **No shared package** — Types are duplicated between frontend and backend. Do NOT create a shared types package or workspace-level dependencies.
2. **Flat component directory** — All components go directly in `frontend/src/components/`. Never nest subdirectories inside it.
3. **Handler → Service → Repository** — Handlers delegate to services; services call repositories. Never call a repository directly from a handler. Never import handler code from another handler.
4. **CDK stack layering** — Foundation → API → CDN → Monitoring, plus a separate CloudFront WAF stack in `us-east-1` (CLOUDFRONT scope requirement, referenced by CDN via `crossRegionReferences`). Place new resources in the correct layer based on dependency order. Lower layers must not reference higher layers.
5. **Test co-location** — Unit and property tests sit next to their source file. Only integration tests go in `__tests__/integration/`.
6. **One handler per file** — Each Lambda endpoint gets its own file in `handlers/`. Do not combine multiple endpoints in a single file.
7. **One service per domain** — Group related business logic into a single service file per domain concept. A service may call multiple repositories.
8. **No new top-level directories** — All code belongs under `frontend/src/`, `backend/src/`, or `infra/lib/`. Do not introduce new top-level packages.
