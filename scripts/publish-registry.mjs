import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {encryptRegistry, decryptRegistry, pinKey} from '../registry-crypto.mjs';
import {validateRegistry} from '../people.mjs';

const {values} = parseArgs({options:{source:{type:'string'}, output:{type:'string'}, publish:{type:'boolean', default:false}}});
if (!values.source) throw new Error('Provide --source with the private registration JSON path.');
const pin = process.env.ARETE_REGISTRY_PIN;
if (!/^\d{4}$/.test(pin || '')) throw new Error('Set ARETE_REGISTRY_PIN to the configured four-digit access PIN.');
const registry = JSON.parse(await readFile(values.source, 'utf8'));
const invalid = validateRegistry(registry);
if (invalid) throw new Error(invalid);
const output = values.output || fileURLToPath(new URL('../registry.enc.json', import.meta.url));
let previous, remote, request;

if (values.publish) {
  const credential = execFileSync('git', ['credential', 'fill'], {input:'protocol=https\nhost=github.com\n\n', encoding:'utf8', windowsHide:true, env:{...process.env, GIT_TERMINAL_PROMPT:'0', GCM_INTERACTIVE:'never'}});
  const fields = Object.fromEntries(credential.trim().split(/\r?\n/).map(line => {const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  if (!fields.password) throw new Error('No GitHub credential is available to publish the shared registry.');
  const endpoint = 'https://api.github.com/repos/alaadriai/boxing-attendance-tracker/contents/registry.enc.json';
  request = async (options = {}) => {
    const response = await fetch(endpoint, {...options, headers:{Authorization:`Bearer ${fields.password}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json'}});
    if (response.status === 404 && !options.method) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(`Shared registry publishing failed (${response.status}): ${data.message || 'GitHub error'}`);
    return data;
  };
  remote = await request();
  if (remote) previous = JSON.parse(Buffer.from(remote.content.replace(/\s/g, ''), 'base64').toString('utf8'));
} else {
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

let salt;
if (previous) {
  // Keep the salt for ordinary archive updates, so an unlocked tab can refresh.
  const old = await decryptRegistry(previous, await pinKey(pin, previous));
  if (JSON.stringify({asOf:old.asOf, sources:old.sources}) === JSON.stringify({asOf:registry.asOf, sources:registry.sources})) {
    console.log('Shared registry unchanged; no duplicate publication.');
    process.exit(0);
  }
  salt = previous.salt;
}
const encrypted = await encryptRegistry(registry, pin, salt);
const content = JSON.stringify(encrypted, null, 2) + '\n';
if (values.publish) {
  const result = await request({method:'PUT', body:JSON.stringify({message:'Refresh shared registration archive', branch:'main', content:Buffer.from(content).toString('base64'), ...(remote ? {sha:remote.sha} : {})})});
  console.log(`Shared registry published: ${result.commit.sha}`);
} else {
  await writeFile(output, content, 'utf8');
  console.log(`Shared registry prepared: ${output}`);
}
console.log(`Archived snapshots: ${registry.sources.length}; name rows: ${registry.sources.reduce((n, s) => n + s.names.length, 0)}.`);
