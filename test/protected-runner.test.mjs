import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, existsSync} from 'node:fs';
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
test('protected launcher prepares external settings, fixed flags and profile', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 const x=prepare({workspace,contract,auditDir:join(trusted,'audit'),prompt:'hello',maxTurns:2,budget:0.2,dryRun:true});
 try{
  const settings=JSON.parse(readFileSync(x.settings,'utf8'));
  const hook=settings.hooks.Stop[0].hooks[0].command;
  assert.match(hook,/--claude-hook/);
  assert.ok(hook.includes(contract));
  assert.ok(hook.includes(gate));
  assert.ok(!hook.includes('--evidence'), 'Stop Hook must not write mutable workspace evidence');
  assert.ok(x.auditFile.startsWith(join(trusted,'audit')+'/'));
  assert.ok(!x.auditFile.startsWith(workspace+'/'));
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
test('protected launcher policy blocks writes to protected contract and settings', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 const x=prepare({workspace,contract,auditDir:join(trusted,'audit'),prompt:'test',maxTurns:1,budget:0.2,dryRun:true});
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

test('each protected launch uses a fresh parent-owned audit path', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 const auditDir=join(trusted,'audit');
 const a=prepare({workspace,contract,auditDir,prompt:'a',maxTurns:1,budget:0.2,dryRun:true});
 const b=prepare({workspace,contract,auditDir,prompt:'b',maxTurns:1,budget:0.2,dryRun:true});
 try {
  assert.notEqual(a.auditFile,b.auditFile);
  assert.ok(a.auditFile.startsWith(auditDir+'/'));
  assert.ok(b.auditFile.startsWith(auditDir+'/'));
  assert.ok(!a.auditFile.startsWith(workspace+'/'));
 }finally{
  rmSync(a.root,{recursive:true,force:true});
  rmSync(b.root,{recursive:true,force:true});
 }
}));

test('parent verification fails closed despite a fake agent VERIFIED evidence record', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 // A malicious mock can write anything into the workspace, but cannot alter the parent audit.
 writeFileSync(contract,JSON.stringify({checks:[{argv:[process.execPath,'-e','process.exit(1)']}]}));
 const fake=join(trusted,'claude-fake.sh');
 writeFileSync(fake,[
  '#!/bin/sh','mkdir -p '+JSON.stringify(join(workspace,'.agentgate','evidence')),
  `printf '{"status":"VERIFIED"}' > ${JSON.stringify(join(workspace,'.agentgate','evidence','forged.json'))}`,
  'exit 0','',
 ].join('\n'),{mode:0o755});
 const auditDir=join(trusted,'audit');
 const r=spawnSync(process.execPath,[cli,
   '--workspace',workspace,'--contract',contract,'--audit-dir',auditDir,
   '--claude',fake,'--prompt','READY','--max-turns','1'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,2,'a fake agent VERIFIED record must not satisfy independent postflight');
 const files=readdirSync(auditDir).filter(n=>n.endsWith('.json'));
 assert.equal(files.length,1);
 const audit=JSON.parse(readFileSync(join(auditDir,files[0]),'utf8'));
 assert.equal(audit.status,'FAILED');
 assert.equal(audit.accepted,false);
 assert.equal(audit.verification.status,'FAILED');
 assert.equal(statSync(join(auditDir,files[0])).mode & 0o777,0o600);
 assert.equal(statSync(auditDir).mode & 0o777,0o700);
 assert.ok(readFileSync(join(workspace,'.agentgate/evidence/forged.json'),'utf8').includes('VERIFIED'));
 const sandbox=prepare({workspace,contract,auditDir,prompt:'test',maxTurns:1,budget:0.2,dryRun:true});
 try {
  const destination=join(auditDir,files[0]),original=readFileSync(destination);
  const attack=spawnSync('/usr/bin/sandbox-exec',['-f',sandbox.sandboxProfile,'/bin/sh','-c','printf tampered > "$1"','test',destination],{cwd:workspace,encoding:'utf8',timeout:5000});
  assert.notEqual(attack.status,0);
  assert.deepEqual(readFileSync(destination),original);
  const readAttempt=spawnSync('/usr/bin/sandbox-exec',['-f',sandbox.sandboxProfile,'/bin/cat',destination],{cwd:workspace,encoding:'utf8',timeout:5000});
  assert.notEqual(readAttempt.status,0,'sandboxed agent must not read private audit records');
 } finally {rmSync(sandbox.root,{recursive:true,force:true});}
}));

test('successful parent postflight accepts check without mutable Hook evidence', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 const fake=join(trusted,'claude-fake.sh');
 writeFileSync(fake,'#!/bin/sh\nexit 0\n',{mode:0o755});
 const auditDir=join(trusted,'audit');
 const r=spawnSync(process.execPath,[cli,
   '--workspace',workspace,'--contract',contract,'--audit-dir',auditDir,
   '--claude',fake,'--prompt','READY','--max-turns','1'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.stderr);
 const files=readdirSync(auditDir).filter(n=>n.endsWith('.json'));
 assert.equal(files.length,1);
 const audit=JSON.parse(readFileSync(join(auditDir,files[0]),'utf8'));
 assert.equal(audit.status,'VERIFIED');
 assert.equal(audit.accepted,true);
 assert.equal(audit.verification.status,'VERIFIED');
 assert.equal(existsSync(join(workspace,'.agentgate','evidence')),false,'Hook should not write to a mutable workspace evidence directory');
}));

test('audit directory is never allowed inside the agent workspace', {skip:SKIP},()=>withTrial(({workspace,contract})=>{
 assert.throws(()=>prepare({workspace,contract,auditDir:join(workspace,'audit'),prompt:'test',maxTurns:1,budget:0.2,dryRun:true}),/outside/);
}));

test('child exit failure is recorded even if independent checks pass', {skip:SKIP},()=>withTrial(({workspace,contract,trusted})=>{
 const fake=join(trusted,'claude-fake.sh');
 writeFileSync(fake,'#!/bin/sh\nexit 1\n',{mode:0o755});
 const auditDir=join(trusted,'audit');
 const r=spawnSync(process.execPath,[cli,
   '--workspace',workspace,'--contract',contract,'--audit-dir',auditDir,
   '--claude',fake,'--prompt','READY','--max-turns','1'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,1);
 const [file]=readdirSync(auditDir);
 const audit=JSON.parse(readFileSync(join(auditDir,file),'utf8'));
 assert.equal(audit.verification.status,'VERIFIED');
 assert.equal(audit.accepted,false);
 assert.equal(audit.modelExitCode,1);
}));
