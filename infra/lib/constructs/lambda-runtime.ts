import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Lambda runtime used by every application function (including Custom Resource handlers).
 *
 * This is the ONLY place in `infra/lib` where the Node.js runtime version is specified.
 * Do not hard-code `lambda.Runtime.NODEJS_*_X` anywhere else.
 *
 * Must be kept on the same Node.js major version as {@link ESBUILD_NODE_TARGET}.
 * To roll back, change both constants together.
 */
export const APP_LAMBDA_RUNTIME = lambda.Runtime.NODEJS_26_X;

/**
 * esbuild `target` used when bundling Lambda handlers.
 *
 * This is the ONLY place in `infra/lib` where the esbuild Node target is specified.
 * Must be kept on the same Node.js major version as {@link APP_LAMBDA_RUNTIME}.
 */
export const ESBUILD_NODE_TARGET = 'node26';
