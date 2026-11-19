/**
 * Memo storage: one JSON file under $DSH_HOME/memo/memos.json.
 *
 * Three scopes, decided by the user:
 *   session  — only the session that owns it receives it
 *   profile  — every session of that profile receives it
 *   user     — the user writes it for themselves; no tool ever returns it
 *
 * Everything here is pure apart from read/write/update/remove, which touch the
 * file named by `dataFile()`. Tests pass a temp dir through `env`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCOPES = ['session', 'profile', 'user'];
/** Scopes an agent may write. `user` is the user's own drawer and is UI-only. */
export const AGENT_SCOPES = ['session', 'profile'];

export const LIMITS = {
  title: 120,
  body: 4000,
  entries: 500,
};

/** Defaults for the plugin's own settings. `showTabEntry` off by default (user m26532). */
export const DEFAULT_SETTINGS = { showTabEntry: false };

export function sanitizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  return { showTabEntry: source.showTabEntry === true };
}

/** Read the settings block out of a db that `sanitizeDb` produced. */
export function readSettings(db) {
  return sanitizeSettings(db === null || typeof db !== 'object' ? null : db.settings);
}

/** Apply a partial patch; unknown keys are ignored, values are coerced. */
export function patchSettings(db, patch) {
  const next = readSettings(db);
  const source = patch !== null && typeof patch === 'object' ? patch : {};
  if (source.showTabEntry !== undefined) next.showTabEntry = source.showTabEntry === true;
  db.settings = next;
  return next;
}

export function homeDir(env = process.env) {
  const explicit = env.DSH_HOME;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit;
  return path.join(os.homedir(), '.dsh');
}

export function dataFile(env = process.env) {
  const home = homeDir(env);
  const override = env.DSH_MEMO_FILE;
  if (typeof override === 'string' && override.trim() !== '') return override;
  return path.join(home, 'memo', 'memos.json');
}

function emptyDb() {
  return { version: 1, entries: [], settings: { ...DEFAULT_SETTINGS } };
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Coerce anything on disk into the shape the rest of the module expects.
 * Unknown fields are dropped, bad rows are skipped: a corrupted file must not
 * take the plugin down.
 */
export function sanitizeDb(raw) {
  const db = emptyDb();
  db.settings = sanitizeSettings(raw !== null && typeof raw === 'object' ? raw.settings : null);
  const list = raw !== null && typeof raw === 'object' && Array.isArray(raw.entries) ? raw.entries : [];
  for (const row of list) {
    if (row === null || typeof row !== 'object') continue;
    const scope = SCOPES.includes(row.scope) ? row.scope : null;
    if (scope === null) continue;
    const sessionId = typeof row.sessionId === 'string' && row.sessionId !== '' ? row.sessionId : null;
    if (scope === 'session' && sessionId === null) continue;
    const title = str(row.title, LIMITS.title);
    const body = str(row.body, LIMITS.body);
    if (title === '' && body === '') continue;
    const createdAt = num(row.createdAt, 0);
    db.entries.push({
      id: str(row.id, 64) || newId(),
      scope,
      sessionId,
      profile: str(row.profile, 64) || 'default',
      title,
      body,
      done: row.done === true,
      createdBy: row.createdBy === 'user' ? 'user' : 'agent',
      createdAt,
      updatedAt: num(row.updatedAt, createdAt),
    });
    if (db.entries.length >= LIMITS.entries) break;
  }
  return db;
}

export function read(env = process.env) {
  const file = dataFile(env);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return sanitizeDb(JSON.parse(text));
  } catch {
    return emptyDb();
  }
}

export function write(db, env = process.env) {
  const file = dataFile(env);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, "\t"), 'utf8');
  fs.renameSync(tmp, file);
  return db;
}

let counter = 0;
export function newId() {
  counter = (counter + 1) % 4096;
  const rand = Math.floor(Math.random() * 0xfffff).toString(16).padStart(5, '0');
  return `m_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/**
 * What each reader sees.
 *   agent — session scope of this session + profile scope of this profile; never `user`
 *   panel — everything the user may see here: the two above plus `user`
 */
export function visibleTo(db, { sessionId = null, profile = 'default' } = {}) {
  const session = [];
  const byProfile = [];
  const user = [];
  for (const entry of db.entries) {
    if (entry.scope === 'session') {
      if (entry.sessionId !== null && entry.sessionId === sessionId) session.push(entry);
    } else if (entry.scope === 'profile') {
      if (entry.profile === profile) byProfile.push(entry);
    } else if (entry.scope === 'user') {
      user.push(entry);
    }
  }
  return { session, profile: byProfile, user };
}

function requireScope(scope, { sessionId }) {
  if (!SCOPES.includes(scope)) throw new Error(`unknown scope "${String(scope)}" (session|profile|user)`);
  if (scope === 'session' && (sessionId === null || sessionId === '')) {
    throw new Error('scope "session" needs a session id');
  }
}

export function addEntry(db, input) {
  const scope = input.scope;
  requireScope(scope, input);
  const title = str(input.title, LIMITS.title);
  const body = str(input.body, LIMITS.body);
  if (title === '' && body === '') throw new Error('a memo needs a title or a body');
  if (db.entries.length >= LIMITS.entries) throw new Error(`the memo list is full (${LIMITS.entries})`);
  const now = num(input.now, Date.now());
  const entry = {
    id: newId(),
    scope,
    sessionId: scope === 'session' ? input.sessionId : null,
    profile: scope === 'session' ? str(input.profile, 64) || 'default' : str(input.profile, 64) || 'default',
    title,
    body,
    done: false,
    createdBy: input.createdBy === 'user' ? 'user' : 'agent',
    createdAt: now,
    updatedAt: now,
  };
  db.entries.push(entry);
  return entry;
}

export function updateEntry(db, input) {
  const entry = db.entries.find((row) => row.id === input.id);
  if (entry === undefined) throw new Error(`no memo with id "${String(input.id)}"`);
  if (input.title !== undefined) entry.title = str(input.title, LIMITS.title);
  if (input.body !== undefined) entry.body = str(input.body, LIMITS.body);
  if (input.done !== undefined) entry.done = input.done === true;
  if (entry.title === '' && entry.body === '') throw new Error('a memo needs a title or a body');
  entry.updatedAt = num(input.now, Date.now());
  return entry;
}

export function deleteEntry(db, input) {
  const index = db.entries.findIndex((row) => row.id === input.id);
  if (index < 0) throw new Error(`no memo with id "${String(input.id)}"`);
  const [entry] = db.entries.splice(index, 1);
  return entry;
}
