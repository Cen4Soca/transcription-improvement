#!/bin/bash

set -e

# Set AWS Profile
export AWS_DEFAULT_PROFILE=xxxxx
export AWS_PROFILE=xxxxx

echo "============================================"
echo " TRANSCRIPTION IMPROVEMENT                  "
echo "       DEPLOY & E2E TEST PIPELINE           "
echo "============================================"
echo ""

# Process command arguments
CDK_CONTEXT_PATH="$HOME/cdk.json"
ENV_FILE="$HOME/e2e.env"
SKIP_DEPLOY=false
SKIP_TEST=false
SKIP_SEED=false
TEST_ARGS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--cdk-context)
            CDK_CONTEXT_PATH="$2"
            shift 2
            ;;
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        --skip-deploy)
            SKIP_DEPLOY=true
            shift
            ;;
        --skip-test)
            SKIP_TEST=true
            shift
            ;;
        --skip-seed)
            SKIP_SEED=true
            shift
            ;;
        --test-headed)
            TEST_ARGS="$TEST_ARGS --headed"
            shift
            ;;
        --test-grep)
            TEST_ARGS="$TEST_ARGS --grep \"$2\""
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -c, --cdk-context PATH  Path to cdk.json (default: ~/cdk.json)"
            echo "  -e, --env PATH          Path to .env file (default: ~/e2e.env)"
            echo "  --skip-deploy           Skip deployment, run tests only"
            echo "  --skip-test             Deploy only, skip tests"
            echo "  --skip-seed             Skip seed data insertion"
            echo "  --test-headed           Run E2E tests in headed mode"
            echo "  --test-grep PATTERN     Filter E2E tests by name"
            echo "  -h, --help              Show this message"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

DEPLOY_SCRIPT="$HOME/deploy.sh"
E2E_SCRIPT="$HOME/e2e-test.sh"

# ===== PHASE 1: DEPLOY =====
if [[ "$SKIP_DEPLOY" == false ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " Phase 1: DEPLOY"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
        echo "Error: deploy.sh not found at $DEPLOY_SCRIPT"
        exit 1
    fi

    echo "Running: $DEPLOY_SCRIPT -c $CDK_CONTEXT_PATH"
    echo ""

    if ! bash "$DEPLOY_SCRIPT" -c "$CDK_CONTEXT_PATH"; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo " ❌ DEPLOY FAILED"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Fix the CDK code and re-run:"
        echo "  $0 -c $CDK_CONTEXT_PATH"
        echo ""
        exit 1
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " ✅ DEPLOY SUCCEEDED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Wait for CloudFront propagation
    echo "Waiting 10s for deployment propagation..."
    sleep 10
fi

# ===== PHASE 2: E2E TEST =====
if [[ "$SKIP_TEST" == false ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " Phase 2: E2E TEST"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [[ ! -f "$E2E_SCRIPT" ]]; then
        echo "Error: e2e-test.sh not found at $E2E_SCRIPT"
        exit 1
    fi

    # After deploy, /tmp/transcription-improvement is freshly copied
    # so e2e-test.sh needs to run npm install. Only skip if deploy was skipped
    # (meaning /tmp copy was not refreshed and previous install may still be valid).
    INSTALL_FLAG=""
    if [[ "$SKIP_DEPLOY" == true ]]; then
        INSTALL_FLAG="--skip-install"
    fi

    SEED_FLAG=""
    if [[ "$SKIP_SEED" == true ]]; then
        SEED_FLAG="--skip-seed"
    fi

    if eval bash "$E2E_SCRIPT" -e "$ENV_FILE" $INSTALL_FLAG $SEED_FLAG $TEST_ARGS; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo " ✅ E2E TESTS PASSED"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo " ❌ E2E TESTS FAILED"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Next steps:"
        echo "  1. Check test report:  cd /tmp/transcription-improvement/e2e && npx playwright show-report"
        echo "  2. Fix the issue in CDK or app code"
        echo "  3. Re-run:  $0 -c $CDK_CONTEXT_PATH"
        echo ""
        echo "  To re-run tests only (skip deploy):"
        echo "    $0 --skip-deploy"
        echo ""
        exit 1
    fi
fi

echo ""
echo "============================================"
echo " 🎉 PIPELINE COMPLETE"
echo "============================================"
