#!/usr/bin/env bash
#
# destroy.sh - Transcription Review App deletion script
#
# Usage:
#   ./scripts/destroy.sh [OPTIONS] [STACK_NAMES...]
#
# Options:
#   --dryrun       Show what will be deleted without executing (default)
#   --execute      Actually perform the deletion
#   --env ENV      Target environment (dev|staging|prod). Default: dev
#   --help         Show this help message
#
# Examples:
#   ./scripts/destroy.sh --dryrun                          # Dry-run all stacks
#   ./scripts/destroy.sh --execute                         # Delete all stacks
#   ./scripts/destroy.sh --execute MonitoringStack         # Delete only MonitoringStack
#   ./scripts/destroy.sh --execute CdnStack MonitoringStack  # Delete specific stacks
#
# Notes:
#   - Deletes CloudFrontWafStack in us-east-1 (CLOUDFRONT-scope WAF) in addition to the
#     ap-northeast-1 stacks, plus solution-owned residue cdk destroy leaves behind:
#     SSM parameters (/transcription-review/*), auto-generated Lambda log groups, and
#     Transcribe custom language models (GenU does not create custom language models,
#     so every model is treated as solution-owned).
#   - In prod, KMS/DynamoDB/S3/Cognito use RETAIN, so after cdk destroy they are cleaned
#     up explicitly (KMS via schedule-key-deletion with the 7-day minimum). Imported
#     Cognito pools (cdk.json cognitoUserPoolId set) are retained, not deleted.
#   - Never touches CDK bootstrap (CDKToolkit / cdk-* buckets) or GenU resources.
#
# Requirements: 14.1, 15.1, 22.2

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
DRY_RUN=true
ENV_NAME="dev"
STACKS=()
ACCOUNT_ID=""
REGION="ap-northeast-1"
# CloudFront WAF (CLOUDFRONT scope) resources live in us-east-1
REGION_CFWAF="us-east-1"

# Stack names in dependency order (reverse for deletion).
# CloudFrontWafStack (us-east-1) holds the CLOUDFRONT-scope WAF WebACL referenced by
# CdnStack's distribution (webAclId), so it is destroyed AFTER CdnStack and BEFORE
# FoundationStack. cdk destroy uses the env.region embedded in each stack (us-east-1
# for CloudFrontWafStack), so no extra --region flag is needed.
ALL_STACKS=("MonitoringStack" "CdnStack" "ApiStack" "CloudFrontWafStack" "FoundationStack")

usage() {
  head -31 "$0" | grep '^#' | sed 's/^# \?//'
  exit 0
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dryrun)
      DRY_RUN=true
      shift
      ;;
    --execute)
      DRY_RUN=false
      shift
      ;;
    --env)
      ENV_NAME="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    *)
      STACKS+=("$1")
      shift
      ;;
  esac
done

# If no specific stacks provided, use all stacks
if [[ ${#STACKS[@]} -eq 0 ]]; then
  STACKS=("${ALL_STACKS[@]}")
fi

# Prefix stacks with environment name
PREFIXED_STACKS=()
for stack in "${STACKS[@]}"; do
  PREFIXED_STACKS+=("${ENV_NAME}-${stack}")
done

# Get AWS account ID
get_account_id() {
  ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || echo "")
  if [[ -z "$ACCOUNT_ID" ]]; then
    log_error "Failed to get AWS account ID. Check your AWS credentials."
    exit 1
  fi
}

# Show S3 bucket contents summary
show_bucket_summary() {
  local bucket_name="$1"
  local exists
  exists=$(aws s3api head-bucket --bucket "$bucket_name" 2>&1 && echo "yes" || echo "no")
  
  if [[ "$exists" == "yes" ]]; then
    local object_count
    object_count=$(aws s3 ls "s3://${bucket_name}" --recursive --summarize 2>/dev/null | grep "Total Objects:" | awk '{print $3}' || echo "0")
    local total_size
    total_size=$(aws s3 ls "s3://${bucket_name}" --recursive --summarize 2>/dev/null | grep "Total Size:" | awk '{print $3, $4}' || echo "0 Bytes")
    echo "    Bucket: ${bucket_name}"
    echo "      Objects: ${object_count}"
    echo "      Size: ${total_size}"
  else
    echo "    Bucket: ${bucket_name} (not found or no access)"
  fi
}

# Show DynamoDB table summary
show_table_summary() {
  local table_name="$1"
  local item_count
  item_count=$(aws dynamodb describe-table --table-name "$table_name" --query 'Table.ItemCount' --output text 2>/dev/null || echo "N/A")
  local table_size
  table_size=$(aws dynamodb describe-table --table-name "$table_name" --query 'Table.TableSizeBytes' --output text 2>/dev/null || echo "N/A")
  echo "    Table: ${table_name}"
  echo "      Items: ${item_count}"
  echo "      Size: ${table_size} bytes"
}

# Determine the region a stack lives in (CloudFrontWafStack is us-east-1, rest ap-northeast-1)
stack_region() {
  local stack_name="$1"
  case "$stack_name" in
    *CloudFrontWafStack) echo "$REGION_CFWAF" ;;
    *) echo "$REGION" ;;
  esac
}

