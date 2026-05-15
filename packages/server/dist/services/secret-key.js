/**
 * services/secret-key.ts — Phase 13
 *
 * Per-project AES-256-GCM secret key, used to encrypt MCP-server header
 * values at rest. Key file lives at `${project.path}/.secret-key`
 * (project.path IS the .squad/ directory per the schema), 32 random bytes,
 * mode 0600. Keys are cached in-process to avoid hammering the disk.
 *
 * Wire-format conventions:
 *   - IV: 12 random bytes (recommended for GCM), hex-encoded.
 *   - AuthTag: 16 bytes, hex-encoded.
 *   - Ciphertext: hex-encoded.
 *
 * Header rows are stored as JSON arrays of `{ name, cipher }` items, where
 * `cipher` is the hex ciphertext for that header value. A single (iv, tag)
 * pair is shared across all header values in one row — the headers JSONB is
 * serialised, encrypted as one blob, and stored as a single hex string in
 * the `headers` column. See services/mcp.ts for the envelope.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
const KEY_FILENAME = '.secret-key';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const _cache = new Map();
async function projectPath(projectId) {
    const db = getDb();
    const rows = await db
        .select({ path: schema.projects.path })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
    if (!rows[0]) {
        const err = new Error(`project not found: ${projectId}`);
        err.status = 404;
        throw err;
    }
    return rows[0].path;
}
async function ensureKeyFile(dir) {
    const keyPath = path.join(dir, KEY_FILENAME);
    try {
        const buf = await fs.readFile(keyPath);
        if (buf.length !== KEY_BYTES) {
            throw new Error(`secret key at ${keyPath} has unexpected length ${buf.length}`);
        }
        return buf;
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    // Generate + persist atomically.
    const fresh = crypto.randomBytes(KEY_BYTES);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(keyPath, fresh, { mode: 0o600 });
    // Be defensive on filesystems that ignore mode in writeFile (e.g. WSL):
    try {
        await fs.chmod(keyPath, 0o600);
    }
    catch { /* best effort */ }
    return fresh;
}
export async function getProjectSecretKey(projectId) {
    const cached = _cache.get(projectId);
    if (cached)
        return cached;
    const dir = await projectPath(projectId);
    const key = await ensureKeyFile(dir);
    _cache.set(projectId, key);
    return key;
}
export function encryptString(key, plaintext) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipherInst = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipherInst.update(plaintext, 'utf8'), cipherInst.final()]);
    const tag = cipherInst.getAuthTag();
    return { cipher: enc.toString('hex'), iv: iv.toString('hex'), tag: tag.toString('hex') };
}
export function decryptString(key, env) {
    const iv = Buffer.from(env.iv, 'hex');
    const tag = Buffer.from(env.tag, 'hex');
    const ciphertext = Buffer.from(env.cipher, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
/**
 * Mask a secret value for logging — never logs more than 4 characters of
 * the source value, and always returns a fixed-length asterisk run for
 * very short secrets to avoid leaking length information for short tokens.
 */
export function maskSecret(value) {
    if (!value)
        return '';
    if (value.length <= 8)
        return '***';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
//# sourceMappingURL=secret-key.js.map