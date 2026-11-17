# Repo Audit — 2026-11-17

**What this repo does:** A VS Code extension that shows statistics for one or more Git repositories: contributors, code frequency, a treemap of lines of code, line ownership and age (from `git blame`), and an "Evolution" chart of how the code grew over time. The extension side runs `git` and the `scc` line-counter, then sends the results to a React webview. It downloads `scc` if it is missing.

**Load assumed:** One developer on their own machine. The real stress is repo size, not users: up to 10k commits by default (`maxCommitsToAnalyze`), and repos with 10k–100k files. All automated tests were removed in commit `c4c7842 debloat`.

---

## Must fix

- [x] 1. Evolution 500-file cap — now setting repoStats.evolution.maxFilesPerSnapshot (default 500), skipped count in diagnostics.skippedBlameFiles.

### 4. scc install breaks when the user folder contains an apostrophe
`src/analyzers/sccBinaryManager.ts:302-316`
- **What this is:** After download, the scc archive is unpacked with a shell command built as a string.
- **Problem:** On Windows the path goes inside PowerShell single quotes (`'${archivePath}'`). A user folder like `C:\Users\O'Brien\…` ends the quote early, so unpacking fails. A crafted folder name could even inject a command. The `where`/`which` and `--version` checks also go through the shell via `exec`.
- **Fix:** Use `execFile('tar', ['-xf', archivePath, '-C', destDir])` on every platform. `tar.exe` ships with Windows 10+ and opens zip files. This deletes the PowerShell branch.
- **If we skip it:** Some Windows users can never get scc installed automatically.

### 5. The downloaded scc program runs without an integrity check
`src/analyzers/sccBinaryManager.ts:148-176`
- **What this is:** The extension downloads scc from GitHub releases and then runs it.
- **Problem:** No checksum is compared. If the release file is replaced, or a redirect is tampered with, the extension runs whatever arrives, with the user's rights.
- **Fix:** Hard-code the SHA-256 of each of the six archives for v3.5.0 next to `BINARY_NAMES`. Hash the file after download with `crypto.createHash('sha256')`, and reject a mismatch. About 10 lines.
- **If we skip it:** A supply-chain attack (a tampered download) can run code on users' machines.

- [x] 6. Repo name on Windows — path.basename.

---

## Should fix

### 7. Cancel and closing the panel don't stop running git or scc processes
`src/webview/provider.ts:136-140`, `src/analyzers/locCounter.ts:334`, `src/analyzers/gitAnalyzer.ts:44`
- **What this is:** The abort signal only stops results from being sent. Child processes keep running.
- **Problem:** Press Refresh three times on a big repo and you get three scc runs plus three full-history `git log` runs in parallel. Closing the panel doesn't cancel anything, so a 20-snapshot Evolution run blames files for minutes and then posts to a closed webview.
- **Fix:** Pass the signal on: `execFileAsync(..., { signal })` and `simpleGit({ baseDir, abort: signal })`. In `onDidDispose`, call `analysisService.cancelRun('core')` and `cancelRun('evolution')`.
- **If we skip it:** CPU and memory pile up on large repos, and the laptop fan spins after the user has closed the panel.

