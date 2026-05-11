import { describe, expect, test } from 'bun:test';
import { createForkCommandManager } from './command';
import { createForkState } from './state';

function createContext() {
  return {
    directory: '/tmp/test',
    client: {},
  } as any;
}

describe('createForkCommandManager', () => {
  test('registers the /fork command', () => {
    const manager = createForkCommandManager(
      createContext(),
      createForkState(),
    );
    const config: Record<string, unknown> = {};

    manager.registerCommand(config);

    const commands = config.command as Record<string, { template: string }>;
    expect(commands.fork).toBeDefined();
    expect(commands.fork.template).toContain('fork_session');
    expect(commands.fork.template).toContain('$ARGUMENTS');
  });

  test('marks child sessions of fork workers with the same source', () => {
    const state = createForkState();
    state.markSession('ses_worker', 'ses_source');
    const manager = createForkCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.created',
        properties: { info: { id: 'ses_child', parentID: 'ses_worker' } },
      },
    });

    expect(state.sourceFor('ses_child')).toBe('ses_source');
  });

  test('does not mark unrelated child sessions', () => {
    const state = createForkState();
    const manager = createForkCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.created',
        properties: { info: { id: 'ses_child', parentID: 'ses_parent' } },
      },
    });

    expect(state.isForkSession('ses_child')).toBe(false);
  });

  test('unmarks deleted fork sessions', () => {
    const state = createForkState();
    state.markSession('ses_worker', 'ses_source');
    const manager = createForkCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.deleted',
        properties: { info: { id: 'ses_worker' } },
      },
    });

    expect(state.isForkSession('ses_worker')).toBe(false);
  });
});
