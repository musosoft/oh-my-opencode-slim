/**
 * Command registration manager for fork functionality.
 *
 * Manages the /fork-session slash command registration and template.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { ForkState } from './state';

const COMMAND_NAME = 'fork-session';

/**
 * Compact command template that lets the user request drive fork behavior.
 */
const FORK_COMMAND_TEMPLATE = `Fork the current orchestrator context into a worker session.

Use the user's request as the source of truth. Pass the best current context, decisions, constraints, and file references the fork needs. Keep it compact.

USER: $ARGUMENTS

Call fork_session with the worker prompt and clearly relevant files:
\`fork_session(prompt="...", files=["src/foo.ts", "src/bar.ts", ...])\``;

/**
 * Creates a fork command manager.
 *
 * Handles registration of the /fork-session command and fork session state
 * events.
 */
export function createForkCommandManager(
  _ctx: PluginInput,
  state: ForkState,
  _processedSessions?: Set<string>,
) {
  /**
   * Register the /fork-session command in the OpenCode config.
   */
  function registerCommand(opencodeConfig: Record<string, unknown>): void {
    const configCommand = opencodeConfig.command as
      | Record<string, unknown>
      | undefined;
    if (!configCommand?.[COMMAND_NAME]) {
      if (!opencodeConfig.command) {
        opencodeConfig.command = {};
      }
      (opencodeConfig.command as Record<string, unknown>)[COMMAND_NAME] = {
        description: 'Fork the orchestrator context into a worker session',
        template: FORK_COMMAND_TEMPLATE,
      };
    }
  }

  return {
    registerCommand,
    handleEvent(input: {
      event: {
        type: string;
        properties?: {
          info?: { id?: string; parentID?: string };
          sessionID?: string;
        };
      };
    }): void {
      if (input.event.type === 'session.created') {
        const info = input.event.properties?.info;
        if (!info?.id || !info.parentID) return;

        const source = state.sourceFor(info.parentID);
        if (source) state.markSession(info.id, source);
        return;
      }

      if (input.event.type !== 'session.deleted') return;
      const sessionID =
        input.event.properties?.info?.id ?? input.event.properties?.sessionID;
      if (sessionID) state.unmarkSession(sessionID);
    },
  };
}

export type ForkCommandManager = ReturnType<typeof createForkCommandManager>;
