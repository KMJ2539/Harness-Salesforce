#!/usr/bin/env node
// harness-sf installer — copies agents and skills into a target .claude/ directory.
// Zero runtime deps. Node >= 18.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(PKG_ROOT, 'templates');
const PKG_VERSION = (() => {
  try { return require(path.join(PKG_ROOT, 'package.json')).version; }
  catch { return '0.0.0'; }
})();
const MANIFEST_NAME = '.harness-sf-manifest.json';

const args = process.argv.slice(2);
const cmd = args[0];

const flags = {
  global: args.includes('--global') || args.includes('-g'),
  force: args.includes('--force') || args.includes('-f'),
  skipExisting: args.includes('--skip-existing'),
  dryRun: args.includes('--dry-run'),
  agentsOnly: args.includes('--agents-only'),
  skillsOnly: args.includes('--skills-only'),
  knowledgeOnly: args.includes('--knowledge-only'),
  hooksOnly: args.includes('--hooks-only'),
};

function help() {
  console.log(`
harness-sf — Salesforce harness for Claude Code

USAGE
  npx harness-sf <command> [options]

COMMANDS
  init               Install agents and skills into ./.claude/ (project)
  init --global      Install into ~/.claude/ (user-wide)
  update             Upgrade an existing install using manifest-based diff
  list               Show available agents and skills
  help               Show this message

OPTIONS
  --global, -g       Target user-wide ~/.claude/ instead of project ./.claude/
  --force, -f        Overwrite existing files without prompting
  --skip-existing    Skip files that already exist (no prompt)
  --dry-run          Show what would be installed; make no changes
  --agents-only      Install only the agents
  --skills-only      Install only the skills
  --knowledge-only   Install only the knowledge reference files
  --hooks-only       Install only the hooks (and settings.json merge)

EXAMPLES
  cd my-sf-project && npx harness-sf init
  npx harness-sf init --global
  npx harness-sf init --dry-run
  npx harness-sf update
  npx harness-sf update --dry-run
  npx harness-sf list
`);
}

function listContents() {
  const agents = listMd(path.join(TEMPLATES_DIR, 'agents'));
  const skills = listSkillDirs(path.join(TEMPLATES_DIR, 'skills'));
  const knowledge = listMd(path.join(TEMPLATES_DIR, 'knowledge'));
  const hooks = listJs(path.join(TEMPLATES_DIR, 'hooks'));
  console.log(`\nAgents (${agents.length}):`);
  agents.forEach(f => console.log(`  - ${f.replace(/\.md$/, '')}`));
  console.log(`\nSkills (${skills.length}):`);
  skills.forEach(name => console.log(`  - /${name}`));
  console.log(`\nKnowledge (${knowledge.length}):`);
  knowledge.forEach(f => console.log(`  - ${f.replace(/\.md$/, '')}`));
  console.log(`\nHooks (${hooks.length}):`);
  hooks.forEach(f => console.log(`  - ${f}`));
  console.log('');
}

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
}

function listJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
}

// Skills are directory-format: <skill-name>/SKILL.md (Claude Code requirement).
function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map(e => e.name)
    .sort();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

async function copyFile(src, dest) {
  const exists = fs.existsSync(dest);
  if (exists && flags.skipExisting) {
    return { status: 'skipped', reason: 'exists' };
  }
  if (exists && !flags.force) {
    const ans = await ask(`  exists: ${path.basename(dest)} — overwrite? [y/N/a=all/s=skip-all] `);
    if (ans === 'a') flags.force = true;
    else if (ans === 's') { flags.skipExisting = true; return { status: 'skipped', reason: 'user' }; }
    else if (ans !== 'y') return { status: 'skipped', reason: 'user' };
  }
  if (flags.dryRun) return { status: 'would-write' };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { status: exists ? 'overwritten' : 'created' };
}

