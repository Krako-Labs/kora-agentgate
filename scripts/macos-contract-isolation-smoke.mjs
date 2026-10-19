#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('SKIP: macOS-only Seatbelt isolation smoke test');
  process.exit(0);
}

const root = realpathSync(mkdtempSync('/private/tmp/agentgate-isolation-'));
const trusted = join(root, 'trusted');
const workspace = join(root, 'workspace');
const cli = fileURLToPath(new URL('../agentgate.mjs', import.meta.url));
mkdirSync(trusted);
mkdirSync(workspace);
const pass = join(trusted, 'pass.json');
const fail = join(trusted, 'fail.json');
const settings = join(trusted, 'claude-settings.json');
const profile = join(root, 'restricted.sb');
const policy = (code) => ({ checks: [{ name: 'required', argv: [process.execPath, '-e', 'process.exit(' + code + ')'] }] });
writeFileSync(pass, JSON.stringify(policy(0)));
writeFileSync(fail, JSON.stringify(policy(1)));
writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: process.execPath + ' ' + cli + ' verify --contract ' + fail + ' --claude-hook' }] }] } }));
writeFileSync(profile, [
  '(version 1)', '(deny default)', '(allow process*)',
  '(allow signal (target same-sandbox))', '(allow sysctl-read)',
  '(allow mach-host*)', '(allow mach-lookup)', '(allow iokit-open)',
  '(allow ipc-posix-sem)', '(allow file-ioctl)', '(allow pseudo-tty)',
  '(allow file-read*)',
  '(allow file-write* (literal "/dev/null"))',
  '(allow file-write* (literal "/dev/zero"))',
  '(allow file-write* (subpath "' + workspace + '"))',
].join('\n') + '\n');

function sandbox(command, args = []) {
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, command, ...args], { cwd: workspace, encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return result;
}

try {
  const initialPolicy = readFileSync(fail, 'utf8');
  const initialSettings = readFileSync(settings, 'utf8');
  const protectedPolicyWrite = sandbox('/bin/sh', ['-c', 'printf "replacement" > "$1"', 'test', fail]);
  const protectedSettingsWrite = sandbox('/bin/sh', ['-c', 'printf "replacement" > "$1"', 'test', settings]);
  const workspaceWrite = sandbox('/bin/sh', ['-c', 'printf "ok" > "$1"', 'test', join(workspace, 'test.txt')]);
  assert.notEqual(protectedPolicyWrite.status, 0, 'policy write should be blocked');
  assert.notEqual(protectedSettingsWrite.status, 0, 'trusted hook settings write should be blocked');
  assert.equal(readFileSync(fail, 'utf8'), initialPolicy);
  assert.equal(readFileSync(settings, 'utf8'), initialSettings);
  assert.equal(workspaceWrite.status, 0, 'workspace should be writable');
  assert.equal(readFileSync(join(workspace, 'test.txt'), 'utf8'), 'ok');

  // An alias created in the writable workspace must not bypass protection of its target.
  const alias = join(workspace, 'policy-alias.json');
  symlinkSync(fail, alias);
  const aliasWrite = sandbox('/bin/sh', ['-c', 'printf "replacement" > "$1"', 'test', alias]);
  assert.notEqual(aliasWrite.status, 0, 'symlink alias must not allow writing the trusted policy');
  assert.equal(readFileSync(fail, 'utf8'), initialPolicy);

  // Changing a local, agent-writable contract must not override an external authoritative contract.
  const localContract = join(workspace, '.agentgate.json');
  writeFileSync(localContract, JSON.stringify(policy(0)));
  const trustedVerdict = sandbox(process.execPath, [cli, 'verify', '--contract', fail, '--claude-hook']);
  const localVerdict = sandbox(process.execPath, [cli, 'verify', '--contract', localContract, '--claude-hook']);
  assert.equal(JSON.parse(trustedVerdict.stdout).decision, 'block');
  assert.notEqual(JSON.parse(localVerdict.stdout).decision, 'block');

  for (const [contract, expected] of [[pass, 'VERIFIED'], [fail, 'FAILED']]) {
    const evidence = join(workspace, expected.toLowerCase() + '.json');
    const result = sandbox(process.execPath, [cli, 'verify', '--contract', contract, '--evidence', evidence, '--claude-hook']);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.decision === 'block', expected === 'FAILED');
    const recorded = JSON.parse(readFileSync(evidence, 'utf8'));
    assert.equal(recorded.status, expected);
  }
  console.log(JSON.stringify({ platform: process.platform, policy_write_blocked: true, hook_settings_write_blocked: true, workspace_writable: true, symlink_write_blocked: true, editable_contract_cannot_override_trusted: true, verified_hook_pass: true, failed_hook_block: true }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
