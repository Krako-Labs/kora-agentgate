#!/usr/bin/env node
// Zero-credential, disposable smoke test for AgentGate's macOS protected launcher.
// This uses a local mock agent, NOT a real Claude model.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const launcher=fileURLToPath(new URL('../protected-runner.mjs',import.meta.url));
const sha256=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function selfTest(){
 if(process.platform!=='darwin') {
   console.error('Protected Launcher self-test currently requires macOS.');
   return 2;
 }
 const base=realpathSync(mkdtempSync('/private/tmp/agentgate-usertrial-'));
 const workspace=join(base,'workspace'),trusted=join(base,'trusted'),auditDir=join(trusted,'audit');
 mkdirSync(workspace,{mode:0o700});mkdirSync(trusted,{mode:0o700});
 const checks=[];
 const run=(label,contract,script)=>{
   const agent=join(trusted,label+'.sh');
   writeFileSync(agent,'#!/bin/sh\n'+script+'\n',{mode:0o700});
   chmodSync(agent,0o700);
   const started=Date.now();
   const result=spawnSync(process.execPath,[launcher,
      '--workspace',workspace,'--contract',contract,'--audit-dir',auditDir,
      '--claude',agent,'--prompt','Local mock test; no network or model account is used',
      '--max-turns','1','--budget','0.10'],{encoding:'utf8',timeout:15000});
   if(result.error)throw result.error;
   const files=readdirSync(auditDir).filter(f=>f.endsWith('.json'));
   assert.equal(files.length,checks.length+1,'Expected one new parent-owned audit per run');
   const newest=files.map(f=>({f,a:JSON.parse(readFileSync(join(auditDir,f),'utf8'))}))
     .find(x=>!checks.some(v=>v.runId===x.a.runId));
   assert.ok(newest,'Missing fresh audit');
   return {result,audit:newest.a,file:join(auditDir,newest.f),durationMs:Date.now()-started};
 };
 try{
   const pass=join(trusted,'pass.json'),fail=join(trusted,'fail.json');
   const check=(exit)=>JSON.stringify({checks:[{
     name:'fixture',argv:[process.execPath,'-e','process.exit('+exit+')'],timeoutMs:1500,
   }]});
   writeFileSync(pass,check(0),{mode:0o600});
   writeFileSync(fail,check(1),{mode:0o600});
   const passCase=run('passing-mock',pass,'exit 0');
   assert.equal(passCase.result.status,0,passCase.result.stderr);
   assert.equal(passCase.audit.status,'VERIFIED');
   assert.equal(passCase.audit.accepted,true);
   checks.push({name:'passing-contract',ok:true,runId:passCase.audit.runId,durationMs:passCase.durationMs});

   const fake=join(workspace,'forged-evidence.json');
   const forged=run('forged-report',fail,
     'printf %s '+JSON.stringify('{"status":"VERIFIED"}')+' > '+JSON.stringify(fake)+'\nexit 0');
   assert.equal(forged.result.status,2);
   assert.equal(forged.audit.status,'FAILED');
   assert.equal(forged.audit.accepted,false);
   assert.equal(JSON.parse(readFileSync(fake,'utf8')).status,'VERIFIED');
   checks.push({name:'forged-workspace-evidence-rejected',ok:true,runId:forged.audit.runId,durationMs:forged.durationMs});

   const auditHash=sha256(passCase.file),policyHash=sha256(fail);
   const protect=run('write-boundary',fail,
     'printf modified > '+JSON.stringify(fail)+' 2>/dev/null || true\n' +
     'printf modified > '+JSON.stringify(passCase.file)+' 2>/dev/null || true\nexit 0');
   assert.equal(protect.result.status,2);
   assert.equal(protect.audit.status,'FAILED');
   assert.equal(sha256(fail),policyHash);
   assert.equal(sha256(passCase.file),auditHash);
   checks.push({name:'trusted-policy-and-audit-write-denied',ok:true,runId:protect.audit.runId,durationMs:protect.durationMs});

   console.log(JSON.stringify({
     result:'PASS',platform:process.platform,node:process.version,
     requiresClaudeLogin:false,usesModelAPI:false,checks,
     note:'Scoped macOS write-boundary smoke test; not a full security audit or actual Claude Code E2E.',
   },null,2));
   return 0;
 }catch(e){
   console.error(JSON.stringify({result:'FAIL',completed:checks.map(c=>c.name),error:e.message},null,2));
   return 1;
 }finally{
   rmSync(base,{recursive:true,force:true});
 }
}