async function installCategory(category, targetRoot) {
  const srcDir = path.join(TEMPLATES_DIR, category);
  const destDir = path.join(targetRoot, category);
  const tally = { created: 0, overwritten: 0, skipped: 0, 'would-write': 0 };

  if (category === 'agents') {
    // Agents: flat .md files.
    const files = listMd(srcDir);
    if (!files.length) return tally;
    console.log(`\n  ${category}/  (${files.length} files)`);
    for (const f of files) {
      const res = await copyFile(path.join(srcDir, f), path.join(destDir, f));
      tally[res.status] = (tally[res.status] || 0) + 1;
      logEntry(res.status, f);
    }
    return tally;
  }

  if (category === 'skills') {
    // Skills: <name>/SKILL.md directories (Claude Code requirement).
    const skills = listSkillDirs(srcDir);
    if (!skills.length) return tally;
    console.log(`\n  ${category}/  (${skills.length} skills, directory format)`);
    for (const name of skills) {
      const res = await copyFile(path.join(srcDir, name, 'SKILL.md'), path.join(destDir, name, 'SKILL.md'));
      tally[res.status] = (tally[res.status] || 0) + 1;
      logEntry(res.status, `${name}/SKILL.md`);
    }
    return tally;
  }

  if (category === 'knowledge') {
    // Knowledge: flat .md reference files. Agents Read these on demand.
    const files = listMd(srcDir);
    if (!files.length) return tally;
    console.log(`\n  ${category}/  (${files.length} files)`);
    for (const f of files) {
      const res = await copyFile(path.join(srcDir, f), path.join(destDir, f));
      tally[res.status] = (tally[res.status] || 0) + 1;
      logEntry(res.status, f);
    }
    return tally;
  }

  if (category === 'hooks') {
    // Hooks: flat .js scripts at top level + _lib/ subdirectory of shared utilities.
    const files = listJs(srcDir);
    const libDir = path.join(srcDir, '_lib');
    const libFiles = listJs(libDir);
    if (!files.length && !libFiles.length) return tally;
    console.log(`\n  ${category}/  (${files.length} hooks + ${libFiles.length} _lib files)`);
    for (const f of files) {
      const dest = path.join(destDir, f);
      const res = await copyFile(path.join(srcDir, f), dest);
      tally[res.status] = (tally[res.status] || 0) + 1;
      logEntry(res.status, f);
      if (!flags.dryRun && (res.status === 'created' || res.status === 'overwritten') && process.platform !== 'win32') {
        try { fs.chmodSync(dest, 0o755); } catch {}
      }
    }
    for (const f of libFiles) {
      const dest = path.join(destDir, '_lib', f);
      const res = await copyFile(path.join(libDir, f), dest);
      tally[res.status] = (tally[res.status] || 0) + 1;
      logEntry(res.status, `_lib/${f}`);
      if (!flags.dryRun && (res.status === 'created' || res.status === 'overwritten') && process.platform !== 'win32') {
        try { fs.chmodSync(dest, 0o755); } catch {}
      }
    }
    return tally;
  }

  return tally;
}

function logEntry(status, label) {
  const symbol = { created: '+', overwritten: '~', skipped: '-', 'would-write': '?' }[status] || ' ';
  console.log(`    ${symbol} ${label}`);
}

