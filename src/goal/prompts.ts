import type { GoalRecord } from './types';

export function buildGoalContext(goal: GoalRecord): string {
  const checkpoints = goal.checkpoints.slice(-3).map((checkpoint) => {
    return `- ${checkpoint.createdAt}: ${checkpoint.note}`;
  });

  return [
    '<goal_context>',
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    goal.stopCondition ? `Stop condition: ${goal.stopCondition}` : undefined,
    goal.validationCommands.length > 0
      ? `Validation commands:\n${goal.validationCommands.map((cmd) => `- ${cmd}`).join('\n')}`
      : undefined,
    `Cycles: ${goal.completedCycles}/${goal.maxCycles}`,
    checkpoints.length > 0
      ? `Recent checkpoints:\n${checkpoints.join('\n')}`
      : undefined,
    '',
    'Goal instructions:',
    '- Keep the todo list aligned with this goal.',
    '- Continue normal specialist delegation when useful.',
    '- Validate through normal OpenCode tools and permissions.',
    '- If the goal is complete, say so clearly and stop working.',
    '- If blocked or user approval is needed, ask instead of continuing.',
    '</goal_context>',
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
}

export function buildGoalContinuationPrompt(goal: GoalRecord): string {
  return [
    `[Goal: continue working on active goal ${goal.id}.]`,
    `Objective: ${goal.objective}`,
    goal.stopCondition ? `Stop condition: ${goal.stopCondition}` : undefined,
    'Continue from the current todo state. If the goal is complete, report completion and stop. If blocked or you need user input, ask instead of continuing.',
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
}

export function buildGoalStartPrompt(goal: GoalRecord): string {
  return [
    `[Goal started: ${goal.id}]`,
    `Objective: ${goal.objective}`,
    goal.stopCondition ? `Stop condition: ${goal.stopCondition}` : undefined,
    'Create or update todos for this goal, then begin work. Validate through normal tools before declaring the goal complete.',
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
}
