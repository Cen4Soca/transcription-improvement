#!/bin/bash

set -e

# Set AWS Profile
export AWS_DEFAULT_PROFILE=xxxxx
export AWS_PROFILE=xxxxx

echo "================================"
echo " TRANSCRIPTION IMPROVEMENT      "
echo "           DEPLOY               "
echo "================================"

# Set Node.js memory limit to 1.5GB (1536MB)
export NODE_OPTIONS="--max-old-space-size=1536"

# Process command arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -c|--cdk-context)
            cdk_context_path="$2"
            shift 2
            ;;
        -h|--help)
            echo "-c, --cdk-context    ... Path to the cdk.json file"
            echo "-h, --help          ... Show this message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if the file exists
if [[ -n "$cdk_context_path" && ! -f "$cdk_context_path" ]]; then
    echo "Error: CDK context file not found: $cdk_context_path"
    exit 1
fi

pushd /tmp

# Delete the repository in /tmp if it exists
rm -rf transcription-improvement

# Clone transcription-improvement
git clone depth 1 https://github.com/Cen4Soca/transcription-improvement
# cp -r $HOME/Documents/gitProjects/transcription-improvement .
pushd transcription-improvement

# If cdk.json is specified, overwrite it
if [[ -n "$cdk_context_path" ]]; then
    echo "Overwrite the cdk.json by $cdk_context_path"
    cp -f $cdk_context_path infra/cdk.json
fi

# Build the frontend so the CDK BucketDeployment (../frontend/dist) picks up
# the latest source. Without this step, cdk deploy re-uploads a stale dist and
# frontend changes never reach S3/CloudFront.
#
# Remove the node_modules copied in from the source tree, then do ONE clean
# install. We do NOT use `npm ci`: eslint-plugin-react@7.37.5 peers eslint <=9.7
# while the project is on eslint@10, so `npm ci` always fails ERESOLVE and, worse,
# leaves node_modules half-deleted (tsc goes missing) which makes a following
# `npm install` think it is "up to date" and skip the repair. A single
# `npm install --legacy-peer-deps` against the kept lockfile resolves cleanly.
# The eslint packages are lint-only and do not affect `vite build`.
echo "--------------------------"
echo "   BUILD FRONTEND (dist)  "
echo "--------------------------"
pushd frontend
rm -rf node_modules
npm install --legacy-peer-deps
npm run build
popd

# Requirements Install
cd infra
rm -rf node_modules package-lock.json
npm install

# CDK Bootstrap
npx cdk bootstrap

# Check diff
npx cdk diff --all

# Deploy
npx cdk deploy --all --require-approval never
