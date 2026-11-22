import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayServer = await readFile(
  new URL('../services/gateway/src/server.rs', import.meta.url),
  'utf8',
);
if (!gatewayServer.includes('.route("/receive/:subaddress", get(payment_status))')) {
  throw new Error('Gateway status route must use the workspace-pinned Axum 0.7 syntax.');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function resolveBunExecutable() {
  if (process.env.BUN_EXECUTABLE) return process.env.BUN_EXECUTABLE;
  if (process.platform !== 'win32') return 'bun';

  const candidates = [
    process.env.APPDATA &&
      path.join(process.env.APPDATA, 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.bun', 'bin', 'bun.exe'),
    ...(process.env.PATH ?? '')
      .split(path.delimiter)
      .map((directory) => path.join(directory, 'bun.exe')),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? 'bun';
}

const vectorJson = run('cargo', [
  'run',
  '--locked',
  '-p',
  'damz-gateway',
  '--example',
  'payment_notification_vector',
]);
const vector = JSON.parse(vectorJson);

// Bun loads the repo's TypeScript directly. Its output includes a fresh
// TypeScript-to-Rust envelope; the fixed Rust-generated envelope is opened by
// the TypeScript implementation in the opposite direction.
const bunScript = `
  const vector = JSON.parse(process.env.DAMZ_PAYMENT_NOTIFICATION_VECTOR);
  const crypto = await import('./packages/core/src/payments/PaymentNotificationCrypto.ts');
  const opened = await crypto.openPaymentNotification(
    vector.envelope,
    vector.gateway_did,
    vector.runner_did,
    vector.runner_private_multibase,
  );
  const reverseEnvelope = await crypto.sealPaymentNotification(
    vector.notification,
    vector.gateway_did,
    vector.gateway_private_multibase,
    vector.runner_did,
  );
  console.log(JSON.stringify({ opened, reverseEnvelope }));
`;
const bunOutput = run(resolveBunExecutable(), ['--eval', bunScript], {
  env: { ...process.env, DAMZ_PAYMENT_NOTIFICATION_VECTOR: vectorJson },
});
const { opened, reverseEnvelope } = JSON.parse(bunOutput.split(/\r?\n/).at(-1));
if (!isDeepStrictEqual(opened, vector.notification)) {
  throw new Error('TypeScript did not open the Rust HPKE Auth notification correctly.');
}

const rustOpened = JSON.parse(
  run(
    'cargo',
    ['run', '--locked', '-p', 'damz-gateway', '--example', 'payment_notification_vector', '--', '--open'],
    {
      input: JSON.stringify({
        gateway_did: vector.gateway_did,
        runner_did: vector.runner_did,
        runner_private_multibase: vector.runner_private_multibase,
        envelope: reverseEnvelope,
      }),
    },
  ),
);
if (!isDeepStrictEqual(rustOpened, vector.notification)) {
  throw new Error('Rust did not open the TypeScript HPKE Auth notification correctly.');
}

console.log('gateway notification wire contract verified (Rust ↔ TypeScript)');
