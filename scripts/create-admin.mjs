import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data')); mkdirSync(dir, { recursive: true, mode: 0o700 });
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pass = process.env.ADMIN_PASSWORD || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pass.length < 12) { console.error('Provide ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) as environment variables.'); process.exit(1) }
const dbPath = path.join(dir, 'wrosecode-web.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass_hash TEXT,role TEXT NOT NULL DEFAULT 'member',approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,provider_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(provider,provider_id));
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_flows(state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL,link_user_id TEXT);
CREATE TABLE IF NOT EXISTS cli_pairings(user_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,device_token TEXT NOT NULL,created_at INTEGER NOT NULL);`);
const salt = crypto.randomBytes(16); const hash = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pass, salt, 64).toString('hex');
const old = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
if (old) { db.prepare("UPDATE users SET pass_hash=?,role='owner',approved=1 WHERE id=?").run(hash, old.id) } else db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), email, hash, 'owner', 1, Date.now());
try { chmodSync(dbPath, 0o600) } catch {}
console.log(`Admin initialized for ${email}. Keep credentials private.`); db.close();