# Show CloudFormation stack status (optional 2nd arg: region, defaults to $REGION)
show_stack_status() {
  local stack_name="$1"
  local region="${2:-$REGION}"
  local status
  status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region "$region" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
  echo "    Stack: ${stack_name} (${region}) (${status})"
}

# Dry-run: show what will be deleted
dry_run() {
  echo ""
  echo "============================================"
  echo "  DELETION DRY-RUN REPORT"
  echo "  Environment: ${ENV_NAME}"
  echo "  Account: ${ACCOUNT_ID}"
  echo "  Region: ${REGION}"
  echo "============================================"
  echo ""

  log_info "CloudFormation Stacks to delete:"
  for stack in "${PREFIXED_STACKS[@]}"; do
    show_stack_status "$stack" "$(stack_region "$stack")"
  done
  echo ""

  # Check if FoundationStack is being deleted (contains data resources)
  local deleting_foundation=false
  for stack in "${STACKS[@]}"; do
    if [[ "$stack" == "FoundationStack" ]]; then
      deleting_foundation=true
      break
    fi
  done

  if [[ "$deleting_foundation" == "true" ]]; then
    log_info "S3 Buckets (will be emptied and deleted):"
    show_bucket_summary "transcription-review-media-${ACCOUNT_ID}"
    show_bucket_summary "transcription-review-data-${ACCOUNT_ID}"
    show_bucket_summary "transcription-review-static-${ACCOUNT_ID}"
    echo ""

    log_info "DynamoDB Table (will be deleted):"
    show_table_summary "TranscriptionReviewApp"
    echo ""

    log_info "KMS Key:"
    echo "    Key alias: transcription-review-app"
    echo "    Deletion (dev/staging): removed with the stack (removalPolicy DESTROY)"
    echo "    Deletion (prod RETAIN): manual schedule-key-deletion, 7-day waiting period (minimum)"
    echo "    (Scheduled deletion can be cancelled within the waiting period)"
    echo ""

    # Check Cognito import status
    local cognito_pool_id
    cognito_pool_id=$(aws cloudformation describe-stacks --stack-name "${ENV_NAME}-FoundationStack" \
      --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text 2>/dev/null || echo "")
    local context_pool_id
    context_pool_id=$(cd "$(dirname "$0")/.." && node -e "const ctx = require('./cdk.json').context || {}; console.log(ctx.cognitoUserPoolId || '')" 2>/dev/null || echo "")
    
    if [[ -n "$context_pool_id" ]]; then
      log_info "Cognito User Pool:"
      echo "    Pool ID: ${cognito_pool_id:-unknown}"
      echo "    Status: IMPORTED (will be RETAINED - not deleted)"
    else
      log_warn "Cognito User Pool:"
      echo "    Pool ID: ${cognito_pool_id:-unknown}"
      echo "    Status: CDK-CREATED (will be deleted in dev/staging, retained in prod)"
    fi
    echo ""
  fi

  # Check CloudFront import status
  local deleting_cdn=false
  for stack in "${STACKS[@]}"; do
    if [[ "$stack" == "CdnStack" ]]; then
      deleting_cdn=true
      break
    fi
  done

  if [[ "$deleting_cdn" == "true" ]]; then
    local context_cf_id
    context_cf_id=$(cd "$(dirname "$0")/.." && node -e "const ctx = require('./cdk.json').context || {}; console.log(ctx.cloudFrontDistributionId || '')" 2>/dev/null || echo "")
    
    if [[ -n "$context_cf_id" ]]; then
      log_info "CloudFront Distribution:"
      echo "    Distribution ID: ${context_cf_id}"
      echo "    Status: IMPORTED (will be RETAINED - not deleted)"
    else
      log_info "CloudFront Distribution:"
      echo "    Status: CDK-CREATED (will be deleted)"
      echo "    Note: Disabling may take up to 15 minutes"
    fi
    echo ""
  fi

  # Additional non-CloudFormation cleanup performed on --execute when FoundationStack
  # is in scope. These resources are either CloudFormation-unmanaged or created by
  # Custom Resources whose Delete may be skipped, so destroy.sh removes them explicitly.
  if [[ "$deleting_foundation" == "true" ]]; then
    log_info "Additional cleanup on --execute (solution-owned resources only):"
    echo "    SSM Parameters (fallback delete):"
    echo "      /transcription-review/${ENV_NAME}/cloudfront-private-key (${REGION})"
    echo "      /transcription-review/${ENV_NAME}-CloudFrontWafStack/web-acl-arn (${REGION_CFWAF})"
    echo "    CloudWatch Log groups (auto-generated, prefix match in ${REGION}):"
    echo "      /aws/lambda/transcription-review-"
    echo "      /aws/lambda/${ENV_NAME}-ApiStack-"
    echo "      /aws/lambda/${ENV_NAME}-CdnStack-"
    echo "    Transcribe custom language models: ALL models in ${REGION} (GenU does not create any)"
    echo ""

    if [[ "$ENV_NAME" == "prod" ]]; then
      log_warn "PROD RETAIN resources (manually cleaned up after cdk destroy on --execute):"
      echo "    DynamoDB table: TranscriptionReviewApp (delete-table)"
      echo "    S3 buckets: media/data/static (empty + delete-bucket)"
      echo "    KMS key alias/transcription-review-app: schedule-key-deletion (7-day minimum)"
      echo "    Cognito User Pool: deleted only if CDK-created (imported pools are retained)"
      echo ""
    fi
  fi

  echo "============================================"
  if [[ "$DRY_RUN" == "true" ]]; then
    log_warn "This is a DRY-RUN. No resources will be deleted."
    log_info "To execute deletion, run with --execute flag:"
    echo ""
    echo "  ./scripts/destroy.sh --execute --env ${ENV_NAME} ${STACKS[*]}"
    echo ""
  fi
}

