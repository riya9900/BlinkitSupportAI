// Safety check: make sure no secret is about to be committed to Git.
// Run: npm run check:secrets   (also runs automatically before each commit, see .githooks/)
//
// It looks at every file Git would include (tracked files + new files that are not
// ignored) and fails if it finds:
//   1. any secret VALUE from your local .env (API key, database password, ...)
//   2. text shaped like a Google API key, a database URI with a real password, or a private key
//   3. a .env file that Git is NOT ignoring
// It never prints a secret value: only the file name and which kind of secret it found.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const ENV_FILE = process.env.ENV_FILE ?? '.env'; // overridable so the checker itself can be tested

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

let files: string[];
try {
  files = git('ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean);
} catch {
  console.error('FAILED: this folder is not a Git repository yet (run "git init" first).');
  process.exit(1);
}

const findings: string[] = [];

// --- 1. values from .env ---------------------------------------------------
const SECRET_KEY_NAMES = /KEY|URI|SALT|SECRET|TOKEN|PASSWORD/i; // settings that are secrets (not e.g. MONGODB_DB)
const secrets = new Map<string, string>(); // value -> label

if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith('#')) continue;
    const [, name, raw] = m;
    const value = raw.replace(/^["']|["']$/g, '');
    if (!SECRET_KEY_NAMES.test(name) || value.length < 8 || value.includes('<')) continue;
    secrets.set(value, name);
    // A connection string contains more secrets inside it: the password, user and host.
    const uri = /^mongodb(?:\+srv)?:\/\/([^:@/]+):([^@]+)@([^/?]+)/.exec(value);
    if (uri) {
      secrets.set(decodeURIComponent(uri[2]), `${name} (password part)`);
      secrets.set(uri[2], `${name} (password part)`);
      secrets.set(uri[1], `${name} (username part)`);
      secrets.set(uri[3], `${name} (cluster address)`);
    }
  }
}

// --- 2. things that look like secrets ----------------------------------------
const PATTERNS: [string, RegExp][] = [
  ['a Google API key', /AIza[0-9A-Za-z_-]{30,}/],
  ['a database URI containing a password', /mongodb(?:\+srv)?:\/\/[^<\s"'`:@/]+:[^<\s"'`@]+@/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

for (const file of files) {
  if (!existsSync(file)) continue; // deleted but not yet committed
  if (statSync(file).size > 2_000_000) continue; // skip big files (images etc.)
  const text = readFileSync(file);
  if (text.includes(0)) continue; // binary file
  const content = text.toString('utf8');

  for (const [value, label] of secrets) {
    if (content.includes(value)) findings.push(`${file}: contains your ${label} from ${ENV_FILE}`);
  }
  for (const [label, pattern] of PATTERNS) {
    if (pattern.test(content)) findings.push(`${file}: looks like it contains ${label}`);
  }
}

// --- 3. .env must be ignored ------------------------------------------------
for (const envName of ['.env', '.env.local', '.env.production']) {
  if (!existsSync(envName)) continue;
  try {
    git('check-ignore', '-q', '--', envName);
  } catch {
    findings.push(`${envName}: exists but Git is NOT ignoring it`);
  }
}
if (files.some((f) => /(^|\/)\.env(\.|$)/.test(f) && f !== '.env.example')) {
  findings.push('an .env file is in the list of files Git would commit');
}

if (findings.length > 0) {
  console.error('FAILED: possible secret exposure. Nothing was printed except file names.');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: checked ${files.length} files; no secrets found and .env is ignored.`);
