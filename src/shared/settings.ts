import type {
  ExtensionSettings,
  RepoScopableSettingKey,
  RepoScopableSettingValueMap,
  RepoScopedSettings,
  ScopedSettingSource,
  ScopedSettingValue,
  SettingWriteTarget,
} from './contracts.js';

interface ScopedSettingLookup<T> {
  globalValue?: T;
  repoValue?: T;
}

interface ScopedSettingSeed<T> extends ScopedSettingLookup<T> {
  defaultValue?: T;
}

interface ConfigurationInspectSeed<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceFolderValue?: T;
}

function sorted(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function resolveScopedSettingSource<T>(setting: ScopedSettingLookup<T>): ScopedSettingSource {
  if (setting.repoValue !== undefined) {
    return 'repo';
  }
  if (setting.globalValue !== undefined) {
    return 'global';
  }
  return 'default';
}

export function buildScopedSettingValue<T>(seed: ScopedSettingSeed<T>): ScopedSettingValue<T> {
  if (seed.defaultValue === undefined) {
    throw new Error('Missing defaultValue for scoped setting. Check package.json configuration defaults.');
  }

  return {
    defaultValue: seed.defaultValue,
    globalValue: seed.globalValue,
    repoValue: seed.repoValue,
    source: resolveScopedSettingSource(seed),
  };
}

export function buildScopedSettingValueFromInspect<T>(inspect: ConfigurationInspectSeed<T>): ScopedSettingValue<T> {
  return buildScopedSettingValue({
    defaultValue: inspect.defaultValue,
    globalValue: inspect.globalValue,
    repoValue: inspect.workspaceFolderValue,
  });
}

function resolveScopedSettingDisplayValue<T>(setting: ScopedSettingValue<T>, target: SettingWriteTarget): T {
  if (target === 'repo') {
    return setting.repoValue ?? setting.globalValue ?? setting.defaultValue;
  }

  return setting.globalValue ?? setting.defaultValue;
}

export function getScopedSettingDisplayValue<K extends RepoScopableSettingKey>(
  scopedSettings: RepoScopedSettings,
  key: K,
  target: SettingWriteTarget
): RepoScopableSettingValueMap[K] {
  return resolveScopedSettingDisplayValue(scopedSettings[key], target);
}

const scopedSettingAppliers: {
  [K in RepoScopableSettingKey]: (
    settings: ExtensionSettings,
    value: RepoScopableSettingValueMap[K]
  ) => ExtensionSettings;
} = {
  excludePatterns: (settings, value) => ({ ...settings, excludePatterns: value }),
  generatedPatterns: (settings, value) => ({ ...settings, generatedPatterns: value }),
  binaryExtensions: (settings, value) => ({ ...settings, binaryExtensions: value }),
  locExcludedExtensions: (settings, value) => ({ ...settings, locExcludedExtensions: value }),
  maxCommitsToAnalyze: (settings, value) => ({ ...settings, maxCommitsToAnalyze: value }),
  'evolution.historyTraversalMode': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      historyTraversalMode: value,
    },
  }),
  'evolution.samplingMode': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      samplingMode: value,
    },
  }),
  'evolution.snapshotIntervalDays': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      snapshotIntervalDays: value,
    },
  }),
  'evolution.showInactivePeriods': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      showInactivePeriods: value,
    },
  }),
  'evolution.maxSnapshots': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      maxSnapshots: value,
    },
  }),
  'evolution.historyMonths': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      historyMonths: value,
    },
  }),
  'evolution.maxSeries': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      maxSeries: value,
    },
  }),
  'evolution.cohortFormat': (settings, value) => ({
    ...settings,
    evolution: {
      ...settings.evolution,
      cohortFormat: value,
    },
  }),
  commitMetadata: (settings, value) => ({ ...settings, commitMetadata: value }),
};

export function setScopedSettingValue<K extends RepoScopableSettingKey>(
  settings: ExtensionSettings,
  key: K,
  value: RepoScopableSettingValueMap[K]
): ExtensionSettings {
  return scopedSettingAppliers[key](settings, value);
}

