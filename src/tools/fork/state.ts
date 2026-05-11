export interface ForkState {
  markSession(sessionID: string, sourceSessionID: string): void;
  unmarkSession(sessionID: string): void;
  isForkSession(sessionID: string): boolean;
  sourceFor(sessionID: string): string | undefined;
}

export function createForkState(): ForkState {
  const sourceBySession = new Map<string, string>();

  return {
    markSession(sessionID: string, sourceSessionID: string): void {
      sourceBySession.set(sessionID, sourceSessionID);
    },
    unmarkSession(sessionID: string): void {
      sourceBySession.delete(sessionID);
    },
    isForkSession(sessionID: string): boolean {
      return sourceBySession.has(sessionID);
    },
    sourceFor(sessionID: string): string | undefined {
      return sourceBySession.get(sessionID);
    },
  };
}
