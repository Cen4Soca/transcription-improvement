#!/bin/bash

set -e

# Set AWS Profile
export AWS_DEFAULT_PROFILE=xxxxx
export AWS_PROFILE=xxxxx

echo "================================"
echo " TRANSCRIPTION IMPROVEMENT      "
echo "       E2E TEST RUNNER          "
echo "================================"

# Process command arguments
HEADED=""
GREP=""
PROJECT="chromium"
SKIP_INSTALL=false
SKIP_SEED=false
ENV_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        --headed)
            HEADED="--headed"
            shift
            ;;
        --grep|-g)
            GREP="--grep \"$2\""
            shift 2
            ;;
        --ui)
            HEADED="--ui"
            shift
            ;;
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-seed)
            SKIP_SEED=true
            shift
            ;;
        -h|--help)
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -e, --env PATH     Path to .env file (default: ~/e2e.env)"
            echo "  --headed           Run tests in headed browser mode"
            echo "  --ui               Run tests in Playwright UI mode"
            echo "  --grep, -g         Filter tests by name pattern"
            echo "  --skip-install     Skip npm install step"
            echo "  --skip-seed        Skip seed data insertion"
            echo "  -h, --help         Show this message"
            echo ""
            echo "Examples:"
            echo "  $0                        # Run all tests (with seed)"
            echo "  $0 -e ~/my.env            # Use custom .env file"
            echo "  $0 --skip-seed            # Skip seed, run tests only"
            echo "  $0 --headed               # Run with visible browser"
            echo "  $0 --grep '認証'          # Run only auth tests"
            echo "  $0 --ui                   # Run in interactive UI mode"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# E2E directory is inside the /tmp copy made by deploy.sh
E2E_DIR="/tmp/transcription-improvement/e2e"

# Check the /tmp copy exists (created by deploy.sh)
if [[ ! -d "$E2E_DIR" ]]; then
    echo ""
    echo "  ❌ /tmp/transcription-improvement/e2e が見つかりません"
    echo "  先に deploy.sh を実行してください。"
    echo ""
    exit 1
fi

# Determine .env file location (default: ~/e2e.env)
if [[ -z "$ENV_FILE" ]]; then
    ENV_FILE="$HOME/e2e.env"
fi

# Check .env exists
echo ""
echo "[1/5] Checking .env file..."
if [[ ! -f "$ENV_FILE" ]]; then
    echo "  ❌ .env file not found: $ENV_FILE"
    echo ""
    echo "  Please create the .env file. See e2e/.env.example for reference."
    echo "  Default location: ~/e2e.env"
    echo ""
    exit 1
fi

# Copy .env into the e2e directory
cp "$ENV_FILE" "$E2E_DIR/.env"
echo "  ✓ Using $ENV_FILE"

# Print key config (without secrets)
echo ""
echo "  Configuration:"
grep -E "^(BASE_URL|API_ENDPOINT|COGNITO_USER_POOL_ID|DYNAMODB_TABLE_NAME)=" "$ENV_FILE" | sed 's/^/    /'

# Install dependencies
echo ""
echo "[2/5] Installing dependencies..."
cd "$E2E_DIR"

if [[ "$SKIP_INSTALL" == false ]]; then
    rm -rf node_modules package-lock.json
    npm install --silent 2>/dev/null
    npx playwright install chromium 2>/dev/null || true
    echo "  ✓ Dependencies installed"
else
    echo "  → Skipped (--skip-install)"
fi

# Seed data
echo ""
echo "[3/5] Seeding test data..."

if [[ "$SKIP_SEED" == false ]]; then
    echo "  Running seed-data.ts..."
    npx tsx seed/seed-data.ts
    echo ""
    echo "  Running seed-media-files.ts..."
    npx tsx seed/seed-media-files.ts
    echo ""
    echo "  ✓ Seed data inserted"
else
    echo "  → Skipped (--skip-seed)"
fi

# Run tests
echo ""
echo "[4/5] Running E2E tests..."
echo "================================"
echo ""

eval npx playwright test --project=$PROJECT $HEADED $GREP

TEST_EXIT_CODE=$?

echo ""
echo "================================"
echo "[5/5] Test Results"
echo "================================"

if [[ $TEST_EXIT_CODE -eq 0 ]]; then
    echo "  ✅ All tests passed!"
else
    echo "  ❌ Some tests failed (exit code: $TEST_EXIT_CODE)"
    echo ""
    echo "  To view the report:"
    echo "    cd /tmp/transcription-improvement/e2e && npx playwright show-report"
    echo ""
    echo "  To re-run failed tests:"
    echo "    cd /tmp/transcription-improvement/e2e && npx playwright test --last-failed"
fi

exit $TEST_EXIT_CODE
