#!/usr/bin/env node
/**
 * Event checks for a submission (one PR = one issue).
 *
 *   node .github/event/check.mjs                      # every gate
 *   node .github/event/check.mjs --gate strict-lint   # one gate
 *   node .github/event/check.mjs --stage static       # one stage
 *   node .github/event/check.mjs --list               # names and stages
 *
 * The diff is always taken from the merge base of --base and --head, so commits that
 * landed on main after the branch was cut are never attributed to the submission. In CI
 * the workflow checks out the PR merge commit and passes --base HEAD^1.
 *
 * Gates in the `static` stage are pure functions over the diff: no install, no build.
 * Everything else needs node_modules, and some need the packages built.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'origin/main' },
    head: { type: 'string', default: 'HEAD' },
    gate: { type: 'string' },
    stage: { type: 'string' },
    list: { type: 'boolean' },
    'ci-only': { type: 'boolean' },
  },
});

/* ------------------------------------------------------------------ plumbing */

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /(?:__tests__\/|\/tests\/|\.test\.|\.spec\.)/;

let changes = [];
let present = [];
let diff = '';

function loadDiff() {
  const mergeBase = git('merge-base', values.base, values.head).trim();
  changes = git('diff', '--name-status', '--no-renames', mergeBase, values.head)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split('\t');
      return { status: status[0], file };
    });
  present = changes.filter(({ status }) => status !== 'D').map(({ file }) => file);
  diff = git('diff', '-U0', '--no-renames', mergeBase, values.head);
  return mergeBase;
}

/** Added lines with their post-image line numbers. */
function addedLines() {
  const out = [];
  let file = null;
  let cursor = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      cursor = Number(hunk[1]);
      continue;
    }
    if (file && line.startsWith('+')) {
      out.push({ file, line: cursor, text: line.slice(1) });
      cursor += 1;
    }
  }
  return out;
}

function removedLines() {
  const out = [];
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      file = line.startsWith('--- a/') ? line.slice(6) : null;
      continue;
    }
    if (file && line.startsWith('-') && !line.startsWith('---')) out.push({ file, text: line.slice(1) });
  }
  return out;
}

