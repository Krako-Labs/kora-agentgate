# Protected Launcher (macOS, experimental v0.2 candidate)

**Purpose:** Prevent a coding agent running inside the documented macOS Seatbelt sandbox from silently weakening an authoritative AgentGate verification contract or its Stop Hook settings.

**Status:** Preview implementation, **not a security certification**. The public release remains v0.1.1 until adoption and safety checks justify a new tag.

## 60-second offline self-test (macOS)

No Claude login, API key, project access, or paid model tokens are required for this first check. It uses a disposable mock agent and cleans up its temporary files.

```sh
git clone -b feat/protected-launcher-v02 https://github.com/Krako-Labs/kora-agentgate.git ~/agentgate-preview
node ~/agentgate-preview/protected-runner.mjs --self-test
```

Expected: JSON with `"result": "PASS"` and three checks:
`passing-contract`, `forged-workspace-evidence-rejected`, and `trusted-policy-and-audit-write-denied`.

This is **only a local offline write-boundary smoke test**, not proof that Claude Code or a production sandbox is secure. If it fails, please report the macOS and Node.js versions and the error text in a GitHub issue. Do not share tokens or private paths.

After passing, continue with the real Claude Code preview below using **a disposable project**. Place the AgentGate installation outside that project.

## Requirements
- macOS and Node.js 20+; `sandbox-exec` present.
- Claude Code CLI already installed and signed in.
- The **AgentGate installation and verification contract must be outside the agent-writable project**.
- Run this launcher from a trusted terminal, not as a tool invoked by the coding agent.
- Use only verification commands you trust; they run with your user's OS privileges, inside the configured sandbox.

## Install for first trial

During preview, clone this branch **outside** the project being edited:

```sh
git clone -b feat/protected-launcher-v02 https://github.com/Krako-Labs/kora-agentgate.git ~/agentgate-preview
mkdir -p ~/.config/agentgate/contracts
cp ~/agentgate-preview/examples/pass.json ~/.config/agentgate/contracts/example.json
```

The example contract is a smoke check that always passes. Before using a real project, replace it with meaningful tests. In particular, an agent must not be able to edit `~/.config/agentgate/contracts/example.json` through its sandboxed tools or an external service.

Preview the layout without invoking a model:

```sh
node ~/agentgate-preview/protected-runner.mjs \
  --workspace /ABSOLUTE/PATH/TO/YOUR/PROJECT \
  --contract ~/.config/agentgate/contracts/example.json \
  --prompt 'Explain the project structure in one paragraph' \
  --dry-run
```

If the checks look correct, remove `--dry-run` to invoke Claude Code. The default limits are 3 turns and USD $0.50, configurable with `--max-turns` and `--budget`. The trusted audit directory defaults to `~/.local/share/agentgate/evidence` and can be overridden with `--audit-dir /ABSOLUTE/TRUSTED/DIR`.

The launcher:
1. Resolves canonical paths and rejects a contract, AgentGate binary or launcher inside the writable workspace.
2. Creates a temporary trusted Hook configuration and a deny-default macOS sandbox profile outside the workspace.
3. Launches Claude Code with its project/local settings excluded, Chrome integration disabled, MCP configured empty, bounded run limits, and no session persistence.
4. Runs the authoritative contract at Stop for immediate completion gating, **without writing an agent-editable Evidence file**.
5. After the Claude process ends, independently reruns the same contract under the sandbox. The trusted parent Launcher captures the verification result over a pipe and writes a new audit JSON under `~/.local/share/agentgate/evidence/<run-id>.json` (or the `--audit-dir` you specify).
6. Rejects successful model termination unless the independent result is `VERIFIED` **and** the parent audit record was saved. Cleans up temporary Hook and sandbox files.

**Important:** The final audit record is **outside the writable workspace and cannot be overwritten by the tested sandboxed agent process**. It is not cryptographically signed, globally immutable, or tamper-proof against a compromised/unconfined host. Its contents can include stdout/stderr from tests, so protect the directory. A forged `VERIFIED` file inside the workspace is ignored.

**Timing diagnostics:** Each parent-owned audit includes `timings.modelDurationMs`, `timings.postflightDurationMs`, and `timings.totalDurationMs` as observed wall-clock measurements. These help identify whether repeat verification becomes expensive in real projects. They are not token-cost estimates.

