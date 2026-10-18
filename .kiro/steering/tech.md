---
inclusion: always
---

# Tech Stack & Conventions

## Stack Overview

### Frontend
- React 19 + TypeScript (ESM) with Vite 8
- TailwindCSS 4 via `@tailwindcss/vite` plugin
- react-router-dom v7, aws-amplify v6 (Cognito)
- Testing: Vitest + React Testing Library + fast-check + vitest-axe (WCAG 2.1 AA); Playwright for E2E (in `e2e/`)

### Backend
- AWS Lambda (TypeScript, ESM — `.js` extensions required in imports)
- API Gateway HTTP API + JWT Authorizer (`APIGatewayProxyEventV2WithJWTAuthorizer`)
- DynamoDB single-table (on-demand), S3 + CloudFront (signed URLs)
- Bedrock (Claude) + Comprehend, EventBridge → Lambda
- WAF v2, KMS (CMK), Cognito User Pools (behind `AuthProvider` interface)

### Infrastructure
- AWS CDK (TypeScript) → CloudFormation
- Region: `ap-northeast-1` (all resources)
- Environments: dev / staging / prod (separate accounts)

## Commands

```bash
# Frontend
cd frontend && npm install
npx vitest --run                    # Unit + property tests
npx vitest --run --coverage         # With coverage

# Backend
cd backend && npm install
npx vitest --run                    # Unit + property tests
npx vitest --run --config vitest.integration.config.ts  # Integration (requires LocalStack)

# Infrastructure
cd infra && npm install
npx cdk diff --all
npx cdk deploy --all

# E2E (Playwright — requires a deployed environment + e2e/.env)
cd e2e && npm install
npx playwright test
```

## Architecture Rules

### Backend Layering (strict, no exceptions)

```
Handler → Service → Repository
```

- **Handler** (`src/handlers/`): Thin Lambda entry point. Extract input, call service, return response. One file per endpoint. NEVER call a repository directly.
- **Service** (`src/services/`): Business logic. Orchestrates repositories, enforces rules, throws `AppError`. One file per domain concept.
- **Repository** (`src/repositories/`): DynamoDB access via `docClient` from `utils/dynamodb-client.js`. Returns typed records.
- **Utils** (`src/utils/`): Cross-cutting helpers — `response-builder`, `error-handler`, `auth-middleware`, `dynamodb-client`.

### Handler Template (mandatory structure)

```typescript
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractUser } from '../utils/auth-middleware.js';
import { successResponse, errorResponse } from '../utils/response-builder.js';

/**
 * METHOD /path/{param}
 * Brief description.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> {
  try {
    const user = await extractUser(event);
    // validate input → check access → call service → return response
    return successResponse({ data: result });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
```

### Error Handling

Use `AppError` factories — never throw raw errors:

| Factory | HTTP | Code |
|---------|------|------|
| `validationError(msg, details?)` | 400 | `VALIDATION_ERROR` |
| `notFoundError(msg, details?)` | 404 | `NOT_FOUND` |
| `forbiddenError(msg, details?)` | 403 | `FORBIDDEN` |
| `internalError(msg, details?)` | 500 | `INTERNAL_ERROR` |

Response shape: `{ "error": { "code": "...", "message": "...", "details": "..." } }`

### Auth Pattern

1. `extractUser(event)` — extracts `AuthUser` from JWT claims. Falls back to DynamoDB lookup if `custom:role` not in JWT.
2. `checkSessionAccess(user, sessionId)` — team-based access guard.
3. `requireRole(user, 'ADMIN')` — role hierarchy: ADMIN > TEAM_LEADER > REVIEWER.
4. `denyResourceAccess()` — returns 404 to hide resource existence.

### Response Format

All responses use `successResponse(body, statusCode?)` or `errorResponse(error)`. CORS headers attached automatically. Never construct raw response objects.

## Code Style (enforced)

- **ESM only**: `"type": "module"`. All relative imports MUST use `.js` extension.
- **Naming**: PascalCase (classes/interfaces/types), camelCase (functions/variables), kebab-case (files).
- **Type imports**: Use `import type { ... }` where possible. Shared types in `src/types/index.ts`.
- **Lambda types**: Import from `@types/aws-lambda`.
- **Exports**: Named exports only (`export async function handler`) — never default exports.
- **JSDoc**: Required above each handler — HTTP method, path, behavior summary.
- **No VPC**: Lambdas use public AWS endpoints.
- **Secrets**: SSM Parameter Store (SecureString) or Secrets Manager. Never hardcode.

## Testing Conventions

### File Naming

| Type | Pattern | Location |
|------|---------|----------|
| Unit | `{source}.test.ts` | Co-located |
| Property | `{source}.property.test.ts` | Co-located |
| Integration | `{feature}.integration.test.ts` | `backend/src/__tests__/integration/` |

### Unit Tests
- Mock AWS SDK via `vi.mock()`.
- Test handlers, services, and repositories independently.
- Frontend: wrap routed components in `MemoryRouter`.

### Property-Based Tests (fast-check)

Required for: Correction, Consensus, Score, Search, IP filtering, Upload, Download, Deletion, Language Model, Transcription Job.

```typescript
describe('Feature: {feature-name}, Property N: {property description}', () => {
  /**
   * **Validates: Requirements X.Y**
   * {What this property proves}
   */
  it('{property statement}', async () => {
    await fc.assert(
      fc.asyncProperty(arbitraries, async (input) => {
        // arrange → act → assert
      }),
      { numRuns: 100 }
    );
  });
});
```

- Default `{ numRuns: 100 }`.
- Describe block references feature name and property number.
- Test docstring references the validated requirement.

### Accessibility Tests (Frontend)
- Use `vitest-axe`: `expect(container).toHaveNoViolations()` in every component test.

## DynamoDB Conventions

- Single-table design. Table name: `DYNAMODB_TABLE_NAME` env var (default `TranscriptionReviewApp`, exported as `TABLE_NAME` from `utils/dynamodb-client.ts`).
- `DynamoDBDocumentClient` with `removeUndefinedValues: true`.
- GSI1 and GSI2 for access patterns.
- Region: `ap-northeast-1`.

## Key Design Decisions

- Auth abstracted behind `AuthProvider` interface (future IAM Identity Center migration).
- Individual IAM roles per Lambda (least-privilege).
- CDK stack layering: Foundation → API → CDN → Monitoring, plus a dedicated CloudFront WAF stack in `us-east-1` (CLOUDFRONT scope).
- Property-based testing validates correctness properties derived from requirements.

## Bedrock リージョン / データレジデンシー

- Bedrock 呼び出しは JP または EU のジオ別クロスリージョン推論プロファイルのみ使用（APAC は不使用）。
- 使用モデルは `BEDROCK_MODEL_ID` / cdk.json `bedrockModelId` で指定。既定は JP（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`）。
- Bedrock クライアントの呼び出し先リージョンは modelId プレフィックスから自動導出（`backend/src/utils/bedrock-region.ts`）: `jp.` → `ap-northeast-1`、`eu.` → `eu-central-1`。
- EU データレジデンシーで Claude Sonnet 5.5 を使う場合は `bedrockModelId` を `eu.anthropic.claude-sonnet-5-5` に設定（Comprehend はそのまま ap-northeast-1）。EU の宛先リージョンで事前にモデルアクセス有効化が必要。
- IAM 権限（`infra/lib/constructs/bedrock-comprehend.ts`）は inference-profile ARN をジオのソースリージョンにスコープし、配下 foundation-model ARN を各宛先リージョン分許可する。`us.`/`apac.`/`global.` は synth 時に拒否。
