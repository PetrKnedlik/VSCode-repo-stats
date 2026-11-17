import type {
  ExtensionSettings,
  EvolutionHistoryTraversalMode,
  EvolutionSamplingMode,
  RepoScopableSettingKey,
  RepoScopableSettingValueMap,
  ScopedSettingUpdateMessage,
  SettingWriteTarget,
  WebviewMessage,
} from '../types/index.js';
import { REPO_SCOPABLE_SETTING_KEYS } from '../types/index.js';

const SETTING_WRITE_TARGETS = ['global', 'repo'] as const satisfies readonly SettingWriteTarget[];
const EVOLUTION_SAMPLING_MODES = ['time', 'commit', 'auto'] as const satisfies readonly EvolutionSamplingMode[];
const EVOLUTION_HISTORY_TRAVERSAL_MODES = ['firstParent', 'full'] as const satisfies readonly EvolutionHistoryTraversalMode[];
const COMMIT_METADATA_BUCKET_MODES = ['calendar', 'commitCount'] as const;
const COMMIT_METADATA_CALENDAR_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
const COMMIT_METADATA_BUCKET_STRATEGIES = ['fixedSize', 'equalBuckets'] as const;
const COMMIT_METADATA_METRICS = ['commits', 'additions', 'deletions', 'changedLines', 'filesChanged'] as const;
const COMMIT_METADATA_CHART_TYPES = ['stackedBar', 'normalizedStackedBar', 'heatmap'] as const;
const COMMIT_METADATA_MULTI_VALUE_MODES = ['countEach', 'split', 'first'] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function isSettingWriteTarget(value: unknown): value is SettingWriteTarget {
  return isEnumValue(value, SETTING_WRITE_TARGETS);
}

function isRepoScopableSettingKey(value: unknown): value is RepoScopableSettingKey {
  return typeof value === 'string' && REPO_SCOPABLE_SETTING_KEYS.includes(value as RepoScopableSettingKey);
}

function isCommitMetadataSettings(value: unknown): value is ExtensionSettings['commitMetadata'] {
  if (!isRecord(value)) {
    return false;
  }

  return Array.isArray(value.extractors)
    && typeof value.defaultExtractorId === 'string'
    && isEnumValue(value.defaultBucketMode, COMMIT_METADATA_BUCKET_MODES)
    && isEnumValue(value.defaultCalendarGranularity, COMMIT_METADATA_CALENDAR_GRANULARITIES)
    && isEnumValue(value.defaultCommitBucketStrategy, COMMIT_METADATA_BUCKET_STRATEGIES)
    && isNumber(value.defaultCommitBucketSize)
    && isNumber(value.defaultCommitBucketCount)
    && isEnumValue(value.defaultMetric, COMMIT_METADATA_METRICS)
    && isEnumValue(value.defaultChartType, COMMIT_METADATA_CHART_TYPES)
    && isEnumValue(value.multiValueMode, COMMIT_METADATA_MULTI_VALUE_MODES)
    && isBoolean(value.includeUncategorized)
    && isNumber(value.maxSeries)
    && isBoolean(value.includeOtherSeries);
}

function isScopedSettingValue<K extends RepoScopableSettingKey>(
  key: K,
  value: unknown
): value is RepoScopableSettingValueMap[K] {
  switch (key) {
    case 'excludePatterns':
    case 'generatedPatterns':
    case 'binaryExtensions':
    case 'locExcludedExtensions':
      return isStringArray(value);
    case 'maxCommitsToAnalyze':
    case 'evolution.snapshotIntervalDays':
    case 'evolution.maxSnapshots':
    case 'evolution.historyMonths':
    case 'evolution.maxSeries':
      return isNumber(value);
    case 'evolution.showInactivePeriods':
      return isBoolean(value);
    case 'evolution.historyTraversalMode':
      return isEnumValue(value, EVOLUTION_HISTORY_TRAVERSAL_MODES);
    case 'evolution.samplingMode':
      return isEnumValue(value, EVOLUTION_SAMPLING_MODES);
    case 'evolution.cohortFormat':
      return typeof value === 'string';
    case 'commitMetadata':
      return isCommitMetadataSettings(value);
    default:
      return false;
  }
}

