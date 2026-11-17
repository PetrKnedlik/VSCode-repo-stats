import * as os from 'os';
import * as path from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { AnalyzerExecutionError, type AnalysisTarget, type ExtensionSettings } from '../../types/index.js';
import {
  cloneHistogram,
  createEmptyHistogram,
  formatCohort,
  getTopDirectory,
  incrementCount,
  isExpectedBlameMiss,
  mergeHistogram,
  parseHistoryLog,
  type EvolutionFileHistogram,
} from '../evolution/shared.js';
import { parseBlameStream } from '../blameStream.js';
import { throwIfCancelled } from '../cancellation.js';
import { normalizeExtensionForFilter } from '../locCounter.js';
import { createPathPatternMatcher } from '../pathMatching.js';

interface DiffStatusEntry {
  oldPath?: string;
  newPath?: string;
}

export interface MemberEvolutionProgress {
  completedSnapshots: number;
  totalSnapshots: number;
}

export interface MemberCommit {
  sha: string;
  timestamp: number;
  commitIndex: number;
  totalCommitCount: number;
  branch: string;
  globalIndex: number;
}

export interface MemberHeadInfo {
  repositoryId: string;
  repositoryName: string;
  branch: string;
  headSha: string;
}

const UNKNOWN_AUTHOR = 'Unknown';
const UNKNOWN_EMAIL = 'unknown@unknown.local';
const EMPTY_EXT = '[no-ext]';

export class MemberEvolutionRuntime {
  readonly git: SimpleGit;
  readonly shouldExcludePath: (filePath: string) => boolean;
  readonly binaryExtensions: Set<string>;
  readonly directoryBucketPrefix: string | null;
  expectedBlameMisses = 0;
  skippedBlameFiles = 0;

  constructor(
    readonly member: AnalysisTarget['members'][number],
    readonly settings: ExtensionSettings,
    private readonly signal?: AbortSignal
  ) {
    this.git = simpleGit(member.repoPath, {
      config: ['core.quotePath=false'],
      // simple-git defaults to 5, which would throttle the blame workers below.
      maxConcurrentProcesses: Math.max(5, os.cpus().length),
    });
    this.shouldExcludePath = createPathPatternMatcher([
      ...settings.excludePatterns,
      ...(member.excludePatterns ?? []),
    ]);
    this.binaryExtensions = new Set(
      settings.binaryExtensions
        .map((extension) => normalizeExtensionForFilter(extension))
        .filter((extension): extension is string => extension !== null)
    );
    this.directoryBucketPrefix = member.pathPrefix ? `${member.pathPrefix}/` : null;
  }

  async getHeadInfo(): Promise<MemberHeadInfo> {
    throwIfCancelled(this.signal);

    const [branchRaw, headShaRaw] = await Promise.all([
      this.git.revparse(['--abbrev-ref', 'HEAD']),
      this.git.revparse(['HEAD']),
    ]);

    throwIfCancelled(this.signal);

    return {
      repositoryId: this.member.id,
      repositoryName: this.member.displayName,
      branch: branchRaw.trim(),
      headSha: headShaRaw.trim(),
    };
  }

  async getCommitHistory(branch: string): Promise<MemberCommit[]> {
    throwIfCancelled(this.signal);

    const historyArgs = this.settings.evolution.historyTraversalMode === 'firstParent'
      ? ['--first-parent']
      : [];
    const rawLog = await this.git.raw([
      'log',
      ...historyArgs,
      '--reverse',
      '--format=%H|%ct',
      branch,
    ]);

    throwIfCancelled(this.signal);

    const parsedCommits = parseHistoryLog(rawLog);
    const totalCommitCount = parsedCommits.length;

    return parsedCommits.map((commit, index) => ({
      ...commit,
      commitIndex: index,
      totalCommitCount,
      branch,
      globalIndex: -1,
    }));
  }