### 8. Refresh throws away the blame cache, so every file is blamed again
`src/webview/provider.ts:151-156`, `src/webview/analysisService.ts:36-42`
- **What this is:** Blame results are cached per file by blob SHA (the hash of the file's content), so unchanged files can be skipped.
- **Problem:** `refresh()` calls `clearCache()`, which deletes the whole cache entry, blame caches included. A Refresh on a 5,000-file repo re-blames all 5,000 files even if only one changed.
- **Fix:** Give `runAnalysis` a `force` flag that skips only the `getIfValid` check. Drop the `clearCache` call from `refresh()`.
- **If we skip it:** Refresh is many times slower than it needs to be.

### 9. The cache in workspace state only grows
`src/cache/cacheManager.ts:28, 53-71`
- **What this is:** Each analysis result is saved in VS Code's `workspaceState`. That includes all 10k commit records with their changed-file lists, the full tree, a blame entry per file, and `fileLOC`.
- **Problem:** The key comes from the target id, and every different repo selection is a new target. Old entries are never removed. Each can be many MB, and VS Code loads this state when the workspace opens.
- **Fix:** Use one fixed key per scope (`repoStats_core`, `repoStats_evolution`) and check the stored `targetId` when reading. That field is already saved. Also stop writing `fileLOC`, which is never read.
- **If we skip it:** Workspaces where people switch selections get slower to open over time.

### 10. A second full-history git walk, read whole into memory, with no limit
`src/analyzers/gitAnalyzer.ts:108-141`
- **What this is:** `getFileModificationDates` runs `git log HEAD --name-only` over all history to find each file's last change.
- **Problem:** The commit log is capped at `maxCommitsToAnalyze`, but this one isn't. On a kernel-sized repo (about 1M commits) the output is hundreds of MB, held as one string. It can fail with "Invalid string length", and it is the slowest step. The same dates are already in `commitAnalytics.records` (`committedAt` + `changedFiles`, newest first).
- **Fix:** Build the map from the records: walk them in order and set each path the first time you see it. Delete `getFileModificationDates`. Files older than the cap get no date, the same limit the rest of the dashboard already shows.
- **If we skip it:** Big repos are slow, or the analysis crashes.

### 11. Branch and HEAD are read in four places, and repo info twice per run
`gitAnalyzer.ts:55-83`, `memberEvolutionRuntime.ts:76-92`, `targetRevisionState.ts:22-39`, `targetCoordinator.ts:100-120`
- **What this is:** Four near-copies of "run `rev-parse --abbrev-ref HEAD` and `rev-parse HEAD`".
- **Problem:** `getTargetRevision()` calls `getRepoInfo()` (a repo check, two `rev-parse` calls and `rev-list --count`). Then `analyze()` calls it again. On large repos `rev-list --count` is slow, and it runs twice. The copies must also change together.
- **Fix:** Use `collectTargetMemberHeads` for the revision check in `analysisService` (it is already used for staleness) and delete `getTargetRevision`. Have `getHeadInfo` call the same helper.
- **If we skip it:** Repeated git work on every run, and four places to keep in sync.

### 12. The same tree-building code twice, and both are slow on large folders
`src/analyzers/locCounter.ts:391-432`, `src/analyzers/coordinator.ts:~430-460`
- **What this is:** Both functions walk a path like `a/b/c.ts` and create folder nodes as needed.
- **Problem:** Both look up each folder with `children.find(...)`, a linear scan over all siblings. A folder with 20k files (fixtures, generated code) costs about 200M comparisons.
- **Fix:** One shared `ensureDirectory(root, segments)` helper with a `Map<string, TreemapNode>` per folder (kept on the side, not sent to the webview). Both callers use it.
- **If we skip it:** Analysis noticeably slows down on wide folders, and the two copies drift apart.

### 13. No test covers the path security check or the git output parsers
`src/webview/messageValidation.ts:121-160`, `src/analyzers/commitAnalytics.ts:34-87`
- **What this is:** `validateLogicalPath`/`resolveContainedPath` stop the webview from opening files outside the repo. The log, numstat and blame parsers turn git text into all the numbers on screen.
- **Problem:** All tests were deleted. Findings 2 and 3 are the kind of bug these tests catch.
- **Fix:** Add one `node:test` file, bundled with the existing esbuild. Check that `../x`, `/etc/passwd` and `a/../../b` are rejected. Feed the log parser a short sample that has a non-ASCII path and an author name containing `|`.
- **If we skip it:** The next refactor can open a path-traversal hole (reading files outside the repo) or skew every chart, and nothing fails.

### 14. Leftover code that only the deleted tests used
Several files
- **What this is:** Hooks for swapping in fake objects (dependency injection) that only the tests needed.
- **Problem:** These have no caller left:
  - the `GitClient`/`LOCClient` interfaces
  - the optional `gitClient`/`locClient` constructor parameters
  - the `coordinatorFactory` option
  - the factories `createGitAnalyzer`, `createLOCCounter`, `createSccBinaryManager`
  - `InMemoryCacheStorage`, `CacheManager.getLastAnalyzed`, and the `fileLOC` map
  - `resolveWebviewView` (`provider.ts:99`): no view is contributed or registered
  - the `ts-node` devDependency
- **Fix:** Delete them and use the classes directly. If you plan to bring tests back (finding 13), keep only the two interfaces.
- **If we skip it:** About 100 lines nobody calls, which every reader still has to understand.

---

## Nice to have

- [x] 15. Commit dates compared as text — compares record.timestamp.
- [x] 16. Author name with | — git format and parser use \x1f.
17. **The custom regex is compiled again for every commit** (`src/analyzers/commitMetadata.ts:198`): 10k compiles on every Trends render in the webview. Compile it once per extractor.
18. **scc is detected again for every repo in every run, with fragile parsing** (`sccBinaryManager.ts:93-128`): each `LOCCounter` makes its own manager, so `where scc` and `scc --version` run each time. `split('\n')[0]` keeps a trailing `\r` when `where` finds more than one match, so the check fails and the extension downloads scc for nothing. Share one manager instance and split on `/\r?\n/`.
- [x] 19. CSP nonce — crypto.randomBytes(16).

Four smaller ones are left out: the error type is detected by message prefix, `getSccInfo` silently falls back to a hard-coded version, a merge-candidate md5/sha1 hash helper appears twice, and the git error for an empty repo is unclear.

---

**Verdict:** Fix 1 and 2 first, because they make Evolution and treemap data wrong without telling anyone. Then 7 and 8, which cost the most time on real repos.

**Lean:** about -150 lines and -1 dependency possible (`ts-node`), from findings 10, 11, 12, 14, 4 and 19.

**Not checked:** I didn't read most of `webview-ui/src` (React components, the store, the chart code) beyond a search for unsafe HTML (none found). I also skipped `targetEvolutionAnalyzer.ts` sampling details, `workspaceRepositoryScanner.ts` and `settingsService.ts`. I didn't run anything: I didn't test whether scc's `--exclude-dir` matches Windows backslash paths, and `npm run validate` was not run.
