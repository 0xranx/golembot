export interface TokenMeta {
    /** SHA-256 prefix (first 8 hex chars) of the token — detects rotation. */
    tokenHash: string;
    /** ISO timestamp when this token was first seen by GolemBot. */
    firstSeenAt: string;
    /** Expected validity in days. Default: 365 (setup-token). */
    validityDays: number;
}
/**
 * Load token metadata from `.golem/token-meta.json`.
 * Returns `null` if the file does not exist.
 */
export declare function loadTokenMeta(golemDir: string): Promise<TokenMeta | null>;
/**
 * Ensure token metadata exists. Creates or resets the file when the token
 * hash changes (i.e. the user rotated the token).
 */
export declare function ensureTokenMeta(golemDir: string, token: string): Promise<TokenMeta>;
/** Estimated days until the token expires (based on first-seen date). */
export declare function daysUntilExpiry(meta: TokenMeta): number;
//# sourceMappingURL=token-meta.d.ts.map