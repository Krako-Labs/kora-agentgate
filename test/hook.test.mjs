import {test} from 'node:test';import {strict as assert} from 'node:assert';import {spawnSync} from 'node:child_process';import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const cli=new URL('../agentgate.mjs',import.meta.url).pathname;
for(const [label,contract,decision] of [['fail','examples/fail.json','block'],['pass','examples/pass.json',undefined],['unknown','examples/missing.json','block']]){
 test('hook '+label,()=>{const cwd=new URL('../',import.meta.url).pathname;const tmp=mkdtempSync(join(tmpdir(),'agentgate-'));const out=join(tmp,'evidence.json');const r=spawnSync('node',[cli,'verify','--contract',contract,'--evidence',out,'--claude-hook'],{cwd,encoding:'utf8'});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).decision,decision);assert.equal(JSON.parse(readFileSync(out,'utf8')).status,label==='pass'?'VERIFIED':label==='fail'?'FAILED':'UNKNOWN')});
}
