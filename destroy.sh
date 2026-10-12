#!/bin/bash
#
# destroy.sh - AWS アカウントからデプロイ済み資材を削除する
#
# Usage:
#   ./destroy.sh [OPTIONS]
#
# Options:
#   -c, --cdk-context PATH   cdk.json のパスを指定
#   -e, --env ENV            対象環境 (dev|staging|prod) デフォルト: dev
#   --execute                実際に削除を実行（省略時は dry-run）
#   -h, --help               このメッセージを表示
#
# Examples:
#   ./destroy.sh                          # dry-run（削除内容の確認のみ）
#   ./destroy.sh --execute                # 全スタックを削除
#   ./destroy.sh --execute -e staging     # staging 環境を削除

set -euo pipefail

# Set AWS Profile
export AWS_DEFAULT_PROFILE=xxxxx
export AWS_PROFILE=xxxxx

echo "================================"
echo " TRANSCRIPTION IMPROVEMENT      "
echo "          DESTROY               "
echo "================================"

# Set Node.js memory limit to 1.5GB (1536MB)
export NODE_OPTIONS="--max-old-space-size=1536"

# Defaults
cdk_context_path=""
env_name="dev"
execute_flag=""

# Process command arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--cdk-context)
            cdk_context_path="$2"
            shift 2
            ;;
        -e|--env)
            env_name="$2"
            shift 2
            ;;
        --execute)
            execute_flag="--execute"
            shift
            ;;
        -h|--help)
            echo "Usage: ./destroy.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -c, --cdk-context PATH   cdk.json のパスを指定"
            echo "  -e, --env ENV            対象環境 (dev|staging|prod) デフォルト: dev"
            echo "  --execute                実際に削除を実行（省略時は dry-run）"
            echo "  -h, --help               このメッセージを表示"
            echo ""
            echo "Examples:"
            echo "  ./destroy.sh                          # dry-run"
            echo "  ./destroy.sh --execute                # 全スタック削除"
            echo "  ./destroy.sh --execute -e staging     # staging を削除"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$env_name" != "dev" && "$env_name" != "staging" && "$env_name" != "prod" ]]; then
    echo "Error: Invalid environment: ${env_name}. Must be dev, staging, or prod."
    exit 1
fi

# Check if cdk-context file exists
if [[ -n "$cdk_context_path" && ! -f "$cdk_context_path" ]]; then
    echo "Error: CDK context file not found: $cdk_context_path"
    exit 1
fi

# Production safety gate
if [[ "$env_name" == "prod" && -n "$execute_flag" ]]; then
    echo ""
    echo "⚠️  WARNING: 本番環境 (prod) の削除を実行しようとしています。"
    echo "   この操作は取り消せません。"
    echo ""
    read -rp "続行するには 'DELETE PRODUCTION' と入力してください: " confirmation
    if [[ "$confirmation" != "DELETE PRODUCTION" ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

# Work in /tmp to match deploy.sh pattern
pushd /tmp > /dev/null

# Delete the repository in /tmp if it exists
rm -rf transcription-improvement

# Copy project to /tmp
cp -r "$HOME/Documents/gitProjects/transcription-improvement" .
pushd transcription-improvement > /dev/null

# If cdk.json is specified, overwrite it
if [[ -n "$cdk_context_path" ]]; then
    echo "Overwrite the cdk.json by $cdk_context_path"
    cp -f "$cdk_context_path" infra/cdk.json
fi

# Install dependencies
cd infra
rm -rf node_modules package-lock.json
npm install

# CloudFront WAF Stack (us-east-1) の削除も含める
echo ""
echo "Target environment: ${env_name}"
echo "Mode: $(if [[ -n "$execute_flag" ]]; then echo 'EXECUTE'; else echo 'DRY-RUN'; fi)"
echo ""

# Run the infra destroy script
if [[ -n "$execute_flag" ]]; then
    # 依存関係の逆順で削除: Monitoring → CDN → API → Foundation → CloudFrontWaf(us-east-1)
    echo "[INFO] Destroying stacks in reverse dependency order..."
    echo ""

    # Main stacks (ap-northeast-1)
    bash scripts/destroy.sh --execute --env "$env_name"

    # CloudFront WAF stack (us-east-1) — cdk destroy で直接指定
    echo ""
    echo "[INFO] Destroying CloudFront WAF stack (us-east-1)..."
    npx cdk destroy "${env_name}-CloudFrontWafStack" --force 2>/dev/null || true

    echo ""
    echo "================================"
    echo "  DESTROY COMPLETE             "
    echo "================================"
    echo ""
    echo "Note:"
    echo "  - KMS キーは30日間の待機期間後に完全削除されます"
    echo "  - インポートされた Cognito User Pool / CloudFront Distribution は削除されません"
    echo "  - CDK Bootstrap スタック (CDKToolkit) は残ります（手動で削除可能）"
else
    # Dry-run
    bash scripts/destroy.sh --dryrun --env "$env_name"

    echo ""
    echo "[INFO] CloudFront WAF Stack (us-east-1):"
    aws cloudformation describe-stacks \
        --stack-name "${env_name}-CloudFrontWafStack" \
        --region us-east-1 \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "    NOT_FOUND"
    echo ""
    echo "To execute deletion, run:"
    echo "  ./destroy.sh --execute --env ${env_name}"
fi

popd > /dev/null
popd > /dev/null