function packageOf(file) {
  if (!file.startsWith('packages/')) return null;
  let dir = dirname(file);
  while (dir.startsWith('packages/')) {
    if (existsSync(join(ROOT, dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function touchedPackages() {
  return [...new Set(present.filter((f) => SOURCE.test(f)).map(packageOf).filter(Boolean))];
}

function filesIn(pkg) {
  return present.filter((f) => SOURCE.test(f) && packageOf(f) === pkg);
}

const scripts = (pkg) => JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8')).scripts ?? {};

/* ----------------------------------------------------------------- reporting */

const problems = [];
const failures = [];
let current = null;

const detail = (lines) => {
  for (const line of lines.slice(0, 40)) {
    console.log(`    ${line}`);
    if (process.env.GITHUB_ACTIONS) {
      const at = String(line).match(/^([^\s:]+):(\d+)/);
      console.log(`::error${at ? ` file=${at[1]},line=${at[2]}` : ''}::${current}: ${line}`);
    }
  }
  if (lines.length > 40) console.log(`    … and ${lines.length - 40} more`);
};

const fail = (message, lines = []) => {
  problems.push(`${current}: ${message}`);
  failures.push({ gate: current, message, lines });
  console.log(`✗ ${current} — ${message}`);
  detail(lines);
};

const ok = (message) => console.log(`✓ ${current} — ${message}`);

function run(cmd, args, { cwd = ROOT, env = {} } = {}) {
  console.log(`  $ ${relative(ROOT, cwd) || '.'} › ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true', ...env } }).status === 0;
}

const BIG_MEM = { NODE_OPTIONS: '--max-old-space-size=6144' };

/* -------------------------------------------------------------- oxlint helper */

function oxlintDiagnostics(configPath, targets) {
  const res = spawnSync(
    'yarn',
    ['oxlint', '--config', configPath, '--format', 'json', ...targets],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const stdout = res.stdout ?? '';
  // A config error prints nothing to stdout. Returning [] here would report a broken
  // gate as a clean one, so anything unparseable is an error, not an empty result.
  if (/Failed to parse|not found in plugin|invalid/i.test(res.stderr ?? '')) return null;
  const start = stdout.indexOf('[', stdout.indexOf('"diagnostics"'));
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < stdout.length; i += 1) {
    if (stdout[i] === '[') depth += 1;
    else if (stdout[i] === ']' && --depth === 0) {
      try {
        return JSON.parse(stdout.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Only diagnostics landing on lines this submission wrote. */
function onChangedLines(diagnostics) {
  const touched = new Map();
  for (const { file, line } of addedLines()) {
    if (!touched.has(file)) touched.set(file, new Set());
    touched.get(file).add(line);
  }
  return diagnostics.filter((d) =>
    (d.labels ?? []).some((l) => touched.get(d.filename)?.has(l?.span?.line))
  );
}

const describe = (d) => {
  const line = (d.labels ?? [])[0]?.span?.line ?? '?';
  return `${d.filename}:${line} ${d.code} — ${d.message}`;
};

function lintGate({ config, label, scopeToChangedLines = true, filter = SOURCE }) {
  const targets = present.filter((f) => f.startsWith('packages/') && filter.test(f));
  if (!targets.length) return ok('nothing to check');

  const all = oxlintDiagnostics(config, targets);
  if (all === null) return fail(`could not run ${label}`);

  const relevant = scopeToChangedLines ? onChangedLines(all) : all;
  if (relevant.length) {
    return fail(
      `${relevant.length} problem(s) on lines this PR wrote`,
      relevant.map(describe)
    );
  }
  ok(`${label} clean (${all.length} pre-existing diagnostic(s) on untouched lines ignored)`);
}

/* ---------------------------------------------------------------- the gates */

const PROTECTED = [
  [/^\.github\//, 'CI configuration'],
  [/(^|\/)package\.json$/, 'package manifests'],
  [/^yarn\.lock$/, 'the lockfile'],
  [/^\.yarnrc\.yml$|^\.yarn\//, 'the Yarn setup'],
  [/^\.husky\//, 'git hooks'],
  [/^examples\//, 'the example apps (sandbox only)'],
  [/^tests\//, 'shared test infrastructure'],
  [/^scripts\//, 'repository scripts'],
  [/(^|\/)(\.eslintrc[^/]*|eslint\.config\.[^/]+|\.eslintignore)$/, 'lint configuration'],
  [/(^|\/)(\.prettierrc[^/]*|\.prettierignore|prettier\.config\.[^/]+)$/, 'prettier configuration'],
  [/(^|\/)(jest[^/]*\.(js|ts|cjs|mjs)|vitest[^/]*\.config\.[^/]+)$/, 'test runner configuration'],
  [/(^|\/)tsconfig[^/]*\.json$/, 'TypeScript configuration'],
  [/(^|\/)(rollup|vite|webpack)\.config\.[^/]+$/, 'build configuration'],
  [/(^|\/)(nx\.json|project\.json|lerna\.json|\.nxignore)$/, 'workspace configuration'],
  [/^packages\/utils\//, 'shared tooling'],
  [/^packages\/admin-test-utils\//, 'the shared test harness'],
  [/(^|\/)__mocks__\//, 'test mocks'],
  [/\.snap$/, 'test snapshots'],
  [/^EVENT\.md$/, 'the event rules'],
];

const BANNED = [
  [/@ts-(ignore|nocheck|expect-error)/, 'TypeScript suppression'],
  [/(eslint|oxlint)-disable/, 'lint suppression'],
  [/prettier-ignore/, 'formatting suppression'],
  [/\bas\s+any\b|:\s*any\b|<any>/, '`any` type'],
  [/\bconsole\.(log|debug|info|trace)\s*\(/, 'console logging'],
  [/\bdebugger\b/, '`debugger` statement'],
  [/\b(describe|it|test)\.(only|skip|todo)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/, 'focused or skipped test'],
  [/\.skip\s*\(/, 'skipped test'],
];

const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\b(?:secret|password|passwd|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'hard-coded credential'],
];

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|jar|exe|dll|so|dylib|woff2?|ttf|eot|mp4|mov)$/i;
const MAX_FILES = 12;
const MAX_LINES = 300;
const MAX_PACKAGES = 2;
const MAX_FILE_BYTES = 200 * 1024;

const GATES = [
  /* ---------------------------------------------------------------- static */
  {
    name: 'protected-paths',
    stage: 'static',
    run() {
      const hits = changes
        .map(({ file }) => {
          const hit = PROTECTED.find(([re]) => re.test(file));
          return hit ? `${file} (${hit[1]})` : null;
        })
        .filter(Boolean);
      if (hits.length) return fail('these files are off limits', hits);
      ok('no protected file changed');
    },
  },
  {
    name: 'source-required',
    stage: 'static',
    run() {
      if (!changes.length) return fail('the PR changes nothing');
      if (!changes.some(({ file }) => file.startsWith('packages/') && SOURCE.test(file))) {
        return fail('a fix must change source code under packages/');
      }
      ok('changes source under packages/');
    },
  },
  {
    name: 'diff-size',
    stage: 'static',
    run() {
      const lines = addedLines().length + removedLines().length;
      if (changes.length > MAX_FILES || lines > MAX_LINES) {
        return fail(
          `too large for one issue: ${changes.length} file(s), ${lines} line(s) ` +
            `(limit ${MAX_FILES} / ${MAX_LINES})`
        );
      }
      ok(`${changes.length} file(s), ${lines} line(s)`);
    },
  },
  {
    name: 'scope-focus',
    stage: 'static',
    run() {
      const pkgs = touchedPackages();
      if (pkgs.length > MAX_PACKAGES) {
        return fail(`one issue per PR: ${pkgs.length} packages touched`, pkgs);
      }
      ok(pkgs.length ? pkgs.join(', ') : 'no package source changed');
    },
  },
  {
    name: 'test-integrity',
    stage: 'static',
    run() {
      const deleted = changes.filter(({ status, file }) => status === 'D' && TEST_FILE.test(file));
      if (deleted.length) return fail('test files must not be deleted', deleted.map((d) => d.file));

      const count = (ls) => ls.filter(({ file, text }) => TEST_FILE.test(file) && /\bexpect\s*\(/.test(text)).length;
      const lost = count(removedLines());
      const added = count(addedLines());
      if (lost > added) {
        return fail(`assertions removed (${lost} out, ${added} in) — fix the code, not the tests`);
      }
      ok('no tests or assertions removed');
    },
  },
  {
    name: 'banned-patterns',
    stage: 'static',
    run() {
      const hits = addedLines()
        .filter(({ file }) => SOURCE.test(file))
        .flatMap(({ file, line, text }) =>
          BANNED.filter(([re]) => re.test(text)).map(([, label]) => `${file}:${line} ${label}: ${text.trim()}`)
        );
      if (hits.length) return fail('banned pattern in added code', hits);
      ok('no suppressions, `any`, logging or skipped tests');
    },
  },
  {
    name: 'no-secrets',
    stage: 'static',
    run() {
      const hits = addedLines().flatMap(({ file, line, text }) =>
        SECRETS.filter(([re]) => re.test(text)).map(([, label]) => `${file}:${line} ${label}`)
      );
      if (hits.length) return fail('possible credential in added code', hits);
      ok('no credentials added');
    },
  },
  {
    name: 'no-binaries',
    stage: 'static',
    run() {
      const hits = [];
      for (const file of present) {
        if (BINARY.test(file)) hits.push(`${file} (binary)`);
        else {
          const path = join(ROOT, file);
          if (existsSync(path) && statSync(path).size > MAX_FILE_BYTES) {
            hits.push(`${file} (${Math.round(statSync(path).size / 1024)} KB)`);
          }
        }
      }
      if (hits.length) return fail('binary or oversized files added', hits);
      ok('no binary or oversized files');
    },
  },

  {
    name: 'no-todo-markers',
    stage: 'static',
    run() {
      const hits = addedLines()
        .filter(({ file }) => SOURCE.test(file))
        .filter(({ text }) => /\b(TODO|FIXME|XXX|HACK)\b/.test(text))
        .map(({ file, line, text }) => `${file}:${line} ${text.trim()}`);
      if (hits.length) return fail('a fix should not leave TODO/FIXME markers', hits);
      ok('no TODO or FIXME markers added');
    },
  },
  {
    name: 'no-new-dependencies',
    stage: 'static',
    // A fix must work with the packages already installed. Importing something that is
    // not a declared dependency passes locally (hoisted node_modules) and then breaks a
    // clean install — and the manifests are protected, so it cannot be declared either.
    run() {
      const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
      const hits = [];

      for (const { file, line, text } of addedLines()) {
        if (!SOURCE.test(file)) continue;
        const spec = text.match(/(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/)?.[1];
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || builtins.has(spec)) continue;

        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        const pkg = packageOf(file);
        if (!pkg) continue;

        const manifest = JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8'));
        const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        const declared = new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
          ...Object.keys(root.dependencies ?? {}),
          ...Object.keys(root.devDependencies ?? {}),
        ]);
        if (!declared.has(name)) hits.push(`${file}:${line} imports "${name}", not a dependency of ${pkg}`);
      }

      if (hits.length) return fail('undeclared dependency — this breaks a clean install', hits);
      ok('every import resolves to a declared dependency');
    },
  },

  /* --------------------------------------------------------------- quality */
  {
    name: 'prettier',
    stage: 'quality',
    run() {
      const targets = present.filter((f) => /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|scss)$/.test(f));
      if (!targets.length) return ok('nothing to format-check');
      if (run('yarn', ['prettier', '--check', '--ignore-unknown', ...targets])) return ok('formatted');
      fail('run `yarn prettier --write <files>`');
    },
  },
  {
    name: 'eslint',
    stage: 'quality',
    run() {
      const targets = present.filter((f) => f.startsWith('packages/') && SOURCE.test(f));
      if (!targets.length) return ok('nothing to lint');
      if (run('yarn', ['eslint', '--max-warnings=0', ...targets], { env: BIG_MEM })) return ok('clean');
      fail('eslint reported problems');
    },
  },
  {
    name: 'strict-lint',
    stage: 'quality',
    run: () => lintGate({ config: '.github/event/oxlint.strict.json', label: 'strict policy' }),
  },
  {
    name: 'complexity',
    stage: 'quality',
    run: () => lintGate({ config: '.github/event/complexity.json', label: 'complexity budget' }),
  },
  {
    name: 'hygiene',
    stage: 'quality',
    run: () => lintGate({ config: '.github/event/hygiene.json', label: 'hooks, imports and unused code' }),
  },

  /* ----------------------------------------------------------------- types */
  {
    name: 'typecheck',
    stage: 'types',
    run() {
      const pkgs = touchedPackages();
      if (!pkgs.length) return ok('no package source changed');
      let bad = false;
      for (const pkg of pkgs) {
        const s = scripts(pkg);
        const targets = ['test:ts', 'test:ts:back', 'test:ts:front'].filter((t) => s[t]);
        if (!targets.length) {
          console.log(`  ${pkg}: no typecheck script`);
          continue;
        }
        for (const t of targets) {
          if (!run('yarn', ['run', t], { cwd: join(ROOT, pkg), env: BIG_MEM })) {
            fail(`${pkg} › ${t} failed`);
            bad = true;
          }
        }
      }
      if (!bad) ok(`typechecked ${pkgs.join(', ')}`);
    },
  },
  {
    name: 'build-types',
    ci: false,
    stage: 'types',
    run() {
      const pkgs = touchedPackages().filter((p) => scripts(p)['build:types']);
      if (!pkgs.length) return ok('no declaration build needed');
      let bad = false;
      for (const pkg of pkgs) {
        if (!run('yarn', ['run', 'build:types'], { cwd: join(ROOT, pkg), env: BIG_MEM })) {
          fail(`${pkg} › build:types failed`);
          bad = true;
        }
      }
      if (!bad) ok('declarations emit cleanly');
    },
  },

  /* ----------------------------------------------------------------- build */
  {
    name: 'build',
    ci: false,
    stage: 'build',
    run() {
      const pkgs = touchedPackages();
      if (!pkgs.length) return ok('no package source changed');
      let bad = false;
      for (const pkg of pkgs) {
        if (!run('yarn', ['run', 'build:code'], { cwd: join(ROOT, pkg), env: BIG_MEM })) {
          fail(`${pkg} › build:code failed`);
          bad = true;
        }
      }
      if (!bad) ok(`built ${pkgs.join(', ')}`);
    },
  },

  /* ------------------------------------------------------------------ test */
  {
    name: 'test-related',
    stage: 'test',
    run: () => runTests({ related: true, label: 'tests related to the changed files' }),
  },
  {
    name: 'test-package',
    ci: false,
    stage: 'test',
    run: () => runTests({ related: false, label: 'full suite of every touched package' }),
  },
  {
    name: 'test-repeat',
    ci: false,
    stage: 'test',
    // Same related tests a second time: catches order dependence and a test that only
    // passes on a warm cache or a particular random seed.
    run: () => runTests({ related: true, label: 'repeat run (flake check)' }),
  },
  {
    name: 'test-dependents',
    ci: false,
    stage: 'test',
    run() {
      const pkgs = touchedPackages();
      if (!pkgs.length) return ok('no package source changed');
      const res = spawnSync(
        'yarn',
        ['nx', 'show', 'projects', '--affected', `--base=${values.base}`, `--head=${values.head}`],
        { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 }
      );
      if (res.status !== 0) return ok('dependency graph unavailable — skipped');
      const projects = (res.stdout ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('>') && !l.includes(' '));
      if (!projects.length) return ok('no dependent project');
      console.log(`  affected: ${projects.join(', ')}`);
      if (run('yarn', ['nx', 'run-many', '--target=test:unit', `--projects=${projects.join(',')}`,
        '--nx-ignore-cycles', '--parallel=3'], { env: BIG_MEM })) {
        return ok(`${projects.length} affected project(s) still pass`);
      }
      fail('a package that depends on your change now fails its tests');
    },
  },

  /* ----------------------------------------------------------------- smoke */
  {
    name: 'smoke-boot',
    ci: false,
    stage: 'smoke',
    async run() {
      if (!touchedPackages().length) return ok('no package source changed');
      if (!run('yarn', ['build'], { env: BIG_MEM })) return fail('monorepo build failed');
      const started = await bootsCleanly();
      if (started.ok) return ok('the app starts and serves the admin panel');
      fail('`yarn develop` does not start', started.evidence);
    },
  },
];

/** Boots the sandbox and waits for the startup banner. */
function bootsCleanly() {
  return new Promise((done) => {
    // `detached` puts the server in its own process group. Killing only the `yarn`
    // process leaves the strapi child alive holding these pipes open, which keeps this
    // process from ever exiting — so the whole group has to go.
    const child = spawn('yarn', ['develop', '--no-watch-admin'], {
      cwd: join(ROOT, 'examples', 'getstarted'),
      env: { ...process.env, CI: 'true', BROWSER: 'none' },
      detached: true,
    });
    let output = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const stream of [child.stdout, child.stderr]) {
        stream.removeAllListeners('data');
        stream.destroy();
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
      child.unref();
      done(result);
    };

    const scan = (chunk) => {
      output += chunk;
      if (/Actions available|To access the server/i.test(output)) finish({ ok: true });
      if (/There seems to be an unexpected error|TypeError:|Error creating endpoint/.test(output)) {
        finish({ ok: false, evidence: tail(output) });
      }
    };

    child.stdout.on('data', (d) => scan(String(d)));
    child.stderr.on('data', (d) => scan(String(d)));
    child.on('exit', (code) => finish({ ok: false, evidence: [`exited with code ${code}`, ...tail(output)] }));

    const timer = setTimeout(() => finish({ ok: false, evidence: ['timed out after 6 minutes', ...tail(output)] }), 6 * 60 * 1000);
  });
}

const tail = (text) =>
  text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(-25);

/** Shared by the three test gates. */
function runTests({ related, label }) {
  const pkgs = touchedPackages();
  if (!pkgs.length) return ok('no package source changed');
  let bad = false;

  for (const pkg of pkgs) {
    const cwd = join(ROOT, pkg);
    const local = filesIn(pkg).map((f) => relative(pkg, f));
    const relatedArgs = related ? ['--findRelatedTests', ...local] : [];

    if (existsSync(join(cwd, 'jest.config.js'))) {
      const args = ['run', '-T', 'jest', '--config', 'jest.config.js', ...relatedArgs, '--ci', '-w', '3'];
      if (related) args.push('--passWithNoTests');
      if (!run('yarn', args, { cwd, env: BIG_MEM })) {
        fail(`${pkg} › unit tests failed`);
        bad = true;
      }
    }
    if (existsSync(join(cwd, 'jest.config.front.js'))) {
      const args = ['run', '-T', 'jest', '--config', 'jest.config.front.js', ...relatedArgs, '--ci', '-w', '2'];
      if (related) args.push('--passWithNoTests');
      if (!run('yarn', args, { cwd, env: { ...BIG_MEM, IS_EE: 'true' } })) {
        fail(`${pkg} › front tests failed`);
        bad = true;
      }
    }
    if (['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js'].some((f) => existsSync(join(cwd, f)))) {
      const args = related
        ? ['run', '-T', 'vitest', 'related', '--run', '--passWithNoTests', ...local]
        : ['run', '-T', 'vitest', 'run'];
      if (!run('yarn', args, { cwd, env: BIG_MEM })) {
        fail(`${pkg} › vitest failed`);
        bad = true;
      }
    }
  }
  if (!bad) ok(label);
}

/* ------------------------------------------------------------------- driver */

const ciFiltered = values['ci-only'] ? GATES.filter((g) => g.ci !== false) : GATES;

if (values.list) {
  for (const g of ciFiltered) console.log(`${g.stage}\t${g.name}`);
  process.exit(0);
}

const selected = values.gate
  ? ciFiltered.filter((g) => g.name === values.gate)
  : values.stage
    ? ciFiltered.filter((g) => g.stage === values.stage)
    : ciFiltered;

if (!selected.length) {
  console.error(`No gate matched. Known gates:\n${GATES.map((g) => `  ${g.name}`).join('\n')}`);
  process.exit(2);
}

const mergeBase = loadDiff();
console.log(`${values.base} (merge base ${mergeBase.slice(0, 10)}) → ${values.head}`);
console.log(`changed files:\n${changes.map(({ status, file }) => `  ${status} ${file}`).join('\n')}\n`);

/**
 * Publishes one check run per gate from a single job.
 *
 * Giving every gate its own job would show the same rows on the pull request and bill a
 * checkout and an install for each one. The Checks API reports them separately for free.
 * It needs `checks: write` and a token with write access, which a pull request from a
 * fork does not get — so a failure here is reported and ignored, never fatal.
 */
async function publishCheck({ name, ok, lines, startedAt }) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.CHECK_SHA;
  if (!token || !repo || !sha) return;

  const body = {
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: ok ? 'success' : 'failure',
    started_at: new Date(startedAt).toISOString(),
    completed_at: new Date().toISOString(),
    output: {
      title: ok ? 'passed' : lines[0]?.slice(0, 120) || 'failed',
      summary: ok ? `\`${name}\` passed.` : ['```', ...lines.slice(0, 40), '```'].join('\n'),
    },
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/check-runs`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.log(`  (could not publish check "${name}": ${res.status})`);
  } catch (error) {
    console.log(`  (could not publish check "${name}": ${error.message})`);
  }
}

for (const gate of selected) {
  current = gate.name;
  const before = problems.length;
  const startedAt = Date.now();

  await gate.run();

  const mine = failures.filter((f) => f.gate === gate.name);
  await publishCheck({
    name: gate.name,
    ok: problems.length === before,
    lines: mine.flatMap((f) => [f.message, ...f.lines]),
    startedAt,
  });
}

console.log('');
if (problems.length) {
  console.log(`FAILED — ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  • ${p}`);
  process.exit(1);
}
console.log(`PASSED — ${selected.length} gate(s)`);
