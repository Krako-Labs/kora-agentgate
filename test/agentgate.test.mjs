import {test} from 'node:test';import {strict as assert} from 'node:assert';import {check} from '../agentgate.mjs';
test('pass -> VERIFIED',async()=>assert.equal((await check('examples/pass.json')).status,'VERIFIED'));
test('failure -> FAILED',async()=>assert.equal((await check('examples/fail.json')).status,'FAILED'));
test('missing contract -> UNKNOWN',async()=>assert.equal((await check('examples/missing.json')).status,'UNKNOWN'));
test('missing executable -> UNKNOWN',async()=>{const r=await check('examples/missing-command.json');assert.equal(r.status,'UNKNOWN')});
test('timeout -> UNKNOWN',async()=>{const r=await check('examples/timeout.json');assert.equal(r.status,'UNKNOWN')});
