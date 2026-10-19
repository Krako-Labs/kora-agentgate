#!/usr/bin/env node
// Experimental macOS launcher. This is a scoped write-boundary demonstration,
// not a general-purpose security sandbox or protection from network-based escapes.
import {spawn} from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync,
  statSync, writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {join, relative, isAbsolute, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const GATE = fileURLToPath(new URL('./agentgate.mjs',import.meta.url));

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
  const valued=['--workspace','--contract','--claude','--prompt','--max-turns','--budget','--model'];
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
  return {workspace,contract,claude:getFlag(argv,'--claude'),prompt,maxTurns,budget,model:getFlag(argv,'--model'),dryRun:argv.includes('--dry-run')};
}
function profile(workspace,scratch) {
  return ['(version 1)','(deny default)','(allow process*)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)','(allow mach-host*)','(allow mach-lookup)',
    '(allow iokit-open)','(allow ipc-posix-sem)','(allow file-ioctl)',
    '(allow pseudo-tty)','(allow file-read*)','(allow network*)',
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
  const evidence=join(workspace,'.agentgate','evidence','latest.json');
  const command=[process.execPath,GATE,'verify','--contract',contract,'--evidence',evidence,'--claude-hook'].map(quoteShell).join(' ');
  writeFileSync(settings,JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command}]}]}},null,2)+'\n',{mode:0o600});
  writeFileSync(sandboxProfile,profile(workspace,scratch),{mode:0o600});
  const args=[
    '-p',options.prompt,
    '--settings',settings,
    '--setting-sources','user',
    '--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
    '--no-chrome','--no-session-persistence',
    '--permission-mode','dontAsk',
    '--max-turns',String(options.maxTurns),
    '--max-budget-usd',String(options.budget),
    '--allowedTools','Bash,Edit,Read',
  ];
  if(options.model)args.push('--model',options.model);
  return {root,workspace,contract,claude,settings,sandboxProfile,evidence,scratch,args};
}
export async function execute(config, {dryRun=false}={}) {
  if (dryRun) {
    console.log(JSON.stringify({mode:'dry-run',workspace:config.workspace,contract:config.contract,
      contractOutsideWorkspace:true, trustedHookOutsideWorkspace:true,
      sandboxProfileOutsideWorkspace:true, launcherOutsideWorkspace:true,
      notice:'Prototype: permissions and local service/network escapes are not fully hardened'},null,2));
    return 0;
  }
  const env={...process.env,TMPDIR:config.scratch+'/'};
  // Avoid exporting unrelated service credentials into a model-controlled Bash process.
  for(const key of Object.keys(env)) {
    if (/(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(key)) delete env[key];
  }
  return await new Promise(done=>{
    const child=spawn('/usr/bin/sandbox-exec',['-f',config.sandboxProfile,config.claude,...config.args],{
      cwd:config.workspace,env,stdio:['ignore','inherit','inherit'],
    });
    child.on('error',e=>{console.error(e.message);done(2);});
    child.on('exit',(code,signal)=>done(code??(signal?1:2)));
  });
}
export async function main(argv=process.argv.slice(2)) {
  const help='Usage: agentgate-protected --workspace /ABS/APP --contract /ABS/TRUSTED/contract.json --prompt "Task" [--dry-run] [--claude PATH] [--max-turns 3] [--budget 0.50]\n' +
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
