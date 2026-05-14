import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SLIM_INTERNAL_INITIATOR_MARKER } from '../utils';
import { createGoalManager } from './manager';

function createMockContext() {
  return {
    directory: '/tmp/project',
    client: {
      session: {
        messages: mock(async () => ({ data: [] })),
        prompt: mock(async () => ({})),
      },
    },
  } as any;
}

function createOutput() {
  return { parts: [] as Array<{ type: string; text?: string }> };
}

function outputText(output: ReturnType<typeof createOutput>): string {
  return output.parts.map((part) => part.text ?? '').join('\n');
}

let previousXdgDataHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  previousXdgDataHome = process.env.XDG_DATA_HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-goal-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (previousXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousXdgDataHome;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('createGoalManager', () => {
  test('registers /goal command', () => {
    const manager = createGoalManager(createMockContext());
    const config: Record<string, unknown> = {};

    manager.registerCommand(config);

    expect((config.command as Record<string, unknown>).goal).toBeDefined();
  });

  test('starts and reports a goal', async () => {
    const manager = createGoalManager(createMockContext());
    const startOutput = createOutput();

    await manager.handleCommandExecuteBefore(
      {
        command: 'goal',
        sessionID: 's1',
        arguments: 'start Fix failing tests',
      },
      startOutput,
    );

    expect(outputText(startOutput)).toContain('Goal started');
    expect(outputText(startOutput)).toContain('Fix failing tests');
    expect(manager.hasRunningGoal('s1')).toBe(true);

    const statusOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: '' },
      statusOutput,
    );

    expect(outputText(statusOutput)).toContain('Status: running');
    expect(outputText(statusOutput)).toContain('Fix failing tests');
  });

  test('pauses, resumes, and clears a goal', async () => {
    const manager = createGoalManager(createMockContext());
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Ship docs' },
      createOutput(),
    );

    const pauseOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'pause waiting' },
      pauseOutput,
    );
    expect(outputText(pauseOutput)).toContain('Goal paused');
    expect(manager.hasRunningGoal('s1')).toBe(false);

    const resumeOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'resume' },
      resumeOutput,
    );
    expect(outputText(resumeOutput)).toContain('continue working');
    expect(manager.hasRunningGoal('s1')).toBe(true);

    const clearOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'clear' },
      clearOutput,
    );
    expect(outputText(clearOutput)).toContain('Goal cleared');
    expect(manager.hasRunningGoal('s1')).toBe(false);
  });

  test('completes and blocks goals', async () => {
    const manager = createGoalManager(createMockContext());
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Ship docs' },
      createOutput(),
    );

    const completeOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'complete tests pass' },
      completeOutput,
    );
    expect(outputText(completeOutput)).toContain('Goal completed');
    expect(manager.hasActiveGoal('s1')).toBe(false);

    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Fix bug' },
      createOutput(),
    );
    const blockOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'block needs review' },
      blockOutput,
    );
    expect(outputText(blockOutput)).toContain('Goal blocked');
    expect(manager.hasActiveGoal('s1')).toBe(true);
    expect(manager.hasRunningGoal('s1')).toBe(false);
  });

  test('resumes latest directory goal into current session', async () => {
    const manager = createGoalManager(createMockContext());
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 'old', arguments: 'start Resume me' },
      createOutput(),
    );

    const resumeOutput = createOutput();
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 'new', arguments: 'resume' },
      resumeOutput,
    );

    expect(outputText(resumeOutput)).toContain('Resume me');
    expect(manager.hasRunningGoal('new')).toBe(true);
  });

  test('injects goal context into orchestrator messages', async () => {
    const manager = createGoalManager(createMockContext());
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Fix bug' },
      createOutput(),
    );

    const output = {
      messages: [
        {
          info: { role: 'user', agent: 'orchestrator', sessionID: 's1' },
          parts: [{ type: 'text', text: 'continue' }],
        },
      ],
    };

    await manager.handleMessagesTransform(output);

    expect(output.messages[0].parts[0].text).toContain('<goal_context>');
    expect(output.messages[0].parts[0].text).toContain('Fix bug');
  });

  test('does not inject goal context into internal prompts', async () => {
    const manager = createGoalManager(createMockContext());
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Fix bug' },
      createOutput(),
    );

    const output = {
      messages: [
        {
          info: { role: 'user', agent: 'orchestrator', sessionID: 's1' },
          parts: [{ type: 'text', text: SLIM_INTERNAL_INITIATOR_MARKER }],
        },
      ],
    };

    await manager.handleMessagesTransform(output);

    expect(output.messages[0].parts[0].text).not.toContain('<goal_context>');
  });

  test('does not manage non-orchestrator sessions when gated', async () => {
    const manager = createGoalManager(createMockContext(), {
      shouldManageSession: (sessionID) => sessionID === 'orchestrator',
    });
    const output = createOutput();

    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 'child', arguments: 'start no' },
      output,
    );

    expect(outputText(output)).toContain('orchestrator session');
    expect(manager.hasRunningGoal('child')).toBe(false);
  });

  test('continues a running goal on idle', async () => {
    const ctx = createMockContext();
    const manager = createGoalManager(ctx, { cooldownMs: 1, maxCycles: 2 });
    await manager.handleCommandExecuteBefore(
      { command: 'goal', sessionID: 's1', arguments: 'start Finish work' },
      createOutput(),
    );

    await manager.handleEvent({
      event: {
        type: 'session.status',
        properties: { sessionID: 's1', status: { type: 'idle' } },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctx.client.session.prompt).toHaveBeenCalledTimes(1);
    expect(
      ctx.client.session.prompt.mock.calls[0][0].body.parts[0].text,
    ).toContain('continue working');
  });
});