// Project-local config layer: PROJECT.md (team) + local.md (personal, gitignored).
// Idempotent. Never modifies existing PROJECT.md/local.md content.
async function installProjectConfig(cwd) {
  const harnessDir = path.join(cwd, '.harness-sf');
  const stubsDir = path.join(PKG_ROOT, 'templates', '_stubs');
  const projectMd = path.join(harnessDir, 'PROJECT.md');
  const localExample = path.join(harnessDir, 'local.md.example');

  console.log(`\n  .harness-sf/  (project config layer)`);

  // 1. Create PROJECT.md stub if missing (never overwrite — user content lives here).
  if (fs.existsSync(projectMd)) {
    logEntry('skipped', 'PROJECT.md (exists, preserved)');
  } else if (flags.dryRun) {
    logEntry('would-write', 'PROJECT.md (team-shared config stub)');
  } else {
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.copyFileSync(path.join(stubsDir, 'PROJECT.md'), projectMd);
    logEntry('created', 'PROJECT.md (team-shared config stub)');
  }

  // 2. Drop local.md.example so user can `cp local.md.example local.md` to start.
  if (fs.existsSync(localExample)) {
    logEntry('skipped', 'local.md.example (exists)');
  } else if (flags.dryRun) {
    logEntry('would-write', 'local.md.example');
  } else {
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.copyFileSync(path.join(stubsDir, 'local.md.example'), localExample);
    logEntry('created', 'local.md.example');
  }

  // 3. .gitignore — append harness-sf entries if not present. Never create a new .gitignore.
  await ensureGitignoreEntries(cwd);
}

// Merge templates/_stubs/settings.json into <target>/.claude/settings.json.
// Safe-merge rules:
//   - permissions.allow: union of arrays (preserve order, append missing)
//   - hooks.<event>: append matcher entries that aren't already present (dedup by matcher+command)
//   - statusLine: only set if not already configured
// Project-local only (skipped under --global).
async function installSettings(targetRoot) {
  const stubPath = path.join(PKG_ROOT, 'templates', '_stubs', 'settings.json');
  if (!fs.existsSync(stubPath)) return;

  const destPath = path.join(targetRoot, 'settings.json');
  const stub = JSON.parse(fs.readFileSync(stubPath, 'utf8'));

  console.log(`\n  ${path.relative(process.cwd(), destPath) || destPath}`);

  if (!fs.existsSync(destPath)) {
    if (flags.dryRun) { logEntry('would-write', 'settings.json (new)'); return; }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, JSON.stringify(stub, null, 2) + '\n');
    logEntry('created', 'settings.json');
    return;
  }

  let current;
  try { current = JSON.parse(fs.readFileSync(destPath, 'utf8')); }
  catch (e) {
    console.log(`    ! settings.json exists but is not valid JSON — skipping merge (${e.message})`);
    return;
  }

  const before = JSON.stringify(current);
  const added = mergeSettings(current, stub);
  const changed = JSON.stringify(current) !== before;

  if (!changed) { logEntry('skipped', 'settings.json (already merged)'); return; }

  if (added.length) {
    console.log(`    settings.json merge:`);
    added.forEach(line => console.log(`      + ${line}`));
  }

  if (flags.dryRun) { logEntry('would-write', 'settings.json'); return; }

  fs.writeFileSync(destPath, JSON.stringify(current, null, 2) + '\n');
  logEntry('overwritten', 'settings.json (merged)');
}

// Mutates `current`. Returns array of human-readable additions for diff output.
function mergeSettings(current, stub) {
  const added = [];

  if (stub.permissions && Array.isArray(stub.permissions.allow)) {
    current.permissions = current.permissions || {};
    current.permissions.allow = current.permissions.allow || [];
    for (const entry of stub.permissions.allow) {
      if (!current.permissions.allow.includes(entry)) {
        current.permissions.allow.push(entry);
        added.push(`permissions.allow: ${entry}`);
      }
    }
  }

  if (stub.hooks && typeof stub.hooks === 'object') {
    current.hooks = current.hooks || {};
    for (const event of Object.keys(stub.hooks)) {
      const incoming = stub.hooks[event] || [];
      current.hooks[event] = current.hooks[event] || [];
      for (const block of incoming) {
        const matcher = block.matcher || '';
        const incomingCmds = (block.hooks || []).map(h => h.command).filter(Boolean);
        // find existing block with same matcher
        let target = current.hooks[event].find(b => (b.matcher || '') === matcher);
        if (!target) {
          target = { ...(matcher ? { matcher } : {}), hooks: [] };
          current.hooks[event].push(target);
        }
        target.hooks = target.hooks || [];
        const existingCmds = new Set(target.hooks.map(h => h.command));
        for (const cmd of incomingCmds) {
          if (!existingCmds.has(cmd)) {
            target.hooks.push({ type: 'command', command: cmd });
            added.push(`hooks.${event}${matcher ? `[${matcher}]` : ''}: ${cmd}`);
          }
        }
      }
    }
  }

  if (stub.statusLine && !current.statusLine) {
    current.statusLine = stub.statusLine;
    added.push(`statusLine: ${stub.statusLine.command}`);
  }

  return added;
}

