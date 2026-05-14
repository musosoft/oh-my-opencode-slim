import type { PluginInput } from '@opencode-ai/plugin';
import {
  createInternalAgentTextPart,
  log,
  SLIM_INTERNAL_INITIATOR_MARKER,
} from '../utils';
import {
  buildGoalContext,
  buildGoalContinuationPrompt,
  buildGoalStartPrompt,
} from './prompts';
import { GoalStore } from './store';
import type { GoalConfig, GoalRecord } from './types';

const COMMAND_NAME = 'goal';
const HOOK_NAME = 'goal';
const SUPPRESS_AFTER_ABORT_MS = 5_000;
const DEFAULT_MAX_CYCLES = 10;
const DEFAULT_COOLDOWN_MS = 3_000;

interface GoalRuntimeState {
  pendingTimersBySession: Map<string, ReturnType<typeof setTimeout>>;
  suppressUntilBySession: Map<string, number>;
  isInjectingBySession: Set<string>;
  orchestratorSessionIds: Set<string>;
}

interface MessagePart {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface ChatTransformMessage {
  info: {
    role?: string;
    agent?: string;
    sessionID?: string;
  };
  parts: MessagePart[];
}

interface Message {
  info?: { role?: string };
  parts?: MessagePart[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function createGoalId(): string {
  return `goal-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function isQuestion(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  return (
    /\?\s*$/.test(lowerText) ||
    lowerText.includes('should i') ||
    lowerText.includes('do you want') ||
    lowerText.includes('please review') ||
    lowerText.includes('can you confirm') ||
    lowerText.includes('let me know')
  );
}

function commandName(input: string): string {
  return input.replace(/^\//, '').trim().toLowerCase();
}

export function createGoalManager(ctx: PluginInput, config?: GoalConfig) {
  const store = new GoalStore();
  const maxCycles = config?.maxCycles ?? DEFAULT_MAX_CYCLES;
  const cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const shouldManageSession = config?.shouldManageSession;
  const state: GoalRuntimeState = {
    pendingTimersBySession: new Map(),
    suppressUntilBySession: new Map(),
    isInjectingBySession: new Set(),
    orchestratorSessionIds: new Set(),
  };

  function registerCommand(opencodeConfig: Record<string, unknown>): void {
    const configCommand = opencodeConfig.command as
      | Record<string, unknown>
      | undefined;
    if (!configCommand?.[COMMAND_NAME]) {
      if (!opencodeConfig.command) {
        opencodeConfig.command = {};
      }
      (opencodeConfig.command as Record<string, unknown>)[COMMAND_NAME] = {
        template: 'Manage a durable objective for long-running work',
        description:
          'Start, inspect, pause, resume, or clear a durable objective',
      };
    }
  }

  function activeGoal(sessionID: string): GoalRecord | undefined {
    return store.findActiveBySession(sessionID);
  }

  function hasRunningGoal(sessionID: string): boolean {
    return activeGoal(sessionID)?.status === 'running';
  }

  function hasActiveGoal(sessionID: string): boolean {
    return activeGoal(sessionID) !== undefined;
  }

  function canManageSession(sessionID: string): boolean {
    return shouldManageSession?.(sessionID) ?? true;
  }

  function cancelPendingTimer(sessionID?: string): void {
    if (sessionID) {
      const timer = state.pendingTimersBySession.get(sessionID);
      if (!timer) return;
      clearTimeout(timer);
      state.pendingTimersBySession.delete(sessionID);
      return;
    }

    for (const timer of state.pendingTimersBySession.values()) {
      clearTimeout(timer);
    }
    state.pendingTimersBySession.clear();
  }

  async function startGoal(
    input: { sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ): Promise<void> {
    const objective = input.arguments.replace(/^start\s+/i, '').trim();
    if (!canManageSession(input.sessionID)) {
      output.parts.push(
        createInternalAgentTextPart(
          'Goal can only be started from an orchestrator session.',
        ),
      );
      return;
    }

    if (!objective) {
      output.parts.push(
        createInternalAgentTextPart('Usage: /goal start <objective>'),
      );
      return;
    }

    const previous = activeGoal(input.sessionID);
    if (previous) {
      output.parts.push(
        createInternalAgentTextPart(
          `An active goal already exists: ${previous.objective}\nClear it before starting another goal.`,
        ),
      );
      return;
    }

    const timestamp = nowIso();
    const goal: GoalRecord = {
      version: 1,
      id: createGoalId(),
      directory: ctx.directory,
      sessionID: input.sessionID,
      objective,
      validationCommands: [],
      artifacts: [],
      status: 'running',
      createdAt: timestamp,
      updatedAt: timestamp,
      maxCycles,
      completedCycles: 0,
      checkpoints: [
        {
          id: createGoalId(),
          createdAt: timestamp,
          note: 'Goal started',
        },
      ],
    };
    store.save(goal);
    state.orchestratorSessionIds.add(input.sessionID);

    output.parts.push(createInternalAgentTextPart(buildGoalStartPrompt(goal)));
  }

  function formatGoalStatus(goal: GoalRecord): string {
    const checkpoints = goal.checkpoints.slice(-3);
    return [
      `Goal ${goal.id}`,
      `Status: ${goal.status}`,
      `Objective: ${goal.objective}`,
      goal.stopCondition ? `Stop condition: ${goal.stopCondition}` : undefined,
      `Cycles: ${goal.completedCycles}/${goal.maxCycles}`,
      goal.validationCommands.length > 0
        ? `Validation: ${goal.validationCommands.join(', ')}`
        : undefined,
      checkpoints.length > 0
        ? `Recent checkpoints:\n${checkpoints
            .map(
              (checkpoint) => `- ${checkpoint.createdAt}: ${checkpoint.note}`,
            )
            .join('\n')}`
        : undefined,
    ]
      .filter((part): part is string => typeof part === 'string')
      .join('\n');
  }

  async function handleCommandExecuteBefore(
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ): Promise<void> {
    if (commandName(input.command) !== COMMAND_NAME) return;

    state.orchestratorSessionIds.add(input.sessionID);
    output.parts.length = 0;

    const arg = input.arguments.trim();
    if (!arg) {
      const goal = activeGoal(input.sessionID);
      output.parts.push(
        createInternalAgentTextPart(
          goal
            ? formatGoalStatus(goal)
            : 'No active goal for this session. Start one with /goal start <objective>.',
        ),
      );
      return;
    }

    const [action = 'status'] = arg.split(/\s+/, 1);
    const normalizedAction = action.toLowerCase();

    if (normalizedAction === 'start') {
      await startGoal(input, output);
      return;
    }

    let goal = activeGoal(input.sessionID);
    if (!goal) {
      if (normalizedAction === 'resume') {
        goal = store.findLatestByDirectory(ctx.directory);
      }

      if (!goal) {
        output.parts.push(
          createInternalAgentTextPart(
            'No active goal for this session. Start one with /goal start <objective>.',
          ),
        );
        return;
      }
    }

    if (!canManageSession(input.sessionID)) {
      output.parts.push(
        createInternalAgentTextPart(
          'Goal commands can only manage orchestrator sessions.',
        ),
      );
      return;
    }

    if (normalizedAction === 'status' || normalizedAction === 'goal') {
      output.parts.push(createInternalAgentTextPart(formatGoalStatus(goal)));
      return;
    }

    if (normalizedAction === 'pause') {
      goal.status = 'paused';
      goal.updatedAt = nowIso();
      goal.checkpoints.push({
        id: createGoalId(),
        createdAt: goal.updatedAt,
        note: arg.replace(/^pause\s*/i, '').trim() || 'Paused by user',
      });
      store.save(goal);
      cancelPendingTimer(input.sessionID);
      output.parts.push(createInternalAgentTextPart('Goal paused.'));
      return;
    }

    if (normalizedAction === 'resume') {
      goal.status = 'running';
      goal.sessionID = input.sessionID;
      goal.updatedAt = nowIso();
      goal.checkpoints.push({
        id: createGoalId(),
        createdAt: goal.updatedAt,
        note: 'Resumed by user',
      });
      store.save(goal);
      output.parts.push(
        createInternalAgentTextPart(buildGoalContinuationPrompt(goal)),
      );
      return;
    }

    if (normalizedAction === 'complete') {
      goal.status = 'completed';
      goal.updatedAt = nowIso();
      goal.checkpoints.push({
        id: createGoalId(),
        createdAt: goal.updatedAt,
        note: arg.replace(/^complete\s*/i, '').trim() || 'Completed by user',
      });
      store.save(goal);
      cancelPendingTimer(input.sessionID);
      output.parts.push(createInternalAgentTextPart('Goal completed.'));
      return;
    }

    if (normalizedAction === 'block' || normalizedAction === 'blocked') {
      const reason = arg.replace(/^block(?:ed)?\s*/i, '').trim();
      goal.status = 'blocked';
      goal.lastError = reason || 'Blocked by user';
      goal.updatedAt = nowIso();
      goal.checkpoints.push({
        id: createGoalId(),
        createdAt: goal.updatedAt,
        note: goal.lastError,
      });
      store.save(goal);
      cancelPendingTimer(input.sessionID);
      output.parts.push(createInternalAgentTextPart('Goal blocked.'));
      return;
    }

    if (normalizedAction === 'clear') {
      goal.status = 'archived';
      goal.updatedAt = nowIso();
      store.save(goal);
      cancelPendingTimer(input.sessionID);
      output.parts.push(createInternalAgentTextPart('Goal cleared.'));
      return;
    }

    if (normalizedAction === 'checkpoint') {
      const note = arg.replace(/^checkpoint\s*/i, '').trim();
      goal.updatedAt = nowIso();
      goal.checkpoints.push({
        id: createGoalId(),
        createdAt: goal.updatedAt,
        note: note || 'Manual checkpoint',
      });
      store.save(goal);
      output.parts.push(createInternalAgentTextPart('Goal checkpoint saved.'));
      return;
    }

    output.parts.push(
      createInternalAgentTextPart(
        'Usage: /goal start <objective> | /goal status | /goal pause | /goal resume | /goal complete | /goal block <reason> | /goal checkpoint <note> | /goal clear',
      ),
    );
  }

  async function handleMessagesTransform(output: {
    messages: ChatTransformMessage[];
  }): Promise<void> {
    const latestUser = [...output.messages]
      .reverse()
      .find((message) => message.info.role === 'user');
    if (!latestUser) return;

    const sessionID = latestUser.info.sessionID;
    if (!sessionID) return;
    if (!canManageSession(sessionID)) return;
    if (latestUser.info.agent && latestUser.info.agent !== 'orchestrator')
      return;

    const goal = activeGoal(sessionID);
    if (!goal) return;

    const textPart = [...latestUser.parts]
      .reverse()
      .find((part) => part.type === 'text' && typeof part.text === 'string');
    if (!textPart) return;
    if (textPart.text?.includes(SLIM_INTERNAL_INITIATOR_MARKER)) return;

    const goalContext = buildGoalContext(goal);
    if (textPart.text?.includes('<goal_context>')) return;
    textPart.text = textPart.text
      ? `${textPart.text.trimEnd()}\n\n${goalContext}`
      : goalContext;
  }

  async function handleEvent(input: {
    event: { type: string; properties?: Record<string, unknown> };
  }): Promise<void> {
    const { event } = input;
    const properties = event.properties ?? {};

    if (event.type === 'session.deleted') {
      const sessionID =
        (properties.info as { id?: string } | undefined)?.id ??
        (properties.sessionID as string | undefined);
      if (!sessionID) return;
      cancelPendingTimer(sessionID);
      state.orchestratorSessionIds.delete(sessionID);
      state.isInjectingBySession.delete(sessionID);
      state.suppressUntilBySession.delete(sessionID);
      return;
    }

    if (event.type === 'session.error') {
      const sessionID = properties.sessionID as string | undefined;
      const error = properties.error as { name?: string } | undefined;
      if (!sessionID) return;
      cancelPendingTimer(sessionID);
      if (
        error?.name === 'MessageAbortedError' ||
        error?.name === 'AbortError'
      ) {
        state.suppressUntilBySession.set(
          sessionID,
          Date.now() + SUPPRESS_AFTER_ABORT_MS,
        );
      }
      return;
    }

    if (event.type === 'session.status') {
      const status = properties.status as { type?: string } | undefined;
      const sessionID = properties.sessionID as string | undefined;
      if (status?.type === 'busy' && sessionID) {
        cancelPendingTimer(sessionID);
      }
    }

    const isIdle =
      event.type === 'session.idle' ||
      (event.type === 'session.status' &&
        (properties.status as { type?: string } | undefined)?.type === 'idle');
    if (!isIdle) return;

    const sessionID = properties.sessionID as string | undefined;
    if (!sessionID) return;
    if (!canManageSession(sessionID)) return;

    const goal = activeGoal(sessionID);
    if (!goal || goal.status !== 'running') return;

    if (goal.completedCycles >= goal.maxCycles) {
      goal.status = 'blocked';
      goal.lastError = 'Goal reached max continuation cycles';
      goal.updatedAt = nowIso();
      store.save(goal);
      return;
    }

    if ((state.suppressUntilBySession.get(sessionID) ?? 0) > Date.now()) return;
    if (
      state.pendingTimersBySession.has(sessionID) ||
      state.isInjectingBySession.has(sessionID)
    )
      return;

    try {
      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      });
      const messages = messagesResult.data as Message[];
      const lastAssistant = messages
        .slice()
        .reverse()
        .find((message) => message.info?.role === 'assistant');
      const text = lastAssistant?.parts
        ?.map((part) => part.text ?? '')
        .join(' ');
      if (text && isQuestion(text)) return;
    } catch (error) {
      log(`[${HOOK_NAME}] failed to fetch messages`, {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const timer = setTimeout(async () => {
      state.pendingTimersBySession.delete(sessionID);

      const latestGoal = activeGoal(sessionID);
      if (!latestGoal || latestGoal.status !== 'running') return;

      state.isInjectingBySession.add(sessionID);
      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [
              createInternalAgentTextPart(
                buildGoalContinuationPrompt(latestGoal),
              ),
            ],
          },
        });
        latestGoal.completedCycles++;
        latestGoal.updatedAt = nowIso();
        store.save(latestGoal);
      } catch (error) {
        log(`[${HOOK_NAME}] failed to inject continuation`, {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        state.isInjectingBySession.delete(sessionID);
      }
    }, cooldownMs);
    state.pendingTimersBySession.set(sessionID, timer);
  }

  return {
    registerCommand,
    handleCommandExecuteBefore,
    handleMessagesTransform,
    handleEvent,
    hasActiveGoal,
    hasRunningGoal,
  };
}

export type GoalManager = ReturnType<typeof createGoalManager>;
