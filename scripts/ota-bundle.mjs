// The new version for the store apps, over the air: zips the production build
// and writes the manifest the apps read (src/app/services/ota.service.ts), both
// into <build>/ota/, so they deploy with the web app at /ota/. Every deploy
// publishes the bundle, but it only reaches the apps when the version in
// package.json goes up. Run after `ng build` (see the build:web script).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'dist/bible-audio2/browser');
const out = join(build, 'ota');

const fail = message => { console.error(message); process.exit(1); };

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const level = /^export const NATIVE_LEVEL = (\d+);$/m.exec(
  readFileSync(join(root, 'src/app/services/ota.service.ts'), 'utf8'),
)?.[1];
if (!level) fail('NATIVE_LEVEL not found in src/app/services/ota.service.ts');
if (!existsSync(join(build, 'index.html'))) fail(`${build}/index.html does not exist: run ng build first`);

// What each store has already published; by hand, after the store release is live.
const store = JSON.parse(readFileSync(join(root, 'ota-store.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });

// Every file of the build, with index.html at the root of the zip. Hidden
// files stay out: the plugin refuses a zip that has one.
const zip = new AdmZip();
const add = (dir, prefix) => {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) add(path, `${prefix}${name}/`);
    else zip.addFile(`${prefix}${name}`, readFileSync(path));
  }
};
add(build, '');

const data = zip.toBuffer();
const checksum = createHash('sha256').update(data).digest('hex');

mkdirSync(out);
writeFileSync(join(out, `${version}.zip`), data);
writeFileSync(
  join(out, 'manifest.json'),
  JSON.stringify({ version, native_level: Number(level), url: `${version}.zip`, checksum, store }) + '\n',
);
console.log(`ota/${version}.zip (${(data.length / 1048576).toFixed(1)} MB), native level ${level}`);
