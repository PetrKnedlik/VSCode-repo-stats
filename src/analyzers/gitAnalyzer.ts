/**
 * Git Analyzer - Pure business logic for git operations.
 * This module has NO VSCode dependencies and is fully testable.
 */

import * as path from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  CommitAnalytics,
  RepositoryInfo,
  NotAGitRepoError,
  GitNotFoundError,
  GitOperationError,
} from '../types/index.js';
import { buildCommitAnalytics, parseCommitHistoryLog } from './commitAnalytics.js';

// ============================================================================
// Interfaces for Dependency Injection
// ============================================================================

/**
 * Only getRepoInfo() validates that the path is a git repository; callers must
 * call it first (the coordinator does) to avoid a git spawn per method.
 */
export interface GitClient {
  isRepo(): Promise<boolean>;
  getRepoInfo(): Promise<RepositoryInfo>;
  getCommitAnalytics(maxCommits: number, excludePatterns?: string[]): Promise<CommitAnalytics>;
  getFileModificationDates(): Promise<Map<string, string>>;
  getTrackedFiles(): Promise<string[]>;
  getHeadBlobShas(paths?: string[]): Promise<Map<string, string>>;
  raw(args: string[]): Promise<string>;
}

// ============================================================================
// Git Analyzer Implementation
// ============================================================================

export class GitAnalyzer implements GitClient {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath, { config: ['core.quotePath=false'] });
  }

  async isRepo(): Promise<boolean> {
    try {
      return await this.git.checkIsRepo();
    } catch {
      return false;
    }
  }

  async getRepoInfo(): Promise<RepositoryInfo> {
    if (!(await this.isRepo())) {
      throw new NotAGitRepoError(this.repoPath);
    }

    try {
      const [branch, headSha, commitCountRaw] = await Promise.all([
        this.git.revparse(['--abbrev-ref', 'HEAD']),
        this.git.revparse(['HEAD']),
        this.git.raw(['rev-list', 'HEAD', '--count']),
      ]);

      const name = this.getRepositoryName();
      const commitCount = Number.parseInt(commitCountRaw.trim(), 10);

      return {
        name,
        path: this.repoPath,
        branch: branch.trim(),
        commitCount: Number.isFinite(commitCount) ? commitCount : 0,
        headSha: headSha.trim(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new GitNotFoundError();
      }
      throw error;
    }
  }

  async getCommitAnalytics(
    maxCommits: number,
    excludePatterns: string[] = []
  ): Promise<CommitAnalytics> {
    const rawLog = await this.git.raw([
      'log',
      'HEAD',
      `--max-count=${maxCommits}`,
      '--no-renames',
      '--format=__COMMIT__%x1f%H%x1f%an%x1f%ae%x1f%aI%x1f%s',
      '--numstat',
    ]);

    return buildCommitAnalytics(
      parseCommitHistoryLog(rawLog, excludePatterns),
      this.repoPath
    );
  }

  /**
   * Get the last modification date from git history for all tracked files.
   * Returns a Map of relative file path -> ISO date string of last commit.
   */
  async getFileModificationDates(): Promise<Map<string, string>> {
    const fileModDates = new Map<string, string>();

    // Get the last commit date for each file using git log with name-only
    // Format: date\n\nfile1\nfile2\n\ndate\n\nfile3\n...
    const rawLog = await this.git.raw([
      'log',
      'HEAD',
      '--format=%aI',
      '--name-only',
    ]);

    const lines = rawLog.split('\n');
    let currentDate: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      // Check if this is a date line (ISO format)
      if (trimmed.match(/^\d{4}-\d{2}-\d{2}T/)) {
        currentDate = trimmed;
      } else if (currentDate) {
        // This is a file path - only set if not already set (we want most recent)
        if (!fileModDates.has(trimmed)) {
          fileModDates.set(trimmed, currentDate);
        }
      }
    }

    return fileModDates;
  }

  /**
   * Get all tracked files in the repository.
   * Returns an array of relative file paths.
   */
  async getTrackedFiles(): Promise<string[]> {
    const output = await this.git.raw(['ls-files']);
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  async getHeadBlobShas(paths?: string[]): Promise<Map<string, string>> {
    const filterSet = paths && paths.length > 0 ? new Set(paths) : null;
    const result = new Map<string, string>();

    try {
      const output = await this.git.raw(['ls-tree', '-r', '--full-tree', 'HEAD']);

      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const tabIndex = trimmed.indexOf('\t');
        if (tabIndex === -1) {
          continue;
        }

        const metadata = trimmed.slice(0, tabIndex);
        const filePath = trimmed.slice(tabIndex + 1);
        if (!filePath) {
          continue;
        }

        if (filterSet && !filterSet.has(filePath)) {
          continue;
        }

        const parts = metadata.split(/\s+/);
        // Format: <mode> <type> <sha>
        if (parts.length < 3 || parts[1] !== 'blob') {
          continue;
        }

        result.set(filePath, parts[2]);
      }
    } catch (error) {
      throw new GitOperationError(
        `Failed to read HEAD blob SHAs for repository "${this.repoPath}".`,
        'HEAD_BLOB_LOOKUP_FAILED',
        { cause: error }
      );
    }

    return result;
  }

  async raw(args: string[]): Promise<string> {
    return this.git.raw(args);
  }

  private getRepositoryName(): string {
    const name = path.basename(this.repoPath).trim();
    if (!name) {
      throw new Error(`Cannot derive repository name from path: "${this.repoPath}"`);
    }

    return name;
  }
}

// ============================================================================
// Factory Function for Dependency Injection
// ============================================================================

export function createGitAnalyzer(repoPath: string): GitClient {
  return new GitAnalyzer(repoPath);
}