# Empty S3 buckets (required before cdk destroy if autoDeleteObjects is not set)
empty_buckets() {
  local buckets=(
    "transcription-review-media-${ACCOUNT_ID}"
    "transcription-review-data-${ACCOUNT_ID}"
    "transcription-review-static-${ACCOUNT_ID}"
  )

  for bucket in "${buckets[@]}"; do
    local exists
    exists=$(aws s3api head-bucket --bucket "$bucket" 2>&1 && echo "yes" || echo "no")
    if [[ "$exists" == "yes" ]]; then
      log_info "Emptying bucket: ${bucket}"
      # Delete all object versions (required for versioned buckets)
      aws s3api list-object-versions --bucket "$bucket" --output json \
        --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' 2>/dev/null | \
        python3 -c "
import sys, json
data = json.load(sys.stdin)
objects = data.get('Objects') or []
if objects:
    # Process in batches of 1000
    for i in range(0, len(objects), 1000):
        batch = objects[i:i+1000]
        delete_payload = json.dumps({'Objects': batch, 'Quiet': True})
        print(delete_payload)
" 2>/dev/null | while read -r payload; do
        if [[ -n "$payload" ]]; then
          echo "$payload" | aws s3api delete-objects --bucket "$bucket" --delete file:///dev/stdin >/dev/null 2>&1 || true
        fi
      done

      # Also delete any delete markers
      aws s3api list-object-versions --bucket "$bucket" --output json \
        --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' 2>/dev/null | \
        python3 -c "
import sys, json
data = json.load(sys.stdin)
objects = data.get('Objects') or []
if objects:
    for i in range(0, len(objects), 1000):
        batch = objects[i:i+1000]
        delete_payload = json.dumps({'Objects': batch, 'Quiet': True})
        print(delete_payload)
" 2>/dev/null | while read -r payload; do
        if [[ -n "$payload" ]]; then
          echo "$payload" | aws s3api delete-objects --bucket "$bucket" --delete file:///dev/stdin >/dev/null 2>&1 || true
        fi
      done

      # Fallback: simple recursive delete for non-versioned objects
      aws s3 rm "s3://${bucket}" --recursive 2>/dev/null || true
      log_success "Bucket emptied: ${bucket}"
    else
      log_info "Bucket not found (skipping): ${bucket}"
    fi
  done
}

