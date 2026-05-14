export type GoalStatus =
  | 'running'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'archived';

export interface GoalCheckpoint {
  id: string;
  createdAt: string;
  note: string;
}

export interface GoalRecord {
  version: 1;
  id: string;
  directory: string;
  sessionID: string;
  objective: string;
  stopCondition?: string;
  validationCommands: string[];
  artifacts: string[];
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
  maxCycles: number;
  completedCycles: number;
  checkpoints: GoalCheckpoint[];
  lastError?: string;
}

export interface GoalConfig {
  maxCycles?: number;
  cooldownMs?: number;
  shouldManageSession?: (sessionID: string) => boolean;
}