  async analyzeCommits(
    commits: MemberCommit[],
    onProgress?: (progress: MemberEvolutionProgress) => void
  ): Promise<Map<string, EvolutionFileHistogram>> {
    throwIfCancelled(this.signal);

    const totalsBySha = new Map<string, EvolutionFileHistogram>();
    if (commits.length === 0) {
      return totalsBySha;
    }

    // Phase 1: all snapshot diffs are independent of each other, so fetch them concurrently.
    const diffsBySnapshot: DiffStatusEntry[][] = await Promise.all(
      commits.map(async (commit, commitIndex) =>
        commitIndex === 0
          ? (await this.getTrackedPathsAtCommit(commit.sha)).map((newPath) => ({ newPath }))
          : this.getDiffStatusBetweenCommits(commits[commitIndex - 1].sha, commit.sha)
      )
    );
    throwIfCancelled(this.signal);

    const blamePathsBySnapshot = diffsBySnapshot.map((diffs, snapshotIndex) => {
      // The first snapshot is the baseline later ones build on; capping it loses files for good.
      const maxFilesPerSnapshot = snapshotIndex === 0 ? Infinity : this.settings.evolution.maxFilesPerSnapshot;
      const uniqueChangedPaths = Array.from(new Set(
        diffs
          .map((diff) => diff.newPath)
          .filter((newPath): newPath is string => newPath !== undefined && this.shouldAnalyzeFile(newPath))
      ));
      this.skippedBlameFiles += Math.max(0, uniqueChangedPaths.length - maxFilesPerSnapshot);
      return uniqueChangedPaths.slice(0, maxFilesPerSnapshot);
    });

    // Phase 2: one blame pool across every snapshot, so CPUs stay busy even when a snapshot changed few files.
    const blamedBySnapshot = await this.computeHistogramsForSnapshots(
      commits,
      blamePathsBySnapshot,
      (completedSnapshots) => onProgress?.({ completedSnapshots, totalSnapshots: commits.length })
    );

    // Phase 3: fold diffs and blames in history order (same bookkeeping as a sequential walk).
    const fileHistograms = new Map<string, EvolutionFileHistogram>();
    const runningTotals = createEmptyHistogram();
    const removeFile = (filePath: string) => {
      const removedHistogram = fileHistograms.get(filePath);
      if (removedHistogram) {
        mergeHistogram(runningTotals, removedHistogram, -1);
        fileHistograms.delete(filePath);
      }
    };

    for (let commitIndex = 0; commitIndex < commits.length; commitIndex += 1) {
      const commit = commits[commitIndex];

      for (const diff of diffsBySnapshot[commitIndex]) {
        if (diff.oldPath && diff.oldPath !== diff.newPath) {
          removeFile(diff.oldPath);
        }
        if (diff.newPath && !this.shouldAnalyzeFile(diff.newPath)) {
          removeFile(diff.newPath);
        }
      }

      for (const [filePath, histogram] of blamedBySnapshot[commitIndex]) {
        const existing = fileHistograms.get(filePath);
        if (existing) {
          mergeHistogram(runningTotals, existing, -1);
        }

        fileHistograms.set(filePath, histogram);
        mergeHistogram(runningTotals, histogram, 1);
      }

      totalsBySha.set(commit.sha, cloneHistogram(runningTotals));
    }

    return totalsBySha;
  }