# Delete CloudFront signing-key SSM SecureString and the CloudFront WAF web-acl-arn
# parameter as a fallback for Custom Resource Delete that may have been skipped.
# Only touches /transcription-review/* parameters (never GenU or other prefixes).
delete_ssm_parameters() {
  log_info "Deleting SSM parameters (fallback)..."

  # cloudfront-private-key (ap-northeast-1, created by ApiStack CustomResource)
  local pk_name="/transcription-review/${ENV_NAME}/cloudfront-private-key"
  if aws ssm get-parameter --name "$pk_name" --region "$REGION" >/dev/null 2>&1; then
    if aws ssm delete-parameter --name "$pk_name" --region "$REGION" >/dev/null 2>&1; then
      log_success "Deleted SSM parameter: ${pk_name} (${REGION})"
    else
      log_warn "Failed to delete SSM parameter: ${pk_name} (${REGION})"
    fi
  else
    log_info "SSM parameter not found (skipping): ${pk_name} (${REGION})"
  fi

  # web-acl-arn (us-east-1, created by CloudFrontWafStack; id = ${ENV_NAME}-CloudFrontWafStack)
  local waf_name="/transcription-review/${ENV_NAME}-CloudFrontWafStack/web-acl-arn"
  if aws ssm get-parameter --name "$waf_name" --region "$REGION_CFWAF" >/dev/null 2>&1; then
    if aws ssm delete-parameter --name "$waf_name" --region "$REGION_CFWAF" >/dev/null 2>&1; then
      log_success "Deleted SSM parameter: ${waf_name} (${REGION_CFWAF})"
    else
      log_warn "Failed to delete SSM parameter: ${waf_name} (${REGION_CFWAF})"
    fi
  else
    log_info "SSM parameter not found (skipping): ${waf_name} (${REGION_CFWAF})"
  fi

  # Safety net: warn (do NOT delete) about any remaining solution parameters.
  local region
  for region in "$REGION" "$REGION_CFWAF"; do
    local leftover
    leftover=$(aws ssm get-parameters-by-path --path "/transcription-review/" --recursive \
      --region "$region" --query 'Parameters[].Name' --output text 2>/dev/null || echo "")
    if [[ -n "$leftover" && "$leftover" != "None" ]]; then
      log_warn "Remaining /transcription-review/ SSM parameters in ${region}: ${leftover}"
    fi
  done
}

# Delete auto-generated CloudWatch Log groups left behind after cdk destroy.
# Explicit LogGroups created by the LambdaFunction construct are removed with the stack;
# this cleans up log groups for Lambdas without an explicit LogGroup (malware-scan and
# inline Custom Resource / BucketDeployment / AwsCustomResource functions).
# Limited to solution-owned prefixes so GenU (GenerativeAiUseCasesStack*) is never touched.
delete_log_groups() {
  log_info "Deleting auto-generated Lambda log groups (solution-owned prefixes)..."

  local prefixes=(
    "/aws/lambda/transcription-review-"
    "/aws/lambda/${ENV_NAME}-ApiStack-"
    "/aws/lambda/${ENV_NAME}-CdnStack-"
  )

  local prefix
  for prefix in "${prefixes[@]}"; do
    local groups
    groups=$(aws logs describe-log-groups --log-group-name-prefix "$prefix" --region "$REGION" \
      --query 'logGroups[].logGroupName' --output text 2>/dev/null || echo "")
    if [[ -z "$groups" || "$groups" == "None" ]]; then
      log_info "No log groups found for prefix: ${prefix} (${REGION})"
      continue
    fi
    local group
    for group in $groups; do
      if aws logs delete-log-group --log-group-name "$group" --region "$REGION" >/dev/null 2>&1; then
        log_success "Deleted log group: ${group} (${REGION})"
      else
        log_warn "Failed to delete log group: ${group} (${REGION})"
      fi
    done
  done

  # CloudFrontWafStack holds WAF resources only (no Lambda), so no solution Lambda log
  # groups are expected in us-east-1. Verify (do not delete beyond the prefix) for safety.
  local cfwaf_prefix="/aws/lambda/${ENV_NAME}-CloudFrontWafStack-"
  local cfwaf_groups
  cfwaf_groups=$(aws logs describe-log-groups --log-group-name-prefix "$cfwaf_prefix" \
    --region "$REGION_CFWAF" --query 'logGroups[].logGroupName' --output text 2>/dev/null || echo "")
  if [[ -z "$cfwaf_groups" || "$cfwaf_groups" == "None" ]]; then
    log_info "No CloudFrontWafStack Lambda log groups in ${REGION_CFWAF} (expected 0)."
  else
    log_warn "Unexpected log groups for ${cfwaf_prefix} (${REGION_CFWAF}): ${cfwaf_groups}"
  fi
}

