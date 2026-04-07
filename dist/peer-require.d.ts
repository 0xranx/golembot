/**
 * Resolve and import optional peer-dependencies from the bot's working
 * directory when GolemBot is installed globally.
 *
 * Problem: `import('grammy')` inside adapter code resolves from GolemBot's
 * install path, not the bot's node_modules. Node caches modules by their
 * resolved specifier, so pre-importing via an absolute path does NOT make
 * a subsequent bare `import('grammy')` succeed.
 *
 * Solution: adapters call `importPeer('grammy')` which first tries the
 * normal `import()`, then falls back to `createRequire(botDir).resolve()`
 * to locate the package in the bot's own node_modules.
 */
/** Set the bot working directory. Called once from gateway startup. */
export declare function setPeerBase(dir: string): void;
/**
 * Import a peer-dependency package, falling back to the bot's node_modules
 * if the normal resolution (from GolemBot's install location) fails.
 */
export declare function importPeer(pkg: string): Promise<any>;
//# sourceMappingURL=peer-require.d.ts.map