import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = path.join(projectRoot, 'app.json');
const packageJsonPath = path.join(projectRoot, 'package.json');
const releaseType = process.argv[2] ?? 'patch';

if (!['patch', 'minor', 'major'].includes(releaseType)) {
  throw new Error('Version type must be patch, minor, or major.');
}

const appJson = JSON.parse(await readFile(appJsonPath, 'utf8'));
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const currentVersion = String(appJson.expo.version);
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);

if (!match) {
  throw new Error(`Current app version is not semantic: ${currentVersion}`);
}

let [, major, minor, patch] = match.map(Number);
if (releaseType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (releaseType === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;
const currentVersionCode = Number(appJson.expo.android.versionCode);
if (!Number.isInteger(currentVersionCode) || currentVersionCode < 1) {
  throw new Error('expo.android.versionCode must be a positive integer.');
}

appJson.expo.version = nextVersion;
appJson.expo.android.versionCode = currentVersionCode + 1;
packageJson.version = nextVersion;

await Promise.all([
  writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`),
  writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`),
]);

console.log(`Infra Dialer ${currentVersion} (${currentVersionCode}) -> ${nextVersion} (${currentVersionCode + 1})`);