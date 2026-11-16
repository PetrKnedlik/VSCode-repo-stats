---
name: git-analysis
description: Implement git analysis features using simple-git, handle contributor stats, commit history, and code frequency calculations
allowed-tools: Bash, Read, Grep, Glob, Write, Edit
---

# Git Analysis Skill

## When to Use
Apply this skill when:
- Implementing simple-git operations
- Calculating contributor statistics
- Building code frequency data
- Handling git edge cases

## simple-git Setup

### Initialize
```typescript
import simpleGit, { SimpleGit, LogResult } from 'simple-git';

export class GitAnalyzer {
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath, {
      binary: 'git',
      maxConcurrentProcesses: 6,
      trimmed: true,
    });
  }
}
```

## Common Operations

### Get All Contributors
```typescript
async getContributors(): Promise<ContributorStats[]> {
  const log = await this.git.log([
    '--all',
    '--format=%an|%ae|%ad|%H',
    '--date=iso',
  ]);

  const contributorMap = new Map<string, ContributorStats>();

  for (const commit of log.all) {
    const [name, email, date, hash] = commit.hash.split('|');
    // Aggregate by email (handles name variations)
    const key = email.toLowerCase();

    if (!contributorMap.has(key)) {
      contributorMap.set(key, {
        name,
        email,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
        firstCommit: new Date(date),
        lastCommit: new Date(date),
        weeklyActivity: [],
      });
    }

    const contributor = contributorMap.get(key)!;
    contributor.commits++;
    // Update date range
    const commitDate = new Date(date);
    if (commitDate < contributor.firstCommit) contributor.firstCommit = commitDate;
    if (commitDate > contributor.lastCommit) contributor.lastCommit = commitDate;
  }

  return Array.from(contributorMap.values())
    .sort((a, b) => b.commits - a.commits);
}
```

### Get Code Frequency (Additions/Deletions)
```typescript
async getCodeFrequency(): Promise<CodeFrequency[]> {
  const log = await this.git.log([
    '--all',
    '--numstat',
    '--format=COMMIT|%H|%ad',
    '--date=iso',
  ]);

  const weeklyData = new Map<string, CodeFrequency>();

  // Parse the raw output
  const lines = log.all[0]?.hash?.split('\n') || [];
  let currentWeek = '';

  for (const line of lines) {
    if (line.startsWith('COMMIT|')) {
      const [, , date] = line.split('|');
      currentWeek = getISOWeek(new Date(date));

      if (!weeklyData.has(currentWeek)) {
        weeklyData.set(currentWeek, {
          week: currentWeek,
          additions: 0,
          deletions: 0,
          netChange: 0,
        });
      }
    } else if (line.match(/^\d+\t\d+\t/)) {
      const [additions, deletions] = line.split('\t').map(Number);
      const data = weeklyData.get(currentWeek)!;
      data.additions += additions || 0;
      data.deletions += deletions || 0;
      data.netChange = data.additions - data.deletions;
    }
  }

  return Array.from(weeklyData.values())
    .sort((a, b) => a.week.localeCompare(b.week));
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
```

### Get Current HEAD SHA (for Cache Invalidation)
```typescript
async getHeadSha(): Promise<string> {
  return await this.git.revparse(['HEAD']);
}
```

### Get Changed Files Since Last Analysis
```typescript
async getChangedFiles(sinceCommit: string): Promise<string[]> {
  const diff = await this.git.diff(['--name-only', sinceCommit, 'HEAD']);
  return diff.split('\n').filter(Boolean);
}
```

### Check if Path is a Git Repository
```typescript
async isGitRepo(): Promise<boolean> {
  try {
    await this.git.revparse(['--git-dir']);
    return true;
  } catch {
    return false;
  }
}
```

## Error Handling

### Common Errors and Solutions
```typescript
export class NotAGitRepoError extends Error {
  constructor(path: string) {
    super(`Not a git repository: ${path}`);
    this.name = 'NotAGitRepoError';
  }
}

export class GitNotFoundError extends Error {
  constructor() {
    super('Git binary not found. Please ensure git is installed and in PATH.');
    this.name = 'GitNotFoundError';
  }
}

async safeGitOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (error.message?.includes('not a git repository')) {
      throw new NotAGitRepoError(this.repoPath);
    }
    if (error.message?.includes('ENOENT') && error.message?.includes('git')) {
      throw new GitNotFoundError();
    }
    throw error;
  }
}
```

## Performance Considerations

### For Large Repositories
```typescript
// Limit commits for initial load
async getRecentContributors(limit = 10000): Promise<ContributorStats[]> {
  const log = await this.git.log(['-n', String(limit), '--format=%an|%ae']);
  // Process...
}

// Use --since for time-bounded queries
async getContributorsSince(date: Date): Promise<ContributorStats[]> {
  const since = date.toISOString().split('T')[0];
  const log = await this.git.log(['--since', since, '--format=%an|%ae']);
  // Process...
}

// Stream for very large repos (100k+ commits)
async *streamCommits(): AsyncGenerator<CommitInfo> {
  const stream = this.git.log(['--all', '--format=%H|%an|%ae|%ad']);
  // Yield commits as they're parsed...
}
```

### Caching Strategy
```typescript
interface CacheEntry {
  headSha: string;
  timestamp: number;
  data: any;
}

class GitCache {
  constructor(private storage: vscode.Memento) {}

  async get<T>(key: string, headSha: string): Promise<T | null> {
    const entry = this.storage.get<CacheEntry>(key);
    if (entry && entry.headSha === headSha) {
      return entry.data as T;
    }
    return null;
  }

  async set<T>(key: string, headSha: string, data: T): Promise<void> {
    await this.storage.update(key, {
      headSha,
      timestamp: Date.now(),
      data,
    });
  }

  async invalidate(key: string): Promise<void> {
    await this.storage.update(key, undefined);
  }
}
```

## Edge Cases to Handle

1. **Empty repository** (no commits)
   - Return empty arrays, don't throw

2. **Detached HEAD state**
   - Still works, use revparse

3. **Shallow clone**
   - May have limited history, handle gracefully

4. **Binary files in numstat**
   - Shows as `-` for additions/deletions, skip these

5. **Renamed files**
   - Use `--follow` if tracking specific files

6. **Large diffs**
   - May timeout, use `--stat` instead of full diff