# Delete Transcribe custom language models (CloudFormation-unmanaged).
# Per confirmed assumption, the co-located GenU solution does not create custom language
# models, so every model in the account is solution-owned and deleted (no prefix filter).
# Region is ap-northeast-1. Training data lives in the Data bucket and is removed by
# empty_buckets, so no extra cleanup is required here.
delete_language_models() {
  log_info "Deleting Transcribe custom language models (${REGION})..."

  local models
  models=$(aws transcribe list-language-models --region "$REGION" \
    --query 'Models[].ModelName' --output text 2>/dev/null || echo "")
  if [[ -z "$models" || "$models" == "None" ]]; then
    log_info "No Transcribe custom language models found (skipping)."
    return
  fi

  local model
  for model in $models; do
    if aws transcribe delete-language-model --model-name "$model" --region "$REGION" >/dev/null 2>&1; then
      log_success "Deleted Transcribe language model: ${model}"
    else
      log_warn "Failed to delete Transcribe language model: ${model}"
    fi
  done
}

# Clean up prod RETAIN resources after cdk destroy. In prod, foundation-stack.ts applies
# RETAIN (dataRemovalPolicy) to KMS/DynamoDB/S3/Cognito and autoDeleteObjects is false, so
# these survive cdk destroy and must be removed intentionally to reach zero cost / zero data.
# Called only when ENV_NAME == prod and --execute, after cdk destroy. Fully idempotent.
cleanup_retained_prod_resources() {
  log_info "Cleaning up prod RETAIN resources (DynamoDB/S3/KMS/Cognito)..."

  # (1) DynamoDB table
  if aws dynamodb describe-table --table-name "TranscriptionReviewApp" --region "$REGION" >/dev/null 2>&1; then
    if aws dynamodb delete-table --table-name "TranscriptionReviewApp" --region "$REGION" >/dev/null 2>&1; then
      log_success "Deleted DynamoDB table: TranscriptionReviewApp"
    else
      log_warn "Failed to delete DynamoDB table: TranscriptionReviewApp"
    fi
  else
    log_info "DynamoDB table not found (skipping): TranscriptionReviewApp"
  fi

  # (2) S3 buckets: empty then delete
  empty_buckets
  local buckets=(
    "transcription-review-media-${ACCOUNT_ID}"
    "transcription-review-data-${ACCOUNT_ID}"
    "transcription-review-static-${ACCOUNT_ID}"
  )
  local bucket
  for bucket in "${buckets[@]}"; do
    if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
      if aws s3api delete-bucket --bucket "$bucket" --region "$REGION" >/dev/null 2>&1; then
        log_success "Deleted S3 bucket: ${bucket}"
      else
        log_warn "Failed to delete S3 bucket: ${bucket}"
      fi
    else
      log_info "S3 bucket not found (skipping): ${bucket}"
    fi
  done

  # (3) KMS key via alias -> schedule deletion (7-day minimum waiting period)
  local kms_key_id
  kms_key_id=$(aws kms describe-key --key-id "alias/transcription-review-app" --region "$REGION" \
    --query 'KeyMetadata.KeyId' --output text 2>/dev/null || echo "")
  if [[ -n "$kms_key_id" && "$kms_key_id" != "None" ]]; then
    if aws kms schedule-key-deletion --key-id "$kms_key_id" --pending-window-in-days 7 --region "$REGION" >/dev/null 2>&1; then
      log_success "Scheduled KMS key deletion (7-day): ${kms_key_id}"
    else
      log_warn "KMS key could not be scheduled for deletion (may already be pending): ${kms_key_id}"
    fi
  else
    log_info "KMS key alias/transcription-review-app not found (skipping)."
  fi

  # (4) Cognito User Pool: never delete an imported pool (cdk.json cognitoUserPoolId set)
  local context_pool_id
  context_pool_id=$(cd "$(dirname "$0")/.." && node -e "const ctx = require('./cdk.json').context || {}; console.log(ctx.cognitoUserPoolId || '')" 2>/dev/null || echo "")
  if [[ -n "$context_pool_id" ]]; then
    log_info "Cognito User Pool is IMPORTED (cognitoUserPoolId set) - retained, not deleted."
  else
    # CDK-created pool: try FoundationStack Outputs first (likely gone after destroy),
    # then fall back to list-user-pools by name.
    local pool_id
    pool_id=$(aws cloudformation describe-stacks --stack-name "${ENV_NAME}-FoundationStack" --region "$REGION" \
      --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text 2>/dev/null || echo "")
    if [[ -z "$pool_id" || "$pool_id" == "None" ]]; then
      pool_id=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
        --query "UserPools[?Name=='TranscriptionReviewAppUserPool'].Id | [0]" --output text 2>/dev/null || echo "")
    fi
    if [[ -n "$pool_id" && "$pool_id" != "None" ]]; then
      if aws cognito-idp delete-user-pool --user-pool-id "$pool_id" --region "$REGION" >/dev/null 2>&1; then
        log_success "Deleted Cognito User Pool: ${pool_id}"
      else
        log_warn "Failed to delete Cognito User Pool: ${pool_id}"
      fi
    else
      log_info "Cognito User Pool (CDK-created) not found (skipping)."
    fi
  fi
}

