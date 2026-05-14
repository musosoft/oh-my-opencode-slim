import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GoalRecord } from './types';

const STATE_DIR = 'oh-my-opencode-slim';
const STATE_FILE = 'goals.json';

interface GoalStoreSnapshot {
  version: 1;
  goals: GoalRecord[];
}

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

export function getGoalStorePath(): string {
  return path.join(dataDir(), 'opencode', 'storage', STATE_DIR, STATE_FILE);
}

function emptySnapshot(): GoalStoreSnapshot {
  return { version: 1, goals: [] };
}

function isGoalRecord(value: unknown): value is GoalRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GoalRecord>;
  return (
    record.version === 1 &&
    typeof record.id === 'string' &&
    typeof record.directory === 'string' &&
    typeof record.sessionID === 'string' &&
    typeof record.objective === 'string' &&
    typeof record.status === 'string' &&
    Array.isArray(record.validationCommands) &&
    Array.isArray(record.artifacts) &&
    Array.isArray(record.checkpoints)
  );
}

function parseSnapshot(value: string): GoalStoreSnapshot {
  const parsed = JSON.parse(value) as Partial<GoalStoreSnapshot> | undefined;
  if (parsed?.version !== 1 || !Array.isArray(parsed.goals)) {
    return emptySnapshot();
  }

  return {
    version: 1,
    goals: parsed.goals.filter(isGoalRecord),
  };
}

export class GoalStore {
  read(): GoalStoreSnapshot {
    try {
      return parseSnapshot(fs.readFileSync(getGoalStorePath(), 'utf8'));
    } catch {
      return emptySnapshot();
    }
  }

  write(snapshot: GoalStoreSnapshot): void {
    const filePath = getGoalStorePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  list(): GoalRecord[] {
    return this.read().goals;
  }

  save(goal: GoalRecord): void {
    const snapshot = this.read();
    const existingIndex = snapshot.goals.findIndex(
      (item) => item.id === goal.id,
    );
    if (existingIndex === -1) {
      snapshot.goals.push(goal);
    } else {
      snapshot.goals[existingIndex] = goal;
    }
    this.write(snapshot);
  }

  findActiveBySession(sessionID: string): GoalRecord | undefined {
    return this.list()
      .filter(
        (goal) =>
          goal.sessionID === sessionID &&
          (goal.status === 'running' ||
            goal.status === 'paused' ||
            goal.status === 'blocked'),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  findLatestByDirectory(directory: string): GoalRecord | undefined {
    return this.list()
      .filter(
        (goal) =>
          goal.directory === directory &&
          (goal.status === 'running' ||
            goal.status === 'paused' ||
            goal.status === 'blocked'),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
}
