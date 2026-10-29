// Portable evidence verifier: copied with release controls, no source-tree dependencies.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const OPERATING_SYSTEMS = ['darwin', 'linux', 'win32'];
const CHECKS = ['installed-shim-version', 'installed-shim-help', 'installed-skill', 'product-boundary', 'native-version-source', 'public-skill-installer', 'cold-host-download', 'hot-cache-reuse', 'standalone-skill-runtime', 'public-skill-runtime'];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
function candidateIdentity(file) {
 const value = JSON.parse(fs.readFileSync(file, 'utf8'));
 const variant = value.variant;
 const scope = variant === 'fnos' ? 'fnnas-labs' : variant === 'fygo' ? 'fygonas-labs' : null;
 if (!scope || value.schema !== 1 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version || '')
  || value.packageName !== `@${scope}/${variant}-cli` || value.commandName !== `${variant}-cli` || value.skillName !== `${variant}-cli`
  || value.locale !== (variant === 'fnos' ? 'zh-CN' : 'en') || value.repository !== `${scope}/${variant}-cli-skill`
  || !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') || !hash(value.sourceSha256)
  || !['tagged', 'development'].includes(value.mode) || (value.mode === 'tagged' ? value.sourceTag !== `v${value.version}` : value.sourceTag !== null)) throw new Error('Invalid candidate product/source identity');
 const names = [`${scope}-${variant}-cli-${value.version}.tgz`, `${variant}-skill.zip`, ...["darwin-arm64","darwin-x64","linux-arm64","linux-x64","windows-arm64","windows-x64"].map(platform=>`${variant}-cli-${value.version}-${platform}.gz`)];
 if (!Array.isArray(value.assets) || value.assets.length !== names.length || value.assets.some((asset, index) => asset.name !== names[index] || !hash(asset.sha256))) throw new Error('Invalid candidate asset identity');
 return {sha256: digest(file), variant, packageName: value.packageName, commandName: value.commandName, skillName: value.skillName, locale: value.locale, repository: value.repository, version: value.version, sourceCommit: value.sourceCommit, sourceSha256: value.sourceSha256, mode: value.mode, sourceTag: value.sourceTag, assets: value.assets.map(({name,sha256}) => ({name,sha256}))};
}
function inspectReports(candidateFile, reportFiles, {requireCI = true} = {}) {
 const candidate = candidateIdentity(candidateFile);
 if (!Array.isArray(reportFiles) || reportFiles.length !== 3) throw new Error('Require exactly three OS smoke receipts');
 const names = reportFiles.map(file => path.basename(file));
 if (new Set(names).size !== 3) throw new Error('Duplicate receipt filenames');
 const reports = reportFiles.map(file => {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (report.schema !== 1 || report.kind !== 'installed-cli-smoke' || report.result !== 'PASS'
   || !nonempty(report.checkedAt) || !Number.isFinite(Date.parse(report.checkedAt))
   || JSON.stringify(report.candidate) !== JSON.stringify(candidate)) throw new Error('Smoke receipt belongs to a failed or different candidate');
  const env = report.environment;
  if (path.basename(file) !== `${env?.platform}.json` || !OPERATING_SYSTEMS.includes(env?.platform) || !['arm64','x64'].includes(env.arch) || !nonempty(env.machine)
   || !/^v24\./.test(env.node || '') || !/^11\./.test(env.npm || '')) throw new Error('Invalid smoke receipt environment');
  if (!Array.isArray(report.checks) || CHECKS.some(check => !report.checks.includes(check))) throw new Error('Missing installed CLI smoke checks');
  if (requireCI && (!['pipelineId','jobId','runnerId'].every(key => nonempty(report.ci?.[key])) || report.ci.commit !== candidate.sourceCommit)) throw new Error('Smoke receipt lacks CI source identity');
  return {file, report};
 });
 if (JSON.stringify(reports.map(({report}) => report.environment.platform).sort()) !== JSON.stringify(OPERATING_SYSTEMS)) throw new Error('Require distinct darwin/linux/win32 OS receipts');
 if (requireCI && (new Set(reports.map(({report}) => report.ci.pipelineId)).size !== 1 || new Set(reports.map(({report}) => report.ci.jobId)).size !== 3)) throw new Error('Smoke receipts must have one pipeline and three jobs');
 return {candidate, reports};
}
function reportEntries(reports) {
 return reports.map(({file,report}) => ({name:path.basename(file),sha256:digest(file),platform:report.environment.platform,arch:report.environment.arch})).sort((a,b)=>a.platform.localeCompare(b.platform));
}
function createGate(candidateFile, reportFiles, gateFile, options) {
 const {candidate, reports} = inspectReports(candidateFile, reportFiles, options);
 const gate = {schema:1, kind:'three-os-installed-cli', result:'PASS', variant:candidate.variant, candidate,
  reports:reportEntries(reports)};
 fs.mkdirSync(path.dirname(gateFile), {recursive:true});
 fs.writeFileSync(gateFile, JSON.stringify(gate,null,2)+'\n');
 return gate;
}
function verifyGate(candidateFile, gateFile, reportFiles, options) {
 const {candidate, reports} = inspectReports(candidateFile, reportFiles, options);
 const gate = JSON.parse(fs.readFileSync(gateFile,'utf8'));
 const entries = reportEntries(reports);
 if (gate.schema !== 1 || gate.kind !== 'three-os-installed-cli' || gate.result !== 'PASS' || gate.variant !== candidate.variant
  || JSON.stringify(gate.candidate) !== JSON.stringify(candidate) || JSON.stringify(gate.reports) !== JSON.stringify(entries)) throw new Error('Smoke gate candidate/report hash mismatch');
 return gate;
}
module.exports = {candidateIdentity, createGate, verifyGate, CHECKS, digest};