async function ensureGitignoreEntries(cwd) {
  const giPath = path.join(cwd, '.gitignore');
  const wantedEntries = ['.harness-sf/local.md', '.harness-sf/reports/', '.harness-sf/.cache/'];

  if (!fs.existsSync(giPath)) {
    console.log(`    ! .gitignore not found in ${cwd}`);
    console.log(`      Add these lines manually (or to a parent .gitignore):`);
    wantedEntries.forEach(e => console.log(`        ${e}`));
    return;
  }

  const current = fs.readFileSync(giPath, 'utf8');

  // Heuristic warning: user is ignoring .harness-sf/ wholesale → designs/ won't be committed.
  const lines = current.split(/\r?\n/);
  const broadIgnore = lines.some(l => {
    const s = l.trim();
    return s === '.harness-sf' || s === '.harness-sf/' || s === '/.harness-sf' || s === '/.harness-sf/';
  });
  if (broadIgnore) {
    console.log(`    ! .gitignore contains a broad '.harness-sf/' rule`);
    console.log(`      → designs/ and PROJECT.md will not be committed. Verify intent.`);
  }

  const missing = wantedEntries.filter(e => !lines.some(l => l.trim() === e));
  if (!missing.length) {
    logEntry('skipped', '.gitignore (entries already present)');
    return;
  }

  // Always print the proposed change to stdout, even with --force.
  console.log(`    .gitignore append (${missing.length} line${missing.length > 1 ? 's' : ''}):`);
  missing.forEach(e => console.log(`      + ${e}`));

  if (flags.dryRun) {
    logEntry('would-write', '.gitignore');
    return;
  }

  const block = (current.endsWith('\n') ? '' : '\n') +
                '\n# harness-sf\n' + missing.join('\n') + '\n';
  fs.writeFileSync(giPath, current + block);
  logEntry('overwritten', '.gitignore (appended # harness-sf block)');
}

// ---------------------------------------------------------------------------
// Manifest layer — tracks per-file (sha256, templateSha256) so `update` can
// classify each file as unchanged / upstream-only / user-only / conflict.
// ---------------------------------------------------------------------------

function sha256OfFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Enumerate every (templateRelPath, destRelPath) pair the installer would copy.
// destRelPath is relative to the .claude/ root.
function enumerateTemplateFiles() {
  const out = [];
  for (const f of listMd(path.join(TEMPLATES_DIR, 'agents'))) {
    out.push({ src: path.join('agents', f), dest: path.join('agents', f) });
  }
  for (const name of listSkillDirs(path.join(TEMPLATES_DIR, 'skills'))) {
    out.push({
      src: path.join('skills', name, 'SKILL.md'),
      dest: path.join('skills', name, 'SKILL.md'),
    });
  }
  for (const f of listMd(path.join(TEMPLATES_DIR, 'knowledge'))) {
    out.push({ src: path.join('knowledge', f), dest: path.join('knowledge', f) });
  }
  for (const f of listJs(path.join(TEMPLATES_DIR, 'hooks'))) {
    out.push({ src: path.join('hooks', f), dest: path.join('hooks', f) });
  }
  for (const f of listJs(path.join(TEMPLATES_DIR, 'hooks', '_lib'))) {
    out.push({
      src: path.join('hooks', '_lib', f),
      dest: path.join('hooks', '_lib', f),
    });
  }
  return out;
}

