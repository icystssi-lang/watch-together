import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const defaultPath = `${__dirname}/data/app.db`;
const dbPath = process.env.DATABASE_PATH || defaultPath;

let db;

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function initDb() {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bans (
      subject TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor_sub TEXT,
      action TEXT NOT NULL,
      meta_json TEXT
    );
  `);

  logger.info({ path: dbPath }, "database_ready");
  return db;
}

export function bootstrapAdmin() {
  const database = getDb();
  const adminCount = database
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")
    .get().c;
  if (adminCount > 0) return;

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    logger.warn("No admin user and ADMIN_EMAIL/ADMIN_PASSWORD not set");
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, role, created_at)
       VALUES (?, ?, ?, 'admin', ?)`
    )
    .run(email, hash, "Admin", now);
  logger.info({ email }, "bootstrap_admin_created");
}

export function findUserByEmail(email) {
  return getDb()
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim().toLowerCase());
}

export function createUser(email, passwordHash, displayName, role = "user") {
  const now = Date.now();
  const r = getDb()
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email.trim().toLowerCase(), passwordHash, displayName, role, now);
  return r.lastInsertRowid;
}

export function isBannedSubject(subject) {
  if (!subject) return false;
  const row = getDb()
    .prepare("SELECT 1 FROM bans WHERE subject = ?")
    .get(subject);
  return Boolean(row);
}
