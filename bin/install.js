#!/usr/bin/env node
// harness-sf installer — copies agents and skills into a target .claude/ directory.
// Zero runtime deps. Node >= 18.

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');

const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(PKG_ROOT, 'templates');

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
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
})();
