# Protected Launcher (macOS, experimental v0.2 candidate)

**Purpose:** Prevent a coding agent running inside the documented macOS Seatbelt sandbox from silently weakening an authoritative AgentGate verification contract or its Stop Hook settings.

**Status:** Preview implementation, **not a security certification**. The public release remains v0.1.1 until adoption and safety checks justify a new tag.

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

If the checks look correct, remove `--dry-run` to invoke Claude Code. The default limits are 3 turns and USD $0.50, configurable with `--max-turns` and `--budget`.

The launcher:
1. Resolves canonical paths and rejects a contract, AgentGate binary or launcher inside the writable workspace.
2. Creates a temporary trusted Hook configuration and a deny-default macOS sandbox profile outside the workspace.
3. Launches Claude Code with its project/local settings excluded, Chrome integration disabled, MCP configured empty, bounded run limits, and no session persistence.
4. Runs the authoritative contract at Stop, saving per-run JSON evidence under `.agentgate/evidence/<run-id>.json` in the workspace.
5. Removes the temporary trusted Hook configuration and profile when the session exits.

**Important:** The evidence JSON is inside the writable workspace. Treat it as execution feedback, not an immutable or tamper-proof audit log. The Hook makes its own decision at execution time. The launcher rejects a clean Claude exit when no fresh VERIFIED evidence exists; the workspace file itself remains editable and must not be treated as tamper-proof.

## Verified behavior

The parent-controlled launcher completed a real Claude Code `READY` session with a `VERIFIED` evidence record on MSM2-1 (2026-10-19). The existing adversarial E2E suite separately demonstrated that the parent-supplied Hook blocks a failed contract, rejects direct writes to trusted contracts and Hook settings, and rejects a symlink write to the authoritative policy.

Run `npm test` and `npm run test:isolation` to validate CLI and macOS filesystem-write boundaries. The tests are **not** a comprehensive sandbox escape audit.

## Known risks and scope

- Broad file read and network permissions are enabled to support the macOS and Claude runtimes. These may permit **credential reading, network exfiltration or connections to local privileged services**. Do **not** place secrets or a high-trust remote-control API within reach of an untrusted agent.
- An agent that starts an unsandboxed instance or gains access to an external unsandboxed service can bypass this boundary. Only the trusted external Launcher invocation is in scope.
- Inherited user-level Claude settings are still loaded; the launcher excludes project/local setting sources and disables MCP/Chrome integration. Review your user settings before use.
- Any `--claude` binary, inherited environment variable, or verification command may introduce additional risk. Authentication and permitted tool behavior vary across installations.
- The launcher uses macOS `sandbox-exec`, which is not a portable sandbox mechanism and is deprecated by Apple. It is only the **current reproducible development experiment**, not a long-term isolation architecture.
- `--dry-run` checks paths/configuration but does not validate the real model API call or guarantees about isolation.
- No agent-generated additions to baseline policy are supported yet; it is deliberately a fixed authoritative contract.

## Feedback needed

Please try this on a disposable repository and report: macOS/Node/Claude versions, whether the launcher started, whether the expected Stop Hook fired, any permission-denied errors, and the outcome of deliberately failing the declared checks. Do not paste tokens or private project contents into issues.

GitHub: https://github.com/Krako-Labs/kora-agentgate/issues

## Installed-package validation — 2026-10-19

A fresh local npm tarball installed successfully outside the agent workspace. Both CLI binaries worked, including a real Claude Code run that returned READY and wrote VERIFIED evidence. With a project-local .claude/settings.json containing a synthetic Stop Hook, the launcher still ran the authoritative external Hook; the synthetic project Hook did not execute. This is a positive smoke test, not a comprehensive security audit.

## Evidence freshness and file-writing tool check

The launcher generates a new evidence filename for every session and refuses to report a clean success exit if its corresponding VERIFIED record is absent. A controlled mock Claude process that exited 0 without invoking the Hook was rejected with exit code 2. A real isolated model invocation created an expected HELLO file inside the writable workspace and generated a fresh VERIFIED record. The evidence file remains writable by the agent and is not a signed security artifact.