# Execute CDK destroy
execute_destroy() {
  echo ""
  echo "============================================"
  echo "  EXECUTING DELETION"
  echo "  Environment: ${ENV_NAME}"
  echo "  Account: ${ACCOUNT_ID}"
  echo "  Region: ${REGION}"
  echo "============================================"
  echo ""

  # Safety check for prod
  if [[ "$ENV_NAME" == "prod" ]]; then
    log_error "Production environment deletion requires explicit confirmation."
    echo ""
    read -rp "Type 'DELETE PRODUCTION' to confirm: " confirmation
    if [[ "$confirmation" != "DELETE PRODUCTION" ]]; then
      log_info "Deletion cancelled."
      exit 0
    fi
  fi

  # Check if FoundationStack is being deleted
  local deleting_foundation=false
  for stack in "${STACKS[@]}"; do
    if [[ "$stack" == "FoundationStack" ]]; then
      deleting_foundation=true
      break
    fi
  done

  # Empty S3 buckets if FoundationStack is being deleted
  # (autoDeleteObjects handles this in dev/staging, but this is a safety net)
  if [[ "$deleting_foundation" == "true" ]]; then
    log_info "Emptying S3 buckets..."
    empty_buckets
    echo ""
  fi

  # Run cdk destroy for specified stacks
  log_info "Running cdk destroy for: ${PREFIXED_STACKS[*]}"
  echo ""

  cd "$(dirname "$0")/.."
  # cdk destroy uses env.region embedded in each stack (CloudFrontWafStack -> us-east-1),
  # so no extra --region flag is required here.
  npx cdk destroy "${PREFIXED_STACKS[@]}" --force

  echo ""
  log_success "CDK destroy completed."
  echo ""

  # Post-destroy cleanup of CloudFormation-unmanaged / RETAIN resources.
  # Only when FoundationStack is in scope (its data resources are what leave residue).
  # Language models / SSM / log groups leak in every env (dev/staging/prod).
  if [[ "$deleting_foundation" == "true" ]]; then
    delete_language_models
    echo ""
    delete_ssm_parameters
    echo ""
    delete_log_groups
    echo ""
    # prod keeps KMS/DynamoDB/S3/Cognito (RETAIN) after destroy; clean them up explicitly.
    if [[ "$ENV_NAME" == "prod" ]]; then
      cleanup_retained_prod_resources
      echo ""
    fi
  fi

  # Verify deletion (per-stack region: CloudFrontWafStack -> us-east-1, others -> ap-northeast-1)
  log_info "Verifying deletion..."
  local remaining=0
  for stack in "${PREFIXED_STACKS[@]}"; do
    local region
    region="$(stack_region "$stack")"
    local status
    status=$(aws cloudformation describe-stacks --stack-name "$stack" --region "$region" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")
    if [[ "$status" != "DELETED" && "$status" != "DELETE_COMPLETE" ]]; then
      log_warn "Stack ${stack} (${region}) status: ${status}"
      remaining=$((remaining + 1))
    else
      log_success "Stack ${stack} (${region}): deleted"
    fi
  done

  if [[ $remaining -gt 0 ]]; then
    log_warn "${remaining} stack(s) may still be in progress. Check CloudFormation console."
  else
    log_success "All specified stacks have been deleted."
  fi

  # Residual-resource verification (both regions) when FoundationStack was in scope.
  if [[ "$deleting_foundation" == "true" ]]; then
    echo ""
    log_info "Verifying residual resources (SSM / log groups / language models)..."

    # SSM parameters (both regions)
    local pk_name="/transcription-review/${ENV_NAME}/cloudfront-private-key"
    if aws ssm get-parameter --name "$pk_name" --region "$REGION" >/dev/null 2>&1; then
      log_warn "Residual SSM parameter: ${pk_name} (${REGION})"
    else
      log_success "SSM parameter gone: ${pk_name} (${REGION})"
    fi
    local waf_name="/transcription-review/${ENV_NAME}-CloudFrontWafStack/web-acl-arn"
    if aws ssm get-parameter --name "$waf_name" --region "$REGION_CFWAF" >/dev/null 2>&1; then
      log_warn "Residual SSM parameter: ${waf_name} (${REGION_CFWAF})"
    else
      log_success "SSM parameter gone: ${waf_name} (${REGION_CFWAF})"
    fi

    # Log groups (ap-northeast-1, 3 solution prefixes)
    local lg_prefixes=(
      "/aws/lambda/transcription-review-"
      "/aws/lambda/${ENV_NAME}-ApiStack-"
      "/aws/lambda/${ENV_NAME}-CdnStack-"
    )
    local lg_prefix
    for lg_prefix in "${lg_prefixes[@]}"; do
      local lg_left
      lg_left=$(aws logs describe-log-groups --log-group-name-prefix "$lg_prefix" --region "$REGION" \
        --query 'logGroups[].logGroupName' --output text 2>/dev/null || echo "")
      if [[ -n "$lg_left" && "$lg_left" != "None" ]]; then
        log_warn "Residual log groups for ${lg_prefix} (${REGION}): ${lg_left}"
      else
        log_success "No residual log groups for ${lg_prefix} (${REGION})"
      fi
    done

    # Transcribe language models (ap-northeast-1)
    local lm_left
    lm_left=$(aws transcribe list-language-models --region "$REGION" \
      --query 'Models[].ModelName' --output text 2>/dev/null || echo "")
    if [[ -n "$lm_left" && "$lm_left" != "None" ]]; then
      log_warn "Residual Transcribe language models (${REGION}): ${lm_left}"
    else
      log_success "No residual Transcribe language models (${REGION})"
    fi
  fi
}

# Main
main() {
  log_info "Transcription Review App - Deletion Script"
  echo ""

  # Validate environment
  if [[ "$ENV_NAME" != "dev" && "$ENV_NAME" != "staging" && "$ENV_NAME" != "prod" ]]; then
    log_error "Invalid environment: ${ENV_NAME}. Must be dev, staging, or prod."
    exit 1
  fi

  # Get account ID
  get_account_id
  log_info "AWS Account: ${ACCOUNT_ID}"
  log_info "Region: ${REGION}"
  log_info "Environment: ${ENV_NAME}"
  log_info "Mode: $(if [[ "$DRY_RUN" == "true" ]]; then echo 'DRY-RUN'; else echo 'EXECUTE'; fi)"
  log_info "Target stacks: ${STACKS[*]}"

  # Always show dry-run report first
  dry_run

  # Execute if not dry-run
  if [[ "$DRY_RUN" == "false" ]]; then
    execute_destroy
  fi
}

main