function createScopedSettingUpdateMessage<K extends RepoScopableSettingKey>(
  key: K,
  value: RepoScopableSettingValueMap[K],
  target: SettingWriteTarget
): ScopedSettingUpdateMessage<K> {
  return {
    type: 'updateScopedSetting',
    key,
    value,
    target,
  } as ScopedSettingUpdateMessage<K>;
}

function isPathMessagePayload(record: UnknownRecord): record is UnknownRecord & { path: string; repositoryId?: string } {
  return typeof record.path === 'string'
    && (record.repositoryId === undefined || typeof record.repositoryId === 'string');
}

export function validateLogicalPath(logicalPath: string): void {
  if (logicalPath.length === 0) {
    throw new Error('Repo Stats received an empty path from the webview.');
  }

  if (logicalPath.includes('\0')) {
    throw new Error('Repo Stats rejected a path with invalid characters from the webview.');
  }

  const normalized = logicalPath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new Error('Repo Stats rejected an absolute path from the webview.');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Repo Stats rejected a path traversal request from the webview.');
  }
}

export function resolveContainedPath(repoPath: string, relativePath: string, pathModule: Pick<typeof import('path'), 'resolve' | 'sep'>): string {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  if (normalizedRelativePath.length > 0) {
    const segments = normalizedRelativePath.split('/');
    if (segments.some((segment) => segment === '..')) {
      throw new Error('Repo Stats rejected a path outside the selected repository.');
    }
  }

  const resolvedRepoPath = pathModule.resolve(repoPath);
  const resolvedTargetPath = pathModule.resolve(resolvedRepoPath, normalizedRelativePath);
  if (
    resolvedTargetPath !== resolvedRepoPath
    && !resolvedTargetPath.startsWith(`${resolvedRepoPath}${pathModule.sep}`)
  ) {
    throw new Error('Repo Stats rejected a path outside the selected repository.');
  }

  return resolvedTargetPath;
}

export function parseWebviewMessage(message: unknown): WebviewMessage {
  if (!isRecord(message) || typeof message.type !== 'string') {
    throw new Error('Received malformed webview message payload.');
  }

  switch (message.type) {
    case 'requestAnalysis':
    case 'requestRefresh':
    case 'cancelAnalysis':
    case 'requestEvolutionAnalysis':
    case 'requestEvolutionRefresh':
    case 'cancelEvolutionAnalysis':
    case 'checkStaleness':
    case 'getSettings':
      return { type: message.type };

    case 'updateRepositorySelection':
      if (!isStringArray(message.repositoryIds)) {
        throw new Error('Expected repositoryIds to be an array of strings.');
      }
      return { type: 'updateRepositorySelection', repositoryIds: message.repositoryIds };

    case 'openFile':
    case 'revealInExplorer':
      if (!isPathMessagePayload(message)) {
        throw new Error(`Expected ${message.type} to include a string path payload.`);
      }
      return {
        type: message.type,
        path: message.path,
        repositoryId: message.repositoryId,
      };

    case 'copyPath':
      if (!isPathMessagePayload(message)) {
        throw new Error('Expected copyPath to include a string path payload.');
      }
      return { type: 'copyPath', path: message.path, repositoryId: message.repositoryId };

    case 'updateScopedSetting':
      if (!isRepoScopableSettingKey(message.key)) {
        throw new Error('Received invalid scoped setting key from webview.');
      }
      if (!isSettingWriteTarget(message.target)) {
        throw new Error('Received invalid scoped setting target from webview.');
      }
      if (!isScopedSettingValue(message.key, message.value)) {
        throw new Error(`Received invalid value for scoped setting ${message.key}.`);
      }
      return createScopedSettingUpdateMessage(message.key, message.value, message.target);

    default:
      throw new Error(`Received unknown webview message type: ${message.type}`);
  }
}
