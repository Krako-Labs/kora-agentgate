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
   let output='',errorOutput='',completed=false,child,timer;
   const finish=(code,signal,error,timedOut=false)=>{
    if(completed)return;completed=true;clearTimeout(timer);
    child?.stdout?.destroy();child?.stderr?.destroy();
    done({name:c.name??c.argv.join(' '),argv:c.argv,exitCode:code,signal,timedOut,error:error?.message??null,stdout:output,stderr:errorOutput,passed:!error&&!timedOut&&code===0});
   };
   try{
    child=spawn(c.argv[0],c.argv.slice(1),{cwd,env:process.env,shell:false,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>output=(output+d).slice(-16000));
    child.stderr.on('data',d=>errorOutput=(errorOutput+d).slice(-16000));
    child.on('error',e=>finish(null,null,e));
    // 'exit' is not delayed by descendants inheriting the stdout pipe.
    child.on('exit',(code,signal)=>finish(code,signal,null));
    timer=setTimeout(()=>{
     const code=child.exitCode,signal=child.signalCode;
     try{if(code===null && signal===null)child.kill('SIGTERM')}catch{}
     finish(code,signal,null,true);
    },timeoutMs);
   }catch(e){finish(null,null,e)}
  });checks.push(result);
 }
 return {schemaVersion:1,id:randomUUID(),status:checks.some(c=>c.error||c.timedOut)?'UNKNOWN':checks.some(c=>!c.passed)?'FAILED':'VERIFIED',checks,startedAt,finishedAt:new Date().toISOString()};
}
async function writeEvidenceBounded(file,report,timeoutMs=3000){
 const out=resolve(file);
 return await new Promise(done=>{
  let settled=false;
  const child=spawn(process.execPath,[new URL(import.meta.url).pathname,'--evidence-worker',out],{stdio:['pipe','ignore','ignore']});
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin?.destroy();done(error)};
  const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{};finish('Evidence write timed out')},timeoutMs);
  child.on('error',e=>finish(e.message));
  child.on('exit',(code,signal)=>finish(code===0?null:'Evidence writer failed ('+(signal??code)+')'));
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(report));
 });
}
async function evidenceWorker(out){
 try{
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,Buffer.concat(chunks).toString('utf8')+'\n');
 }catch(e){console.error(e);process.exitCode=1}
}
export async function main(args=process.argv.slice(2)){
 const opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:null};
 if(args[0]!=='verify'||!opt('--contract')){console.error('Usage: agentgate verify --contract .agentgate.json [--evidence evidence/latest.json] [--claude-hook]');process.exitCode=2;return}
 const report=await check(opt('--contract'));
 let evidenceError=null;
 if(opt('--evidence'))evidenceError=await writeEvidenceBounded(opt('--evidence'),report)
 const status=evidenceError?'UNKNOWN':report.status;
 if(args.includes('--claude-hook')){console.log(JSON.stringify(status==='VERIFIED'?{}:{decision:'block',reason:'AgentGate '+status+': verification did not pass'+(evidenceError?' (evidence write failed)':'')}));process.exitCode=0}
 else{console.log(JSON.stringify({...report,status,evidenceError},null,2));process.exitCode=status==='VERIFIED'?0:status==='FAILED'?1:2}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(new URL(import.meta.url).pathname)){if(process.argv[2]==='--evidence-worker')await evidenceWorker(process.argv[3]);else await main();}