**Cost and side-effect tradeoff:** the same verification contract is run by the Stop Hook and again by the trusted parent after the session. These checks **must be safe to repeat**. The extra run can add latency and cost, especially for large suites. The parent verification is needed here because the sandboxed Hook cannot write to the protected directory. We will consider eliminating the duplicate run only if user feedback shows it is a bottleneck.

## Verified behavior

The parent-controlled launcher completed a real Claude Code `READY` session with a protected, parent-written `VERIFIED` audit record and independently captured check results on MSM2-1 (2026-10-19). A real negative run ended with `FAILED` and no accepted completion. The existing adversarial E2E suite separately demonstrated that the parent-supplied Hook blocks a failed contract, rejects direct writes to trusted contracts and Hook settings, and rejects a symlink write to the authoritative policy.

Run `npm test` and `npm run test:isolation` to validate CLI and macOS filesystem-write boundaries. The tests are **not** a comprehensive sandbox escape audit.

## Known risks and scope

- Broad file read and network permissions are enabled to support the macOS and Claude runtimes. These may permit **credential reading, network exfiltration or connections to local privileged services**. Do **not** place secrets or a high-trust remote-control API within reach of an untrusted agent.
- An agent that starts an unsandboxed instance or gains access to an external unsandboxed service can bypass this boundary. Only the trusted external Launcher invocation is in scope.
- Inherited user-level Claude settings are still loaded; the launcher excludes project/local setting sources and disables MCP/Chrome integration. Review your user settings before use.
- Any `--claude` binary, inherited environment variable, or verification command may introduce additional risk. Common credential and runtime-injection environment variables are stripped before launching the agent, but this is not comprehensive credential isolation. Authentication and permitted tool behavior vary across installations.
- The launcher uses macOS `sandbox-exec`, which is not a portable sandbox mechanism and is deprecated by Apple. It is only the **current reproducible development experiment**, not a long-term isolation architecture.
- `--dry-run` checks paths/configuration but does not validate the real model API call or guarantees about isolation.
- No agent-generated additions to baseline policy are supported yet; it is deliberately a fixed authoritative contract.

## Feedback needed

Please try this on a disposable repository and report: macOS/Node/Claude versions, whether the launcher started, whether the expected Stop Hook fired, any permission-denied errors, and the outcome of deliberately failing the declared checks. Do not paste tokens or private project contents into issues.

GitHub: https://github.com/Krako-Labs/kora-agentgate/issues

## Installed-package validation — 2026-10-19

A fresh local npm tarball installed successfully outside the agent workspace. Both CLI binaries worked, including a real Claude Code run that returned READY and wrote VERIFIED evidence. With a project-local .claude/settings.json containing a synthetic Stop Hook, the launcher still ran the authoritative external Hook; the synthetic project Hook did not execute. This is a positive smoke test, not a comprehensive security audit.

## Evidence freshness and file-writing tool check

The earlier workspace Evidence freshness check has been replaced by parent-owned postflight audit records. The trusted Launcher now reruns the declared checks inside the sandbox, captures their results, and writes one record per session outside the agent workspace. A forged workspace `VERIFIED` file cannot override a failing postflight. An exit-zero mock model with a passing contract is accepted by the parent postflight even if it omits a Stop Hook, because the parent independently established the declared checks; a failing contract or a model exit error is rejected. A real isolated model invocation created the expected HELLO file and the independent evidence still recorded `VERIFIED`.

## Evidence Integrity validation — 2026-10-19

External feedback by MONSMITH identified that the older `.agentgate/evidence` directory was agent-writable.

The current branch now performs independent, sandbox-constrained **postflight verification** and writes the audit JSON from the parent process to a directory outside the agent's writable scope. The test suite checks:
- A forged `VERIFIED` report inside the workspace does not make a failing authoritative contract pass.
- A sandboxed process cannot overwrite a parent-owned audit record.
- A successful model response with a passing contract produces an independently verified record.
- A failed model response cannot become a successful completion even if the postflight checks pass.
- The audit directory cannot reside inside the agent-writable workspace.

**Limit:** parent-controlled verification is still scoped to the commands in the approved contract. Network escape, unsandboxed services, malicious test commands, and privileged host compromise require separate controls. These records are write-isolated within the documented sandbox, not cryptographically tamper-evident.
