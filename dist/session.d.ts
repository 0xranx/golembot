export interface HistoryEntry {
    ts: string;
    sessionKey: string;
    role: 'user' | 'assistant';
    content: string;
    durationMs?: number;
    costUsd?: number;
}
export declare function getHistoryPath(dir: string, sessionKey: string): string;
export declare function getFallbackSessionKey(sessionKey?: string): string | undefined;
export declare function loadSession(dir: string, key?: string, engineType?: string): Promise<string | undefined>;
export declare function saveSession(dir: string, sessionId: string, key?: string, engineType?: string): Promise<void>;
export declare function clearSession(dir: string, key?: string): Promise<void>;
export declare function clearHistory(dir: string, sessionKey?: string): Promise<void>;
export declare function resetConversation(dir: string, key?: string): Promise<void>;
export declare function pruneExpiredSessions(dir: string, maxAgeDays: number): Promise<void>;
export declare function countSessions(dir: string): Promise<number>;
export declare function listHistoryFiles(dir: string): Promise<string[]>;
export declare function readHistory(dir: string, sessionKey: string, limit?: number): Promise<HistoryEntry[]>;
export declare function appendHistory(dir: string, entry: HistoryEntry): Promise<void>;
//# sourceMappingURL=session.d.ts.map