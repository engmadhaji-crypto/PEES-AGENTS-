-- PESS V27 — SQLite schema (يُنفَّذ تلقائياً عند تشغيل السيرفر)
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS clients(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, credit REAL NOT NULL DEFAULT 0, x TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS phones(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  number TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  at TEXT, type TEXT, result TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS contracts(
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '', sub TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', months REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0, down REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
  date TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', x TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS payments(
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0, date TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', x TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(contract_id, seq));
CREATE TABLE IF NOT EXISTS custom_tables(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS custom_rows(
  table_id TEXT NOT NULL REFERENCES custom_tables(id) ON DELETE CASCADE, rid INTEGER NOT NULL,
  x TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(table_id, rid));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, action TEXT, k TEXT);
CREATE INDEX IF NOT EXISTS ix_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS ix_phones_client ON phones(client_id);

DROP VIEW IF EXISTS v_clients; DROP VIEW IF EXISTS v_contracts;
CREATE VIEW v_contracts AS
SELECT k.id, k.client_id, c.name AS client, k.sub, k.items, k.type, k.total, k.discount, k.down, k.cost,
  k.down + COALESCE(p.paid,0) AS paid,
  ROUND(k.total - k.discount - k.down - COALESCE(p.paid,0), 2) AS remaining,
  k.total - k.cost - k.discount AS profit
FROM contracts k JOIN clients c ON c.id = k.client_id
LEFT JOIN (SELECT contract_id, SUM(amount) AS paid FROM payments GROUP BY contract_id) p ON p.contract_id = k.id;
CREATE VIEW v_clients AS
SELECT client_id AS id, client AS name, COUNT(*) AS contracts, SUM(total-discount) AS net,
  SUM(paid) AS paid, SUM(MAX(remaining,0)) AS remaining, SUM(profit) AS profit
FROM v_contracts GROUP BY client_id;
