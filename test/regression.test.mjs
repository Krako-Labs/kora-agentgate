import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../agentgate.mjs',import.meta.url).pathname;
const dir=mkdtempSync(join(tmpdir(),'agentgate-regression-'));
test('descendant holding stdout cannot extend timeout',()=>{
 const contract=join(dir,'descendant.json');writeFileSync(contract,JSON.stringify({checks:[{name:'descendant',argv:['bash','-c','(sleep 5 &) ; echo done'],timeoutMs:1000}]}));
 const start=Date.now();
 const r=spawnSync(process.execPath,[cli,'verify','--contract',contract],{timeout:4000,encoding:'utf8'});
 assert.ok(Date.now()-start<3500,'gate waited on inherited pipe');
 assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).status,'VERIFIED');
});
test('evidence write errors fail closed',()=>{
 const contract=join(dir,'pass.json');writeFileSync(contract,JSON.stringify({checks:[{argv:[process.execPath,'-e','process.exit(0)']}]}));
 const r=spawnSync(process.execPath,[cli,'verify','--contract',contract,'--evidence',join(dir,'missing','evidence.json')],{timeout:5000,encoding:'utf8'});
 assert.equal(r.status,0);assert.equal(JSON.parse(readFileSync(join(dir,'missing','evidence.json'),'utf8')).status,'VERIFIED');
 const bad=spawnSync(process.execPath,[cli,'verify','--contract',contract,'--evidence','/dev/null/fail.json'],{timeout:5000,encoding:'utf8'});
 assert.equal(bad.status,2);assert.equal(JSON.parse(bad.stdout).status,'UNKNOWN');
});
test('Linux /proc evidence write is bounded and UNKNOWN', {skip:process.platform!=='linux'},()=>{
 const contract=join(dir,'linux-pass.json');writeFileSync(contract,JSON.stringify({checks:[{argv:[process.execPath,'-e','process.exit(0)']}]}));
 const start=Date.now();
 const r=spawnSync(process.execPath,[cli,'verify','--contract',contract,'--evidence','/proc/nope/ev.json'],{timeout:7000,encoding:'utf8'});
 assert.ok(Date.now()-start<6000,'evidence writer hung');
 assert.equal(r.status,2);
 assert.equal(JSON.parse(r.stdout).status,'UNKNOWN');
});
