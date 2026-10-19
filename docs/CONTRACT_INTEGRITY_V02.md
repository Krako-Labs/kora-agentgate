# AgentGate v0.2 — Contract Integrity (design checkpoint)

Status: design candidate, not implemented or released.

**Latest verification (2026-10-19):** macOS deny-default sandbox with canonical paths passed a reproducible protected-policy + protected-Hook-file write-denial test while keeping the workspace writable. AgentGate's Stop Hook output was VERIFIED/allow and FAILED/block under the same sandbox. This supersedes earlier allow-default and noncanonical-path sandbox experiments. **Real Claude Code model E2E is still blocked: the host CLI itself reports `loggedIn: false`. This is a sandbox/CLI smoke test, not a complete contract-integrity security guarantee.**

## User signal
Dev Verma (LinkedIn), Tim Sherstyuk (X), and MONSMITH (X) independently questioned who is allowed to modify the check contract. MONSMITH suggested a versioned repo-level baseline, with per-task checks that can only tighten it.

## Threat model
An agent with write access to the project can modify `.agentgate.json`, remove checks, or change the Stop Hook invocation. A runner alone does not protect its policy.

## Minimum trusted boundary
1. Maintainer controls the authoritative contract outside the agent's write permissions.
2. Trusted hook or external runner supplies an explicit absolute path.
3. Agent-proposed checks may add requirements, never remove or weaken the baseline.
4. Missing, invalid, or unreadable authoritative contract fails closed.
5. File paths, hashes, or in-repo approval files do not enforce this boundary if the agent has the same unrestricted OS permissions as the maintainer. Use actual OS/sandbox/service account isolation.

## Smallest validation experiment
Build a documented workflow with policy stored outside the writable workspace and Stop Hook configured in a trusted context. Ask the agent to change or bypass the checks, and verify it cannot change either the authoritative contract or the invocation.

## Later, only after adoption signal
Optional external policy path; additive per-task checks; explicit immutable policy version. Regression cases for missing policy, tampering, path substitution, and hook bypass. Avoid introducing a policy server, UI, or full authorization framework.

## Success gate
A real developer can use the reference setup quickly; adversarial tampering fails in that defined deployment context; v0.1.1 verdict semantics remain intact.

## Verification record — 2026-10-19

**Mac host (MSM2-1): NOT ENFORCED.** A `sandbox-exec` deny-write profile did not deny a policy write in the tested invocation. The protected policy was overwritten, and the trusted-path verifier subsequently returned UNKNOWN. An agent-writable substitute contract returned VERIFIED. Therefore this deployment is explicitly unsafe and **must not be advertised as protected**.

**Linux separate-UID simulation: PASS for OS permissions only.** A root-owned mode-0644 policy and hook under a non-writable root-owned directory rejected write attempts by the `nobody` user, while allowing writes to a separate workspace. This is not a live Claude Code Stop Hook E2E, and it does not prove protection when the agent runs with maintainer permissions.

**Release decision:** NO-GO for v0.2 security/contract-integrity claims. Required next: real isolated Claude Code agent invocation under a restricted principal, immutable trusted hook configuration, tampering tests against both files and invocation, and documented installation workflow usable by an external developer.

## Follow-up validation — 2026-10-19 (macOS MSM2-1)
- KORA Reach / KRAKO remote command access works with uid 501 (`akim`).
- `sudo -n true` reports `a password is required`; no authorized separate-UID launch path was available without interactive authorization.
- No Docker or Podman executable was discovered.
- A second `sandbox-exec` experiment with explicit `deny file-write-data` for a literal policy path plus `deny file-write-create` for the parent directory still permitted modification: original file became `changed`. Therefore do not use this environment as proof of a protected policy.
- **NO-GO** on macOS isolation claim. Do not issue v0.2 or claim actual Claude Code adversarial testing has passed.
- Next required step: administrator-approved separate execution identity/sandbox or an external Linux test host, with a trusted hook that the coding agent cannot edit. Run actual Claude Code adversarial scenarios only under that proven isolation.


## Reproducible macOS smoke test — 2026-10-19

```sh
npm run test:isolation
```

On MSM2-1 (macOS 26.7.1, Node 26.7.0), the test passed all five assertions:
- A deny-default Seatbelt profile blocked rewriting the trusted contract.
- It blocked rewriting the trusted Stop Hook settings file.
- It allowed ordinary writes inside the canonical agent workspace.
- AgentGate returned an allow decision for VERIFIED.
- AgentGate returned a block decision for FAILED.

The script generates disposable files under `/private/tmp` and cleans up. It does **not** create macOS accounts or modify KORA Reach, and it does not run an actual Claude Code model. No network access is allowed in this test.

**Remaining blocker:** `~/.local/bin/claude auth status` reported `loggedIn: false` both inside and outside the sandbox. No credentials were inspected, copied, or imported. Real Claude Code auth and Stop Hook E2E remain pending an interactive login by the account owner.

**Important limitations:** The smoke test checks direct filesystem writes and the CLI Hook verdict, not networked MCP/unsandboxed-service escape paths, alternate model sessions, privacy/data exfiltration, or general OS security. Its read permissions are deliberately broad to support the Node runtime, and must be narrowed before a production isolation claim. Protect the authoritative settings and policy via an externally controlled launcher, not merely an editable project setting. v0.2 remains **NO-GO** until a real agent adversarial test is completed.