function readManifest(targetRoot) {
  const p = path.join(targetRoot, MANIFEST_NAME);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function writeManifest(targetRoot, manifest) {
  if (flags.dryRun) return;
  const p = path.join(targetRoot, MANIFEST_NAME);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

// Build a fresh manifest reflecting whatever is currently on disk + in templates.
// Used after init() and after update() to record the new "post-op" state.
function buildManifest(targetRoot, opts = {}) {
  const now = new Date().toISOString();
  const prior = readManifest(targetRoot);
  const files = {};
  for (const { src, dest } of enumerateTemplateFiles()) {
    const tmplSha = sha256OfFile(path.join(TEMPLATES_DIR, src));
    const destSha = sha256OfFile(path.join(targetRoot, dest));
    if (!destSha) continue; // file not on disk (e.g. skipped by --*-only)
    files[dest.split(path.sep).join('/')] = {
      sha256: destSha,
      templateSha256: tmplSha,
      source: 'templates/' + src.split(path.sep).join('/'),
    };
  }
  return {
    version: PKG_VERSION,
    installedAt: prior && prior.installedAt ? prior.installedAt : now,
    updatedAt: now,
    files,
  };
}

// ---------------------------------------------------------------------------
// `update` — manifest-driven diff between installed .claude/ and current
// templates/. Four buckets per file:
//   unchanged       — user untouched, template untouched → no-op
//   upstream-only   — user untouched, template changed   → silent overwrite
//   user-only       — user modified, template untouched  → preserve
//   conflict        — user modified, template changed    → interactive prompt
// Plus deletions: in manifest, absent in templates/ → silent delete if
// user-untouched, preserve+warn if user-modified.
// ---------------------------------------------------------------------------

async function update() {
  if (flags.global) {
    console.error('ERROR: update is project-local only (--global is not supported).');
    process.exit(1);
  }
  const target = path.join(process.cwd(), '.claude');

  console.log(`\nharness-sf update`);
  console.log(`  source : ${TEMPLATES_DIR}`);
  console.log(`  target : ${target}${flags.dryRun ? '  (dry run)' : ''}`);

  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error(`\nERROR: templates directory missing at ${TEMPLATES_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(target)) {
    console.error(`\nERROR: ${target} does not exist. Run \`npx harness-sf init\` first.`);
    process.exit(1);
  }

  let manifest = readManifest(target);
  const legacy = !manifest;
  if (legacy) {
    console.log(`  ! no manifest found (legacy install) — assuming current files are unmodified`);
    manifest = buildLegacyManifest(target);
  }

  const buckets = { unchanged: [], upstreamOnly: [], userOnly: [], conflict: [], missingOnDisk: [] };
  const tmplFiles = enumerateTemplateFiles();
  const tmplDestSet = new Set(tmplFiles.map(f => f.dest.split(path.sep).join('/')));

  for (const { src, dest } of tmplFiles) {
    const destKey = dest.split(path.sep).join('/');
    const destPath = path.join(target, dest);
    const srcPath = path.join(TEMPLATES_DIR, src);
    const currentSha = sha256OfFile(destPath);
    const newTmplSha = sha256OfFile(srcPath);
    const recorded = manifest.files[destKey];

    if (!currentSha) {
      // Template exists but file missing on disk → treat as fresh add.
      buckets.missingOnDisk.push({ src, dest, srcPath, destPath, newTmplSha });
      continue;
    }

    const userModified = recorded ? currentSha !== recorded.sha256 : false;
    const upstreamChanged = recorded ? newTmplSha !== recorded.templateSha256 : currentSha !== newTmplSha;

    if (!userModified && !upstreamChanged) buckets.unchanged.push(destKey);
    else if (!userModified && upstreamChanged) buckets.upstreamOnly.push({ src, dest, srcPath, destPath, newTmplSha });
    else if (userModified && !upstreamChanged) buckets.userOnly.push(destKey);
    else buckets.conflict.push({ src, dest, srcPath, destPath, newTmplSha, recorded, currentSha });
  }

  // Deletions: manifest entries no longer in templates/.
  const deletions = [];
  for (const destKey of Object.keys(manifest.files)) {
    if (tmplDestSet.has(destKey)) continue;
    const destPath = path.join(target, destKey);
    if (!fs.existsSync(destPath)) continue;
    const currentSha = sha256OfFile(destPath);
    const recorded = manifest.files[destKey];
    const userModified = currentSha !== recorded.sha256;
    deletions.push({ destKey, destPath, userModified });
  }

  // Summary
  console.log(`\nSummary`);
  console.log(`  unchanged       : ${buckets.unchanged.length}`);
  console.log(`  upstream-only   : ${buckets.upstreamOnly.length}  (will overwrite)`);
  console.log(`  missing-on-disk : ${buckets.missingOnDisk.length}  (will create)`);
  console.log(`  user-only       : ${buckets.userOnly.length}  (preserved)`);
  console.log(`  conflicts       : ${buckets.conflict.length}  (will prompt)`);
  console.log(`  deletions       : ${deletions.length}  (${deletions.filter(d => !d.userModified).length} auto, ${deletions.filter(d => d.userModified).length} kept+warn)`);

  const tally = { created: 0, overwritten: 0, skipped: 0, deleted: 0, 'would-write': 0, 'would-delete': 0 };

  // 1. Silent overwrites (upstream-only).
  for (const item of buckets.upstreamOnly) {
    await applyOverwrite(item, tally, 'upstream');
  }

  // 2. Missing on disk → create.
  for (const item of buckets.missingOnDisk) {
    await applyOverwrite(item, tally, 'add');
  }

  // 3. Conflicts — interactive (default N = preserve user file).
  for (const item of buckets.conflict) {
    await applyConflict(item, tally);
  }

  // 4. Deletions.
  for (const d of deletions) {
    if (d.userModified) {
      console.log(`    ! kept  ${d.destKey}  (user-modified, deprecated upstream — review and remove manually)`);
      tally.skipped++;
      continue;
    }
    if (flags.dryRun) {
      console.log(`    ? delete ${d.destKey}`);
      tally['would-delete']++;
    } else {
      try { fs.unlinkSync(d.destPath); } catch {}
      console.log(`    x ${d.destKey}`);
      tally.deleted++;
    }
  }

  // 5. settings.json safe-merge — re-run, idempotent.
  await installSettings(target);

  // 6. Refresh manifest.
  if (!flags.dryRun) {
    const fresh = buildManifest(target);
    writeManifest(target, fresh);
  }

  console.log(`\nDone. created=${tally.created} overwritten=${tally.overwritten} deleted=${tally.deleted} skipped=${tally.skipped}` +
              (flags.dryRun ? ` would-write=${tally['would-write']} would-delete=${tally['would-delete']}` : ''));

  if (legacy && !flags.dryRun) {
    console.log(`\n  ✓ manifest written — future updates will track per-file changes precisely`);
  }

  console.log(`\nNext steps:`);
  console.log(`  - Restart Claude Code so it picks up the changes.\n`);
}

// Legacy migration: no manifest exists. Assume current disk files are
// unmodified relative to whatever templates were installed before. We record
// templateSha256 = currentSha so subsequent updates correctly detect both
// user edits (vs current) and upstream changes (vs new templates/).
function buildLegacyManifest(targetRoot) {
  const now = new Date().toISOString();
  const files = {};
  for (const { dest } of enumerateTemplateFiles()) {
    const destPath = path.join(targetRoot, dest);
    const sha = sha256OfFile(destPath);
    if (!sha) continue;
    const key = dest.split(path.sep).join('/');
    files[key] = { sha256: sha, templateSha256: sha, source: 'templates/' + dest.split(path.sep).join('/') };
  }
  return { version: 'legacy', installedAt: now, updatedAt: now, files };
}

async function applyOverwrite(item, tally, kind) {
  const rel = item.dest.split(path.sep).join('/');
  if (flags.dryRun) {
    logEntry('would-write', `${rel} (${kind})`);
    tally['would-write']++;
    return;
  }
  fs.mkdirSync(path.dirname(item.destPath), { recursive: true });
  fs.copyFileSync(item.srcPath, item.destPath);
  if (process.platform !== 'win32' && rel.startsWith('hooks/')) {
    try { fs.chmodSync(item.destPath, 0o755); } catch {}
  }
  const status = kind === 'add' ? 'created' : 'overwritten';
  tally[status]++;
  logEntry(status, `${rel} (${kind})`);
}

async function applyConflict(item, tally) {
  const rel = item.dest.split(path.sep).join('/');
  console.log(`\n  conflict: ${rel}`);
  console.log(`    user-modified locally AND upstream template changed.`);

  if (flags.force) {
    if (flags.dryRun) { logEntry('would-write', `${rel} (conflict→force)`); tally['would-write']++; return; }
    fs.copyFileSync(item.srcPath, item.destPath);
    tally.overwritten++;
    logEntry('overwritten', `${rel} (forced)`);
    return;
  }
  if (flags.skipExisting) {
    logEntry('skipped', `${rel} (skip-all)`);
    tally.skipped++;
    return;
  }

  const ans = await ask(`    overwrite? [y / N=keep / d=show diff / a=overwrite-all / s=skip-all]: `);
  if (ans === 'd') {
    showDiff(item.srcPath, item.destPath);
    return applyConflict(item, tally); // re-prompt
  }
  if (ans === 'a') {
    flags.force = true;
    return applyConflict(item, tally);
  }
  if (ans === 's') {
    flags.skipExisting = true;
    logEntry('skipped', `${rel} (skip-all)`);
    tally.skipped++;
    return;
  }
  if (ans === 'y') {
    if (flags.dryRun) { logEntry('would-write', `${rel} (conflict→y)`); tally['would-write']++; return; }
    fs.copyFileSync(item.srcPath, item.destPath);
    tally.overwritten++;
    logEntry('overwritten', rel);
    return;
  }
  // default: keep
  logEntry('skipped', `${rel} (kept user version)`);
  tally.skipped++;
}

// Minimal line-level diff for conflict review. Zero deps.
function showDiff(srcPath, destPath) {
  const a = fs.readFileSync(destPath, 'utf8').split(/\r?\n/);
  const b = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  console.log(`    --- current (yours)`);
  console.log(`    +++ upstream (new template)`);
  let shown = 0;
  for (let i = 0; i < max && shown < 60; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) { console.log(`    -${a[i]}`); shown++; }
    if (b[i] !== undefined) { console.log(`    +${b[i]}`); shown++; }
  }
  if (shown >= 60) console.log(`    ... (diff truncated at 60 lines)`);
}

