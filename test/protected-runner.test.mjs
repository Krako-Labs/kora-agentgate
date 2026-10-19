import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare} from '../protected-runner.mjs';

const cli=fileURLToPath(new URL('../protected-runner.mjs',import.meta.url));
const gate=fileURLToPath(new URL('../agentgate.mjs',import.meta.url));
const SKIP=process.platform!=='darwin';
function withTrial(fn) {
 const root=mkdtempSync('/private/tmp/agentgate-runner-test-');
 const workspace=join(root,'workspace'),trusted=join(root,'trusted');
 mkdirSync(workspace); mkdirSync(trusted);
 const contract=join(trusted,'policy.json');
 writeFileSync(contract,JSON.stringify({checks:[{name:'valid',argv:[process.execPath,'-e','process.exit(0)']}]}));
 try {return fn({root,workspace,trusted,contract});}
 finally {rmSync(root,{recursive:true,force:true});}
}
test('protected launcher prepares external settings, fixed flags and profile', {skip:SKIP},()=>withTrial(({workspace,contract})=>{
 const x=prepare({workspace,contract,prompt:'hello',maxTurns:2,budget:0.2,dryRun:true});
 try{
  const settings=JSON.parse(readFileSync(x.settings,'utf8'));
  const hook=settings.hooks.Stop[0].hooks[0].command;
  assert.match(hook,/--claude-hook/);
  assert.ok(hook.includes(contract));
  assert.ok(hook.includes(gate));
  assert.ok(!x.workspace.startsWith(x.root));
  assert.ok(x.root.startsWith('/private/tmp/'));
  assert.equal(x.args[x.args.indexOf('--setting-sources')+1],'user');
  assert.ok(x.args.includes('--strict-mcp-config'));
  assert.ok(x.args.includes('--no-chrome'));
  assert.ok(x.args.includes('--no-session-persistence'));
  assert.equal(x.args[x.args.indexOf('--permission-mode')+1],'dontAsk');
  assert.ok(!x.args.includes('--dangerously-skip-permissions'));
  const policy=readFileSync(x.sandboxProfile,'utf8');
  assert.match(policy,/\(deny default\)/);
  assert.ok(policy.includes(x.workspace));
 }finally{rmSync(x.root,{recursive:true,force:true});}
}));
test('protected launcher denies in-workspace contracts', {skip:SKIP},()=>withTrial(({workspace})=>{
 const untrusted=join(workspace,'.agentgate.json');
 writeFileSync(untrusted,JSON.stringify({checks:[{argv:['/usr/bin/true']}]}));
 assert.throws(()=>prepare({workspace,contract:untrusted,prompt:'test',maxTurns:1,budget:0.2,dryRun:true}),/outside/);
}));
test('protected launcher denies running from the writable project containing itself', {skip:SKIP},()=>withTrial(({contract})=>{
 const sourceRepo=fileURLToPath(new URL('../',import.meta.url));
 assert.throws(()=>prepare({workspace:sourceRepo,contract,prompt:'test',maxTurns:1,budget:0.2,dryRun:true}),/Launcher must be outside/);
}));
test('protected launcher rejects invalid contracts and unsupported overrides', {skip:SKIP},()=>withTrial(({workspace,contract})=>{
 writeFileSync(contract,'not json');
 assert.throws(()=>prepare({workspace,contract,prompt:'test',maxTurns:1,budget:0.2,dryRun:true}));
 const r=spawnSync(process.execPath,[cli,'--workspace',workspace,'--contract',contract,'--prompt','test','--settings','evil.json','--dry-run'],{encoding:'utf8'});
 assert.equal(r.status,2);
 assert.match(r.stderr,/Unsupported option/);
}));
test('protected launcher policy blocks writes to protected contract and settings', {skip:SKIP},()=>withTrial(({workspace,contract})=>{
 const x=prepare({workspace,contract,prompt:'test',maxTurns:1,budget:0.2,dryRun:true});
 try{
  for (const p of [contract,x.settings,x.sandboxProfile]) {
    const before=readFileSync(p);
    const r=spawnSync('/usr/bin/sandbox-exec',['-f',x.sandboxProfile,'/bin/sh','-c','printf changed > "$1"','test',p],{cwd:workspace,encoding:'utf8',timeout:5000});
    assert.notEqual(r.status,0,p+' must be protected');
    assert.deepEqual(readFileSync(p),before);
  }
  const output=join(workspace,'created');
  const r=spawnSync('/usr/bin/sandbox-exec',['-f',x.sandboxProfile,'/bin/sh','-c','printf ok > "$1"','test',output],{cwd:workspace,encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(readFileSync(output,'utf8'),'ok');
 }finally{rmSync(x.root,{recursive:true,force:true});}
}));
