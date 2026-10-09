'use strict';
// PESS V27 server — بدون أي مكتبات خارجية. يتطلب Node.js 22.12 أو أحدث.
const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const PORT = +process.env.PORT || 3000, TOKEN = process.env.PESS_TOKEN || '';
const DBF = process.env.PESS_DB || path.join(__dirname, 'data', 'pess.db');
fs.mkdirSync(path.dirname(DBF), { recursive: true });
const db = new DatabaseSync(DBF);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
try { db.exec("ALTER TABLE contracts ADD COLUMN sub TEXT NOT NULL DEFAULT ''"); } catch (e) { /* جدول جديد أو العمود موجود */ }
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
const J = s => { try { return JSON.parse(s) } catch (e) { return {} } };
const getMeta = k => { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null };
const setMeta = (k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
const rev = () => +getMeta('rev') || 0;

function readAll() {
  const clients = db.prepare('SELECT * FROM clients ORDER BY id').all()
    .map(c => ({ id: c.id, name: c.name, credit: c.credit, x: J(c.x), phones: [], calls: [], contracts: [] }));
  const by = new Map(clients.map(c => [c.id, c]));
  for (const p of db.prepare('SELECT * FROM phones ORDER BY id').all()) by.get(p.client_id)?.phones.push({ n: p.number, l: p.label });
  for (const k of db.prepare('SELECT * FROM calls ORDER BY id').all()) by.get(k.client_id)?.calls.push({ date: k.at, type: k.type, result: k.result, note: k.note });
  const cm = new Map();
  for (const k of db.prepare('SELECT * FROM contracts ORDER BY id').all()) {
    const o = { id: k.id, items: k.items, sub: k.sub || '', type: k.type, months: k.months, total: k.total, down: k.down, discount: k.discount, cost: k.cost, date: k.date, note: k.note, x: J(k.x), payments: [] };
    cm.set(k.id, o); by.get(k.client_id)?.contracts.push(o);
  }
  for (const p of db.prepare('SELECT * FROM payments ORDER BY contract_id, seq').all())
    cm.get(p.contract_id)?.payments.push({ id: p.seq, amount: p.amount, date: p.date, method: p.method, ref: p.ref, note: p.note, x: J(p.x) });
  const tables = db.prepare('SELECT * FROM custom_tables ORDER BY rowid').all().map(t => ({ id: t.id, name: t.name, rows: [] }));
  const tm = new Map(tables.map(t => [t.id, t]));
  for (const r of db.prepare('SELECT * FROM custom_rows ORDER BY table_id, rid').all()) tm.get(r.table_id)?.rows.push({ id: r.rid, x: J(r.x) });
  const audit = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all().map(a => ({ t: a.at, a: a.action, k: a.k || undefined }));
  return { ...J(getMeta('doc')), clients, tables, audit };
}

function writeAll(d) {
  if (!d || !Array.isArray(d.clients)) throw new Error('bad data');
  const n = v => Number.isFinite(+v) ? +v : 0, s = v => v == null ? '' : String(v), j = v => JSON.stringify(v || {});
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of ['payments', 'contracts', 'phones', 'calls', 'clients', 'custom_rows', 'custom_tables', 'audit']) db.exec('DELETE FROM ' + t);
    const ic = db.prepare('INSERT INTO clients(id,name,credit,x) VALUES(?,?,?,?)'),
      ip = db.prepare('INSERT INTO phones(client_id,number,label) VALUES(?,?,?)'),
      icl = db.prepare('INSERT INTO calls(client_id,at,type,result,note) VALUES(?,?,?,?,?)'),
      ik = db.prepare('INSERT INTO contracts(id,client_id,items,sub,type,months,total,down,discount,cost,date,note,x) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      ipy = db.prepare('INSERT INTO payments(contract_id,seq,amount,date,method,ref,note,x) VALUES(?,?,?,?,?,?,?,?)');
    for (const c of d.clients) {
      ic.run(n(c.id), s(c.name), n(c.credit), j(c.x));
      for (const p of c.phones || []) ip.run(n(c.id), s(p.n), s(p.l));
      for (const k of c.calls || []) icl.run(n(c.id), s(k.date), s(k.type), s(k.result), s(k.note));
      for (const k of c.contracts || []) {
        ik.run(n(k.id), n(c.id), s(k.items), s(k.sub), s(k.type), n(k.months), n(k.total), n(k.down), n(k.discount), n(k.cost), s(k.date), s(k.note), j(k.x));
        (k.payments || []).forEach((p, i) => ipy.run(n(k.id), i + 1, n(p.amount), s(p.date), s(p.method), s(p.ref), s(p.note), j(p.x)));
      }
    }
    const it = db.prepare('INSERT INTO custom_tables(id,name) VALUES(?,?)'), ir = db.prepare('INSERT INTO custom_rows(table_id,rid,x) VALUES(?,?,?)');
    for (const t of d.tables || []) { it.run(s(t.id), s(t.name)); for (const r of t.rows || []) ir.run(s(t.id), n(r.id), j(r.x)); }
    const ia = db.prepare('INSERT INTO audit(at,action,k) VALUES(?,?,?)');
    for (const a of [...(d.audit || [])].slice(0, 500).reverse()) ia.run(s(a.t), s(a.a), a.k == null ? null : s(a.k));
    setMeta('doc', JSON.stringify({ company: d.company || {}, schema: d.schema || {}, lists: d.lists || null, m1: d.m1 || 0 }));
    const r = rev() + 1; setMeta('rev', r);
    db.exec('COMMIT'); return r;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const body = req => new Promise((ok, no) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > 30e6) { no(new Error('too large')); req.destroy() } else b += c }); req.on('end', () => ok(b)); req.on('error', no) });

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (c, o, t = 'application/json; charset=utf-8') => { res.writeHead(c, { 'Content-Type': t, 'Cache-Control': 'no-store' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)) };
  try {
    if (u.pathname === '/' || u.pathname === '/index.html')
      return send(200, fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    if (u.pathname === '/api/health') return send(200, { pess: 1, rev: rev(), auth: !!TOKEN });
    if (u.pathname.startsWith('/api/')) {
      if (TOKEN && req.headers['x-token'] !== TOKEN) return send(401, { error: 'unauthorized' });
      if (u.pathname === '/api/data' && req.method === 'GET') return send(200, { rev: rev(), data: readAll() });
      if (u.pathname === '/api/data' && req.method === 'PUT') {
        const b = JSON.parse(await body(req));
        if (b.baseRev !== -1 && b.baseRev !== rev()) return send(409, { error: 'conflict', rev: rev() });
        return send(200, { rev: writeAll(b.data) });
      }
      if (u.pathname === '/api/sql' && req.method === 'POST') { // استعلامات قراءة فقط (SELECT)
        const { sql } = JSON.parse(await body(req));
        const ro = new DatabaseSync(DBF, { readOnly: true });
        try { return send(200, { rows: ro.prepare(String(sql)).all().slice(0, 5000) }) } finally { ro.close() }
      }
    }
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: String(e.message || e) }); }
});

function backup() {
  try {
    const dir = path.join(path.dirname(DBF), 'backups'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'pess-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.db');
    if (!fs.existsSync(f)) db.exec("VACUUM INTO '" + f.replace(/'/g, "''") + "'");
    fs.readdirSync(dir).sort().slice(0, -20).forEach(x => fs.unlinkSync(path.join(dir, x)));
  } catch (e) { console.error('backup failed:', e.message); }
}
backup(); setInterval(backup, 6 * 3600e3).unref();
srv.listen(PORT, '0.0.0.0', () => console.log('PESS server on :' + PORT + (TOKEN ? ' (token required)' : ' (NO TOKEN — set PESS_TOKEN before exposing online)') + '\nDB: ' + DBF));
