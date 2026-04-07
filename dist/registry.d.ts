/**
 * Pluggable skill registry interface + ClawHub implementation.
 *
 * Bridges to the `clawhub` CLI for search/install operations.
 * No new npm dependencies — requires the user to have `clawhub` installed globally.
 */
export interface SkillSearchResult {
    slug: string;
    name: string;
    description: string;
    version?: string;
    author?: string;
    downloads?: number;
}
export interface SkillInstallResult {
    name: string;
    version: string;
}
export interface SkillRegistry {
    readonly name: string;
    /** Check if the registry's CLI tool is available on PATH. */
    isAvailable(): boolean;
    /** Search for skills matching a natural-language query. */
    search(query: string, limit?: number): Promise<SkillSearchResult[]>;
    /** Install a skill by slug into destDir. */
    install(slug: string, destDir: string): Promise<SkillInstallResult>;
}
export declare class ClawHubRegistry implements SkillRegistry {
    readonly name = "clawhub";
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<SkillSearchResult[]>;
    /** Fetch detailed metadata for a single skill. */
    inspect(slug: string): Promise<SkillSearchResult>;
    install(slug: string, destDir: string): Promise<SkillInstallResult>;
}
/**
 * Registry backed by skills.sh — a community skill ecosystem.
 *
 * Uses `npx skills` CLI commands:
 *   - `npx skills search <query>` → ANSI-formatted text output
 *   - `npx skills add <owner>/<repo>@<skill>` → installs to cwd/skills/
 *
 * No global install required — npx handles fetching.
 */
export declare class SkillsShRegistry implements SkillRegistry {
    readonly name = "skills.sh";
    isAvailable(): boolean;
    search(query: string, limit?: number): Promise<SkillSearchResult[]>;
    install(slug: string, destDir: string): Promise<SkillInstallResult>;
}
export declare function getRegistry(name: string): SkillRegistry | undefined;
export declare function listRegistries(): string[];
//# sourceMappingURL=registry.d.ts.map