  private async computeHistogramsForSnapshots(
    commits: MemberCommit[],
    pathsBySnapshot: string[][],
    onSnapshotsCompleted: (completedSnapshots: number) => void
  ): Promise<Array<Map<string, EvolutionFileHistogram>>> {
    const results = pathsBySnapshot.map(() => new Map<string, EvolutionFileHistogram>());
    const remainingBySnapshot = pathsBySnapshot.map((paths) => paths.length);
    const jobs = pathsBySnapshot.flatMap((paths, snapshotIndex) =>
      paths.map((filePath) => ({ snapshotIndex, filePath }))
    );

    // Jobs run roughly in history order, so report the finished prefix of snapshots.
    let completedSnapshots = 0;
    const reportCompletedPrefix = () => {
      const before = completedSnapshots;
      while (completedSnapshots < remainingBySnapshot.length && remainingBySnapshot[completedSnapshots] === 0) {
        completedSnapshots += 1;
      }
      if (completedSnapshots !== before) {
        onSnapshotsCompleted(completedSnapshots);
      }
    };
    reportCompletedPrefix();

    const concurrency = Math.max(2, os.cpus().length);
    let nextJob = 0;
    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (nextJob < jobs.length) {
        throwIfCancelled(this.signal);

        const { snapshotIndex, filePath } = jobs[nextJob];
        nextJob += 1;
        const commit = commits[snapshotIndex];
        const histogram = await this.computeFileHistogram(filePath, commit.sha, commit.timestamp);
        results[snapshotIndex].set(filePath, histogram);
        remainingBySnapshot[snapshotIndex] -= 1;
        reportCompletedPrefix();
      }
    });

    await Promise.all(workers);
    throwIfCancelled(this.signal);
    return results;
  }

  private async getTrackedPathsAtCommit(commitSha: string): Promise<string[]> {
    const output = await this.git.raw(['ls-tree', '-r', '--name-only', commitSha]);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => this.shouldAnalyzeFile(line));
  }

  private async getDiffStatusBetweenCommits(previousSha: string, currentSha: string): Promise<DiffStatusEntry[]> {
    const output = await this.git.raw([
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      previousSha,
      currentSha,
    ]);

    const entries: DiffStatusEntry[] = [];

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parts = trimmed.split('\t');
      if (parts.length < 2) {
        continue;
      }

      const status = parts[0];

      if (status.startsWith('R') || status.startsWith('C')) {
        if (parts.length >= 3) {
          entries.push({ oldPath: parts[1], newPath: parts[2] });
        }
        continue;
      }

      if (status === 'D') {
        entries.push({ oldPath: parts[1] });
        continue;
      }

      entries.push({ oldPath: parts[1], newPath: parts[1] });
    }

    return entries;
  }

  private shouldAnalyzeFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const ext = path.extname(normalizedPath).toLowerCase();

    if (ext && this.binaryExtensions.has(ext)) {
      return false;
    }

    return !this.shouldExcludePath(normalizedPath);
  }

  private async computeFileHistogram(
    filePath: string,
    commitSha: string,
    defaultTimestamp: number
  ): Promise<EvolutionFileHistogram> {
    throwIfCancelled(this.signal);

    const histogram = createEmptyHistogram();

    let blameOutput: string;
    try {
      blameOutput = await this.git.raw([
        'blame',
        commitSha,
        '--line-porcelain',
        '--',
        filePath,
      ]);
      throwIfCancelled(this.signal);
    } catch (error) {
      if (isExpectedBlameMiss(error)) {
        this.expectedBlameMisses += 1;
        return histogram;
      }

      const detail = error instanceof Error ? error.message : String(error);
      throw new AnalyzerExecutionError(
        `Failed to run git blame for ${filePath} at ${commitSha}: ${detail}`,
        'EVOLUTION_BLAME_FAILED',
        { cause: error }
      );
    }

    const ext = path.extname(filePath) || EMPTY_EXT;
    const topDir = this.directoryBucketPrefix ?? getTopDirectory(filePath);
    const hunks = parseBlameStream(blameOutput, {
      defaultAuthor: UNKNOWN_AUTHOR,
      defaultEmail: UNKNOWN_EMAIL,
      defaultAuthorTime: defaultTimestamp,
    });

    for (const hunk of hunks) {
      const author = hunk.author;
      const email = hunk.email;
      const domain = email.includes('@') ? email.split('@').pop() || 'unknown.local' : 'unknown.local';
      const timestamp = hunk.authorTime;
      const cohort = formatCohort(timestamp, this.settings.evolution.cohortFormat);
      const lines = hunk.lines;

      incrementCount(histogram.cohort, cohort, lines);
      incrementCount(histogram.author, author, lines);
      incrementCount(histogram.ext, ext, lines);
      incrementCount(histogram.dir, topDir, lines);
      incrementCount(histogram.domain, domain, lines);
    }
    return histogram;
  }
}
