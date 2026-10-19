#!/usr/bin/env node
// Experimental macOS launcher. This is a scoped write-boundary demonstration,
// not a general-purpose security sandbox or protection from network-based escapes.
import {spawn} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync,
  statSync, writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {join, relative, isAbsolute, delimiter, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const GATE = fileURLToPath(new URL('./agentgate.mjs',import.meta.url));
const POSTFLIGHT_TIMEOUT_MS = 150000;
const POSTFLIGHT_STDOUT_LIMIT = 1024 * 1024;

function within(parent, path) {
  const r = relative(parent, path);
  return r === '' || (!r.startsWith('..' + '/') && r !== '..' && !isAbsolute(r));
}
function canonical(path) {
  if (!path || typeof path !== 'string') throw Error('Expected path');
  return realpathSync(path);
}
function protectedPosition(workspace, path, label) {
  if (within(workspace, path)) throw Error(label + ' must be outside the agent-writable workspace');
}
function schemeString(s) { return JSON.stringify(s); }
function quoteShell(s) { return "'" + s.replaceAll("'", "'\\''") + "'"; }
function getBinary(opt) {
  if (opt) return canonical(opt);
  const paths = [join(homedir(),'.local/bin/claude'), ...(process.env.PATH??'').split(delimiter).map(p=>join(p,'claude'))];
  const found = paths.find(p=>existsSync(p));
  if (!found) throw Error('Claude Code executable not found: provide --claude PATH');
  return canonical(found);
}
function getFlag(argv, flag) {
  const i=argv.indexOf(flag);
  if (i<0) return null;
  if (i===argv.length-1 || argv[i+1].startsWith('--')) throw Error('Missing value for '+flag);
  return argv[i+1];
}
function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return {help:true};
  const valued=['--workspace','--contract','--claude','--prompt','--max-turns','--budget','--model','--audit-dir'];
  const allowed=new Set([...valued,'--dry-run']);
  for (let i=0;i<argv.length;i++){
    if (!allowed.has(argv[i])) throw Error('Unsupported option: '+argv[i]);
    if (valued.includes(argv[i])) {if (i+1>=argv.length) throw Error('Missing value for '+argv[i]);i++;}
  }
  const workspace=getFlag(argv,'--workspace'),contract=getFlag(argv,'--contract');
  if (!workspace || !contract) throw Error('--workspace and --contract are required');
  const maxTurns=Number(getFlag(argv,'--max-turns')??3);
  const budget=Number(getFlag(argv,'--budget')??0.50);
  if (!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>20) throw Error('--max-turns must be 1..20');
  if (!Number.isFinite(budget)||budget<=0||budget>5) throw Error('--budget must be >0 and <=5 USD');
  const prompt=getFlag(argv,'--prompt');
  if (!prompt || prompt.length>12000) throw Error('--prompt required, up to 12000 characters');
  return {workspace,contract,claude:getFlag(argv,'--claude'),prompt,maxTurns,budget,model:getFlag(argv,'--model'),auditDir:getFlag(argv,'--audit-dir'),dryRun:argv.includes('--dry-run')};
}
function profile(workspace,scratch,auditDir) {
  return ['(version 1)','(deny default)','(allow process*)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)','(allow mach-host*)','(allow mach-lookup)',
    '(allow iokit-open)','(allow ipc-posix-sem)','(allow file-ioctl)',
    '(allow pseudo-tty)','(allow file-read*)','(deny file-read* (subpath '+schemeString(auditDir)+'))','(allow network*)',
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-write* (literal "/dev/zero"))',
    '(allow file-write* (subpath '+schemeString(workspace)+'))',
    '(allow file-write* (subpath '+schemeString(scratch)+'))',
  ].join('\n')+'\n';
}
export function prepare(options) {
  if (process.platform!=='darwin') throw Error('Experimental protected launcher requires macOS');
  if (!existsSync('/usr/bin/sandbox-exec')) throw Error('macOS sandbox-exec not found');
  const workspace=canonical(options.workspace),contract=canonical(options.contract);
  const claude=options.dryRun?null:getBinary(options.claude);
  if (!statSync(workspace).isDirectory()) throw Error('Workspace must be a directory');
  if (!statSync(contract).isFile()) throw Error('Contract must be a file');
  JSON.parse(readFileSync(contract,'utf8')); // fail immediately on invalid JSON
  protectedPosition(workspace,contract,'Authoritative contract');
  protectedPosition(workspace,canonical(SELF),'Launcher');
  protectedPosition(workspace,canonical(GATE),'AgentGate executable');
  if (claude) protectedPosition(workspace,claude,'Claude executable');

  const root=canonical(mkdtempSync('/private/tmp/agentgate-protected-'));
  const scratch=join(root,'scratch');mkdirSync(scratch,{mode:0o700});
  const settings=join(root,'trusted-settings.json');
  const sandboxProfile=join(root,'seatbelt.sb');
  const rawAudit=resolve(options.auditDir??join(homedir(),'.local','share','agentgate','evidence'));
  // A symlink or an uncreated path must not resolve into the writable workspace.
  let ancestor=rawAudit;
  while(!existsSync(ancestor)){
    if (ancestor === dirname(ancestor)) throw Error('Unable to resolve audit directory');
    ancestor=dirname(ancestor);
  }
  const prospective=resolve(realpathSync(ancestor),relative(ancestor,rawAudit));
  protectedPosition(workspace,prospective,'Audit directory');
  mkdirSync(rawAudit,{recursive:true,mode:0o700});
  const auditDir=canonical(rawAudit);
  protectedPosition(workspace,auditDir,'Audit directory');
  if ((statSync(auditDir).mode & 0o022)!==0) throw Error('Audit directory must not be group/other writable');
  const runId=randomUUID();
  const auditFile=join(auditDir,runId+'.json');
  const contractDigest=createHash('sha256').update(readFileSync(contract)).digest('hex');
  // The Hook makes a fast completion decision. It cannot write the protected audit log.
  const command=[process.execPath,GATE,'verify','--contract',contract,'--claude-hook'].map(quoteShell).join(' ');
  writeFileSync(settings,JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command}]}]}},null,2)+'\n',{mode:0o600});
  writeFileSync(sandboxProfile,profile(workspace,scratch,auditDir),{mode:0o600});
  const args=[
    '-p',options.prompt,
    '--settings',settings,
    '--setting-sources','user',
    '--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--no-chrome','--no-session-persistence',
    '--permission-mode','dontAsk',
    '--max-turns',String(options.maxTurns),
    '--max-budget-usd',String(options.budget),
    '--allowedTools','Bash,Read,Write,Edit,Glob,Grep',
  ];
  if(options.model)args.push('--model',options.model);
  return {root,workspace,contract,contractDigest,claude,settings,sandboxProfile,auditDir,auditFile,runId,scratch,args};
}
// This independent postflight runs under the SAME macOS write restrictions as the agent,
// but the parent captures its JSON over a pipe and writes the audit file itself.
// It deliberately executes declared checks again after Claude exits. Contracts should
// therefore use repeatable, side-effect-safe checks.
export async function runPostflight(config, env) {
  return await new Promise(done=>{
    let finished=false, timedOut=false, stdout='', errorText='', oversized=false, child, watchdog;
    const finish=(code,signal,error)=>{
      if(finished)return;
      finished=true;
      clearTimeout(watchdog);
      child?.stdout?.destroy();child?.stderr?.destroy();
      let report=null, status='UNKNOWN';
      let reason=error?.message??(timedOut?'Postflight verification timed out':null);
      if (!reason && !oversized) {
        try {
          report=JSON.parse(stdout);
          if(!['VERIFIED','FAILED','UNKNOWN'].includes(report.status))throw Error('Invalid verifier status');
          const expectedCode={VERIFIED:0,FAILED:1,UNKNOWN:2}[report.status];
          if (code!==expectedCode)throw Error('Verifier exit code disagrees with its status');
          status=report.status;
        }catch(e){reason='Invalid independent verification result: '+e.message;report=null;}
      } else if(oversized) reason='Verifier output exceeded size cap';
      done({status,report,reason,exitCode:code,signal,stderr:errorText.slice(-2048)});
    };
    try {
      child=spawn('/usr/bin/sandbox-exec',
        ['-f',config.sandboxProfile,process.execPath,GATE,'verify','--contract',config.contract],
        {cwd:config.workspace,env,stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',data=>{
        stdout+=data.toString();
        if(Buffer.byteLength(stdout)>POSTFLIGHT_STDOUT_LIMIT){oversized=true;child.kill('SIGKILL');}
      });
      child.stderr.on('data',data=>{errorText=(errorText+data.toString()).slice(-2048);});
      child.on('error',e=>finish(null,null,e));
      child.on('exit',(code,signal)=>setImmediate(()=>finish(code,signal,null)));
    }catch(e){finish(null,null,e);return;}
    watchdog=setTimeout(()=>{
      timedOut=true;
      try{child.kill('SIGKILL');}catch{}
      finish(null,'SIGKILL',new Error('Postflight verification timed out'));
    },POSTFLIGHT_TIMEOUT_MS);
  });
}
function checkContractDigest(config){
  try{
    return createHash('sha256').update(readFileSync(config.contract)).digest('hex')===config.contractDigest;
  }catch{return false;}
}
export async function execute(config, {dryRun=false}={}) {
  if (dryRun) {
    console.log(JSON.stringify({mode:'dry-run',workspace:config.workspace,contract:config.contract,
      contractOutsideWorkspace:true,auditOutsideWorkspace:true,auditDir:config.auditDir,
      trustedHookOutsideWorkspace:true,sandboxProfileOutsideWorkspace:true,launcherOutsideWorkspace:true,
      notice:'Experimental macOS write boundary; parent re-verifies checks and writes a per-run audit record'},null,2));
    return 0;
  }
  const env={...process.env,TMPDIR:config.scratch+'/'};
  // Remove credentials and common runtime-injection environment variables.
  for(const key of Object.keys(env)) {
    if (/(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(key) ||
        /^(NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|DYLD_.*|LD_.*)$/i.test(key)) delete env[key];
  }
  const model=await new Promise(done=>{
    let settled=false;
    const finish=(code,signal,error)=>{
      if(settled)return;settled=true;
      done({exitCode:code,signal,error:error?.message??null});
    };
    const child=spawn('/usr/bin/sandbox-exec',['-f',config.sandboxProfile,config.claude,...config.args],{
      cwd:config.workspace,env,stdio:['ignore','inherit','inherit'],
    });
    child.on('error',e=>finish(null,null,e));
    child.on('exit',(code,signal)=>finish(code,signal,null));
  });
  // The Hook output is not trusted as a durable audit record. The parent performs
  // a fresh, supervised verification even when the model exits unsuccessfully.
  let postflight;
  if(checkContractDigest(config)){
    postflight=await runPostflight(config,env);
  }else{
    postflight={status:'UNKNOWN',report:null,reason:'Authoritative contract changed during session',exitCode:null};
  }
  if (!checkContractDigest(config)) {
    postflight={status:'UNKNOWN',report:null,reason:'Authoritative contract changed during verification',exitCode:null};
  }
  const accepted=model.exitCode===0&&!model.error&&postflight.status==='VERIFIED';
  const audit={
    schemaVersion:1,type:'protected-postflight',runId:config.runId,
    recordedAt:new Date().toISOString(),workspace:config.workspace,
    contract:config.contract,contractSha256:config.contractDigest,
    modelExitCode:model.exitCode,modelSignal:model.signal,modelError:model.error,
    status:postflight.status,accepted,reason:postflight.reason,
    verificationExitCode:postflight.exitCode,verification:postflight.report,
  };
  try {
    writeFileSync(config.auditFile,JSON.stringify(audit,null,2)+'\n',{flag:'wx',mode:0o600});
    console.error('AgentGate trusted audit: '+config.auditFile+' (status='+audit.status+', accepted='+accepted+')');
  }catch(e){
    console.error('AgentGate: could not save protected audit record: '+e.message);
    return 2;
  }
  if(!accepted){
    console.error('AgentGate: completion not verified'+(audit.reason?' ('+audit.reason+')':''));
    return model.exitCode&&model.exitCode!==0?model.exitCode:2;
  }
  return 0;
}
export async function main(argv=process.argv.slice(2)) {
  const help='Usage: agentgate-protected --workspace /ABS/APP --contract /ABS/TRUSTED/contract.json --prompt "Task" [--dry-run] [--claude PATH] [--max-turns 3] [--budget 0.50] [--audit-dir /TRUSTED/DIR]\n' +
   'Experimental macOS launch only. Contract, CLI and launcher must be outside writable workspace. No general sandbox security guarantee.';
  if (argv.includes('--help') || argv.includes('-h')) {console.log(help);return 0;}
  let ctx;
  try {
    ctx=prepare(parseArgs(argv));
    return await execute(ctx,{dryRun:argv.includes('--dry-run')});
  } catch(e) {console.error('AgentGate protected launcher: '+e.message);return 2;}
  finally {if(ctx?.root) rmSync(ctx.root,{recursive:true,force:true});}
}
if (process.argv[1] && realpathSync(process.argv[1])===realpathSync(SELF)) process.exitCode=await main();
