import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignoredDirectories = new Set([".git", "node_modules", ".wrangler", "private", "local-only"]);
const ignoredFiles = new Set([".env.local", ".env.cloudflare", ".dev.vars"]);
const localCredentialFiles = [
  { file: ".env.local", key: "EVM_PRIVATE_KEY", kind: "buyer_private_key" },
  { file: ".env.cloudflare", key: "CLOUDFLARE_API_TOKEN", kind: "cloudflare_api_token" },
];
const comparisons = [];

function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find(value => value.startsWith(`${key}=`));
  if (!line) return undefined;
  let value = line.slice(key.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value || undefined;
}

for (const item of localCredentialFiles) {
  const value = envValue(item.file, item.key);
  if (value && value.length >= 16) comparisons.push({ kind: item.kind, value });
}
if (existsSync("private/seller-key.txt")) {
  const value = readFileSync("private/seller-key.txt", "utf8").trim();
  if (value.length >= 16) comparisons.push({ kind: "seller_private_key", value });
}
const accountId = envValue(".env.cloudflare", "CLOUDFLARE_ACCOUNT_ID");
if (accountId) comparisons.push({ kind: "cloudflare_account_id", value: accountId });
const rawDeployment = "local-only/evidence/raw-private/deployment-review-2026-10-22.json";
if (existsSync(rawDeployment)) {
  try {
    const email = JSON.parse(readFileSync(rawDeployment, "utf8")).version?.metadata?.author_email;
    if (email) comparisons.push({ kind: "author_email", value: email });
  } catch {}
}

const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name) || ignoredFiles.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.isFile()) files.push(full);
  }
}
collect(root);

const matchingFiles = [];
for (const file of files) {
  const publicName = relative(root, file).replaceAll("\\", "/");
  let bytes;
  try { bytes = readFileSync(file); } catch { continue; }
  const matchedKinds = comparisons.filter(item => bytes.includes(Buffer.from(item.value))).map(item => item.kind);
  if (/[A-Za-z]:\\\\Users\\\\|[A-Za-z]:\\\\X402\\\\/i.test(bytes.toString("utf8"))) matchedKinds.push("absolute_local_path");
  if (matchedKinds.length) matchingFiles.push({ file: publicName, kinds: [...new Set(matchedKinds)] });
}

const result = {
  checkedAt: new Date().toISOString(),
  filesScanned: files.length,
  localComparisonsLoaded: comparisons.length,
  comparisonKinds: comparisons.map(item => item.kind).sort(),
  missingOptionalLocalComparisons: [
    ...localCredentialFiles.filter(item => !envValue(item.file, item.key)).map(item => item.kind),
    ...(existsSync("private/seller-key.txt") ? [] : ["seller_private_key"]),
    ...(accountId ? [] : ["cloudflare_account_id"]),
    ...(existsSync(rawDeployment) ? [] : ["author_email"]),
  ],
  matchingFiles,
  passed: matchingFiles.length === 0,
};
const outIndex = process.argv.indexOf("--out");
if (outIndex >= 0 && process.argv[outIndex + 1]) writeFileSync(resolve(root, process.argv[outIndex + 1]), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