async function init() {
  const target = flags.global
    ? path.join(os.homedir(), '.claude')
    : path.join(process.cwd(), '.claude');

  console.log(`\nharness-sf install`);
  console.log(`  source : ${TEMPLATES_DIR}`);
  console.log(`  target : ${target}${flags.dryRun ? '  (dry run)' : ''}`);

  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error(`\nERROR: templates directory missing at ${TEMPLATES_DIR}`);
    process.exit(1);
  }

  const totals = { created: 0, overwritten: 0, skipped: 0, 'would-write': 0 };
  const categories = [];
  const onlyFlag = flags.agentsOnly || flags.skillsOnly || flags.knowledgeOnly || flags.hooksOnly;
  if (flags.agentsOnly || !onlyFlag) categories.push('agents');
  if (flags.skillsOnly || !onlyFlag) categories.push('skills');
  if (flags.knowledgeOnly || !onlyFlag) categories.push('knowledge');
  // hooks: project-local only (mechanism layer needs absolute paths and project state).
  if (!flags.global && (flags.hooksOnly || !onlyFlag)) categories.push('hooks');

  for (const cat of categories) {
    const t = await installCategory(cat, target);
    for (const k of Object.keys(t)) totals[k] = (totals[k] || 0) + (t[k] || 0);
  }

  // settings.json merge: project-local only, runs whenever hooks were installed.
  if (!flags.global && (flags.hooksOnly || !onlyFlag)) {
    await installSettings(target);
  }

  // Project-config layer: only for project-local installs (not --global), and skip if any --*-only flag.
  if (!flags.global && !onlyFlag) {
    await installProjectConfig(process.cwd());
  }

  console.log(`\nDone. created=${totals.created} overwritten=${totals.overwritten} skipped=${totals.skipped}` +
              (flags.dryRun ? ` would-write=${totals['would-write']}` : ''));

  // Write manifest for future `update` runs. Project-local only — --global
  // installs intentionally skip the manifest layer (no per-user tracking).
  if (!flags.global && !flags.dryRun) {
    const m = buildManifest(target);
    writeManifest(target, m);
    console.log(`  ✓ manifest: ${path.relative(process.cwd(), path.join(target, MANIFEST_NAME))}`);
  }

  doctor();

  console.log(`\nNext steps:`);
  console.log(`  - Restart Claude Code (or open a new session) so it picks up the agents/skills.`);
  console.log(`  - Try: /sf-apex  or invoke the sf-context-explorer agent.\n`);
}

