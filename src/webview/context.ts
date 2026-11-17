import * as vscode from 'vscode';
import type {
  AnalysisTarget,
  AnalysisTargetOption,
  RepositoryOption,
} from '../types/index.js';

export interface RepositoryContext {
  option: RepositoryOption;
  rootUri: vscode.Uri;
  workspaceFolder?: vscode.WorkspaceFolder;
}

export interface RepositoryDiscoveryWarning {
  source: 'workspace' | 'bookmarked' | 'git-extension' | 'submodule';
  message: string;
  repositoryPath?: string;
}

export interface AnalysisTargetContext {
  option: AnalysisTargetOption;
  target: AnalysisTarget;
  settingsRepository?: RepositoryContext;
}

export interface AnalysisTargetSelection {
  repositories: RepositoryContext[];
  selectedRepositoryIds: string[];
  selectedTarget: AnalysisTargetContext | null;
  selectedTargetOption: AnalysisTargetOption | null;
  repositoryDiscoveryWarnings: RepositoryDiscoveryWarning[];
}
