# Bug Hunt — rules

This repository is a Strapi v5 monorepo with **95 bugs** deliberately injected into it. Every bug
has a GitHub issue describing the symptom — never the file or the cause.

| Label      | Count | Points                          |
| ---------- | ----- | ------------------------------- |
| `critical` | 1     | 50                              |
| `frontend` | 50    | 10 / 20 / 30 (easy/medium/hard) |
| `backend`  | 44    | 10 / 20 / 30 (easy/medium/hard) |

Start with the **critical** issue: until it is fixed, `yarn develop` crashes on startup and
nothing else can be reproduced.

None of these are one-character typos. Expect a real defect in the logic — a wrong algorithm at
the edges, operations in the wrong order, a guard that swallows a case, state derived from the
wrong source. Reproduce it first, then trace it.

## Setup

```bash
yarn install
yarn setup                       # builds every package (a few minutes)
cd examples/getstarted
yarn develop                     # crashes until the critical issue is fixed
```

### The one thing that catches everyone

**The app runs compiled output from `packages/*/dist`, not your source.** Editing a `.ts` file
changes nothing until you rebuild, and `dist/` is gitignored so switching branches does not update
it either. After any change:

```bash
cd packages/core/<package> && yarn build     # rebuild just what you touched
```

or run `yarn watch` at the repository root in a second terminal and leave it running.

If your fix "does nothing", this is almost always why.

## Submitting

1. Branch from `main`.
2. Fix **one** issue per pull request. Put `Fixes #<issue number>` in the description.
3. Open the PR against `main`. Checks run automatically and take a minute or two.
4. A PR is merged — and points awarded — only when every check is green **and** the fix is
   correct. The first correct, green PR for an issue wins it.

PR titles, descriptions and commit messages have no required format.

## What runs on your pull request

Sixteen gates, in one job, stopping at the first failure.

**Submission shape** — no install needed, runs in seconds:

| Gate                  | What it rejects                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `protected-paths`     | editing CI, `package.json`, the lockfile, lint/test/TS/build config, snapshots, mocks, the shared test harness, `examples/`, `tests/` |
| `source-required`     | a PR that changes no source under `packages/`                                                                                         |
| `diff-size`           | more than 12 files or 300 changed lines                                                                                               |
| `scope-focus`         | touching more than two packages — one issue per PR                                                                                    |
| `test-integrity`      | deleting a test file, or removing more assertions than you add                                                                        |
| `banned-patterns`     | `any`, `@ts-ignore`, `eslint-disable`, `console.log`, `debugger`, `.only`, `.skip`                                                    |
| `no-secrets`          | credentials or keys in added code                                                                                                     |
| `no-binaries`         | binary files, or any file over 200 KB                                                                                                 |
| `no-todo-markers`     | leaving `TODO`/`FIXME`/`XXX`/`HACK` behind                                                                                            |
| `no-new-dependencies` | importing a package that is not already a dependency — it would break a clean install, and manifests are protected                    |

**Code quality** — all linting is applied to **the lines you wrote**, so the repository's existing
violations are never your problem:

| Gate          | What it enforces                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier`    | formatting of changed files                                                                                                                             |
| `eslint`      | the repository's own rules, zero warnings                                                                                                               |
| `strict-lint` | a stricter policy than the repo default: `eqeqeq`, `curly`, no shadowing, no non-null assertions, no implicit coercion, no param reassignment, and more |
| `complexity`  | cyclomatic complexity ≤ 12, nesting ≤ 4, ≤ 5 parameters, ≤ 4 nested callbacks, no nested ternaries                                                      |
| `hygiene`     | React hooks dependencies and rules-of-hooks, unused variables, duplicate imports, import cycles, async promise executors                                |
| `typecheck`   | TypeScript for every package you touched                                                                                                                |

Run all of it locally before you push — same script, same results:

```bash
node .github/event/check.mjs --base origin/main          # everything
node .github/event/check.mjs --stage static              # the fast gates only
node .github/event/check.mjs --gate complexity           # one gate
node .github/event/check.mjs --list                      # what exists
```

Beyond these, every submission is also verified against a private regression test for its issue,
and the diff is read before merging.

## What counts as a fix

Fix the cause. A change that makes the symptom disappear for the exact values in the reproduction
steps — special-casing an id, catching and ignoring an error, short-circuiting a branch — is not a
fix and will not be merged, even with every check green.

Adding a regression test alongside your fix is welcome. Deleting or weakening an existing test is
not, and the checks will catch it.