// Read-only environment check. Never fatal — prints diagnosis and continues.
// Does not read or store any tokens; defers all auth to the `sf` CLI.
function doctor() {
  console.log(`\nEnvironment check`);

  const cwd = process.cwd();
  const hasForceApp = fs.existsSync(path.join(cwd, 'force-app'));
  console.log(`  ${hasForceApp ? '✓' : '!'} force-app/ ${hasForceApp ? 'found' : 'not found in ' + cwd + ' (skills expect an SFDX project layout)'}`);

  const sfVersion = runQuiet('sf', ['--version']);
  if (!sfVersion.ok) {
    console.log(`  ! sf CLI not found on PATH — install: https://developer.salesforce.com/tools/salesforcecli`);
    console.log(`    (skipping org check)`);
    return;
  }
  console.log(`  ✓ sf CLI: ${sfVersion.stdout.split('\n')[0].trim()}`);

  const orgs = runQuiet('sf', ['org', 'list', '--json']);
  if (!orgs.ok) {
    console.log(`  ! sf org list failed — run: sf org login web`);
    return;
  }

  let parsed;
  try { parsed = JSON.parse(orgs.stdout); } catch { parsed = null; }
  const result = parsed && parsed.result ? parsed.result : {};
  const all = []
    .concat(result.nonScratchOrgs || [])
    .concat(result.scratchOrgs || [])
    .concat(result.devHubs || [])
    .concat(result.sandboxes || []);

  if (!all.length) {
    console.log(`  ! no authenticated orgs — run: sf org login web`);
    return;
  }

  const defaultOrg = all.find(o => o.isDefaultUsername || o.isDefaultDevHubUsername);
  console.log(`  ✓ ${all.length} org(s) authenticated`);
  if (defaultOrg) {
    console.log(`    default: ${defaultOrg.alias || defaultOrg.username} <${defaultOrg.username}> [${defaultOrg.instanceUrl || 'n/a'}]`);
  } else {
    console.log(`    ! no default org set — run: sf config set target-org <alias>`);
  }
}

function runQuiet(cmd, args) {
  try {
    const isWin = process.platform === 'win32';
    const r = isWin
      ? spawnSync([cmd].concat(args).map(a => /\s/.test(a) ? `"${a}"` : a).join(' '), { encoding: 'utf8', shell: true })
      : spawnSync(cmd, args, { encoding: 'utf8' });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch {
    return { ok: false, stdout: '', stderr: '' };
  }
}

(async () => {
  try {
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return help();
    if (cmd === 'list') return listContents();
    if (cmd === 'init') return await init();
    if (cmd === 'update') return await update();
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
})();
