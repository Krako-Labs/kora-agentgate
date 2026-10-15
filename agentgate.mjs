#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
export async function check(file,{cwd=process.cwd()}={}){
 const startedAt=new Date().toISOString();let contract;
 try{contract=JSON.parse(await readFile(resolve(cwd,file),'utf8'))}catch(e){return {status:'UNKNOWN',reason:'Cannot read contract: '+e.message,checks:[],startedAt}}
 if(!Array.isArray(contract.checks)||contract.checks.length===0||contract.checks.some(c=>!Array.isArray(c.argv)||!c.argv.length||c.argv.some(v=>typeof v!=='string'||!v.length)))return {status:'UNKNOWN',reason:'Invalid checks',checks:[],startedAt};
 const checks=[];
 for(const c of contract.checks){
  const timeoutMs=Math.min(120000,Math.max(100,Number.isFinite(c.timeoutMs)?c.timeoutMs:30000));
  const result=await new Promise(done=>{
   let output='',errorOutput='',timedOut=false,completed=false,timer;
   const finish=(code,signal,error)=>{if(completed)return;completed=true;clearTimeout(timer);done({name:c.name??c.argv.join(' '),argv:c.argv,exitCode:code,signal,timedOut,error:error?.message??null,stdout:output,stderr:errorOutput,passed:!error&&!timedOut&&code===0})};
   try{
    const child=spawn(c.argv[0],c.argv.slice(1),{cwd,env:process.env,shell:false,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>output=(output+d).slice(-16000));
    child.stderr.on('data',d=>errorOutput=(errorOutput+d).slice(-16000));
    child.on('error',e=>finish(null,null,e));child.on('close',(code,signal)=>finish(code,signal,null));
    timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),500).unref()},timeoutMs);
   }catch(e){finish(null,null,e)}
  });checks.push(result);
 }
 return {schemaVersion:1,id:randomUUID(),status:checks.some(c=>c.error||c.timedOut)?'UNKNOWN':checks.some(c=>!c.passed)?'FAILED':'VERIFIED',checks,startedAt,finishedAt:new Date().toISOString()};
}
export async function main(args=process.argv.slice(2)){
 const opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:null};
 if(args[0]!=='verify'||!opt('--contract')){console.error('Usage: agentgate verify --contract .agentgate.json [--evidence evidence/latest.json] [--claude-hook]');process.exitCode=2;return}
 const report=await check(opt('--contract'));
 let evidenceError=null;
 if(opt('--evidence'))try{const out=resolve(opt('--evidence'));await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n')}catch(e){evidenceError=e.message}
 const status=evidenceError?'UNKNOWN':report.status;
 if(args.includes('--claude-hook')){console.log(JSON.stringify(status==='VERIFIED'?{}:{decision:'block',reason:'AgentGate '+status+': verification did not pass'+(evidenceError?' (evidence write failed)':'')}));process.exitCode=0}
 else{console.log(JSON.stringify({...report,status,evidenceError},null,2));process.exitCode=status==='VERIFIED'?0:status==='FAILED'?1:2}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(new URL(import.meta.url).pathname))await main();