export function applyScopedSettingUpdate<K extends RepoScopableSettingKey>(
  currentSettings: ExtensionSettings,
  currentScopedSettings: RepoScopedSettings,
  key: K,
  value: RepoScopableSettingValueMap[K],
  target: SettingWriteTarget
): { settings: ExtensionSettings; scopedSettings: RepoScopedSettings } {
  const nextEntry = {
    ...currentScopedSettings[key],
    globalValue: target === 'global' ? value : currentScopedSettings[key].globalValue,
    repoValue: target === 'repo' ? value : currentScopedSettings[key].repoValue,
    source: resolveScopedSettingSource({
      globalValue: target === 'global' ? value : currentScopedSettings[key].globalValue,
      repoValue: target === 'repo' ? value : currentScopedSettings[key].repoValue,
    }),
  };

  const nextScopedSettings: RepoScopedSettings = {
    ...currentScopedSettings,
    [key]: nextEntry,
  };

  return {
    settings: setScopedSettingValue(
      currentSettings,
      key,
      getScopedSettingDisplayValue(nextScopedSettings, key, 'repo')
    ),
    scopedSettings: nextScopedSettings,
  };
}

export function applySettingsPatch(
  currentSettings: ExtensionSettings,
  nextSettings: Partial<ExtensionSettings>
): ExtensionSettings {
  return {
    ...currentSettings,
    ...nextSettings,
    tooltipSettings: nextSettings.tooltipSettings
      ? {
          ...currentSettings.tooltipSettings,
          ...nextSettings.tooltipSettings,
        }
      : currentSettings.tooltipSettings,
    treemap: nextSettings.treemap
      ? {
          ...currentSettings.treemap,
          ...nextSettings.treemap,
        }
      : currentSettings.treemap,
    evolution: nextSettings.evolution
      ? {
          ...currentSettings.evolution,
          ...nextSettings.evolution,
        }
      : currentSettings.evolution,
    commitMetadata: nextSettings.commitMetadata
      ? {
          ...currentSettings.commitMetadata,
          ...nextSettings.commitMetadata,
        }
      : currentSettings.commitMetadata,
  };
}

export function createCoreAnalysisSettingsSnapshot(settings: ExtensionSettings): object {
  return {
    excludePatterns: sorted(settings.excludePatterns),
    maxCommitsToAnalyze: settings.maxCommitsToAnalyze,
    binaryExtensions: sorted(settings.binaryExtensions),
    locExcludedExtensions: sorted(settings.locExcludedExtensions),
  };
}

export function createEvolutionAnalysisSettingsSnapshot(settings: ExtensionSettings): object {
  return {
    excludePatterns: sorted(settings.excludePatterns),
    binaryExtensions: sorted(settings.binaryExtensions),
    evolution: {
      historyTraversalMode: settings.evolution.historyTraversalMode,
      samplingMode: settings.evolution.samplingMode,
      snapshotIntervalDays: settings.evolution.snapshotIntervalDays,
      maxSnapshots: settings.evolution.maxSnapshots,
      historyMonths: settings.evolution.historyMonths,
      maxFilesPerSnapshot: settings.evolution.maxFilesPerSnapshot,
      cohortFormat: settings.evolution.cohortFormat,
    },
  };
}

export function createCommitMetadataAnalysisSettingsSnapshot(settings: ExtensionSettings): object {
  return {
    maxCommitsToAnalyze: settings.maxCommitsToAnalyze,
    commitMetadata: settings.commitMetadata,
  };
}

export function settingsAffectCoreAnalysis(
  currentSettings: ExtensionSettings,
  nextSettings: ExtensionSettings
): boolean {
  return JSON.stringify(createCoreAnalysisSettingsSnapshot(currentSettings)) !==
    JSON.stringify(createCoreAnalysisSettingsSnapshot(nextSettings));
}

export function settingsAffectEvolutionAnalysis(
  currentSettings: ExtensionSettings,
  nextSettings: ExtensionSettings
): boolean {
  return JSON.stringify(createEvolutionAnalysisSettingsSnapshot(currentSettings)) !==
    JSON.stringify(createEvolutionAnalysisSettingsSnapshot(nextSettings));
}

export function settingsAffectCommitMetadataAnalysis(
  currentSettings: ExtensionSettings,
  nextSettings: ExtensionSettings
): boolean {
  return JSON.stringify(createCommitMetadataAnalysisSettingsSnapshot(currentSettings)) !==
    JSON.stringify(createCommitMetadataAnalysisSettingsSnapshot(nextSettings));
}
