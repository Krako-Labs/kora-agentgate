# AgentGate
**A coding agent saying DONE isn't proof. AgentGate verifies completion with executable checks.**

AgentGate is a tiny Node.js CLI that runs explicit verification contracts and produces JSON evidence. A Claude Code Stop hook can block a completion claim if required checks fail or cannot run.

## Requirements
Node.js 20+. Claude Code is optional; it is only needed for the hook integration. **Run only trusted contracts:** each declared command executes with the current user's permissions.

## Quick demo
```sh
npm test
node agentgate.mjs verify --contract examples/pass.json --evidence evidence/pass.json
node agentgate.mjs verify --contract examples/fail.json --evidence evidence/fail.json
```
Exit codes (normal CLI): 0 VERIFIED, 1 FAILED, 2 UNKNOWN. A missing binary, invalid contract, failed evidence write, or timeout never passes.

## Your project
Install from GitHub using `npm install --save-dev github:Krako-Labs/kora-agentgate`, or copy `agentgate.mjs`. In your repo root:
Create `.agentgate.json` in your project:

```json
{"checks":[{"name":"tests","argv":["npm","test"],"timeoutMs":30000}]}
```
Run `./node_modules/.bin/agentgate verify --contract .agentgate.json --evidence evidence/latest.json`.

## Claude Code Stop hook (experimental)
Add a Stop hook to the **project-local** `.claude/settings.json`:
```json
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node /ABSOLUTE/PATH/agentgate.mjs verify --contract .agentgate.json --evidence evidence/latest.json --claude-hook"}]}]}}
```
When checks pass, hook prints `{}`. Otherwise it prints `{"decision":"block",...}`; the hook exits 0 so Claude Code can parse its decision. Keep the number of retries bounded; a permanently failing check can repeatedly block the agent until the session ends. Stop hooks do **not** fix failures automatically.

## Scope and limitations
- Proof of the declared checks, **not** proof that every requirement is satisfied.
- Checks execute serially; total verification time is bounded per check, not globally.
- Real Claude Code fail/pass E2E exercises the Stop hook; production use and other agents remain unvalidated.
- No network telemetry, background services, auto-fixes, or automatic publishing.

## License
MIT. This project is independent of other software using the name AgentGate.
