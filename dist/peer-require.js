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
import { createRequire } from 'node:module';
import { join } from 'node:path';
let _botDir;
/** Set the bot working directory. Called once from gateway startup. */
export function setPeerBase(dir) {
    _botDir = dir;
}
/**
 * Import a peer-dependency package, falling back to the bot's node_modules
 * if the normal resolution (from GolemBot's install location) fails.
 */
export async function importPeer(pkg) {
    // 1. Try normal resolution (works when GolemBot is used locally / in dev)
    try {
        return await import(pkg);
    }
    catch {
        // Not found from GolemBot's own node_modules
    }
    // 2. Resolve from the bot's working directory
    if (_botDir) {
        try {
            const localRequire = createRequire(join(_botDir, 'package.json'));
            const resolved = localRequire.resolve(pkg);
            return await import(resolved);
        }
        catch {
            // Not installed in bot dir either
        }
    }
    throw new Error(`Cannot find package "${pkg}". Install it in your bot directory: npm install ${pkg}`);
}
//# sourceMappingURL=peer-require.js.map