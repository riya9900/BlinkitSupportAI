// Approximates what a Vercel deployment does with the /api folder: bundle each
// file for Node. It catches broken imports and handlers that export nothing,
// WITHOUT needing a Vercel account. It is not a substitute for a real deployment.
// Run: npm run check:api
import { readdirSync } from 'node:fs';
import { build } from 'esbuild';

const entries = readdirSync('api')
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `api/${f}`);

let failed = false;
const fail = (msg: string) => {
  console.error('FAILED:', msg);
  failed = true;
};

try {
  const result = await build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external', // npm packages are installed by Vercel, not bundled
    write: false,
    outdir: 'out',
    metafile: true,
    logLevel: 'silent',
  });

  for (const file of result.outputFiles) {
    const name = file.path.split(/[\\/]/).pop();
    if (!/export\s*\{[^}]*\b(GET|POST)\b/.test(file.text)) fail(`${name} exports no GET/POST handler`);
  }
  for (const [output, info] of Object.entries(result.metafile.outputs)) {
    for (const input of Object.keys(info.inputs)) {
      if (input.startsWith('src/') || input.includes('devApiPlugin') || input.startsWith('tests/')) {
        fail(`${output} pulls in ${input}, which must not be part of a serverless function`);
      }
    }
  }
  if (!failed) console.log(`OK: all ${entries.length} serverless functions bundle cleanly and export a handler.`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (failed) process.exitCode = 1;
