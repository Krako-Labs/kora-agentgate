# AgentGate v0.2 — Contract Integrity (design checkpoint)

Status: design candidate, not implemented or released.

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
