const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/data/amore-fiore.db'
  : path.join(__dirname, 'data.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database setup ────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS market (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    person TEXT NOT NULL DEFAULT 'ambos',
    bought INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    dest TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    person TEXT NOT NULL DEFAULT 'ambos',
    done INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// ── Generic CRUD factory ──────────────────────────────────────────
function crudRouter(table, insertFields) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const body = req.body;
    const cols = insertFields.join(', ');
    const placeholders = insertFields.map(f => '@' + f).join(', ');
    const params = {};
    for (const f of insertFields) params[f] = body[f] ?? null;
    const info = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(params);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json(row);
  });

  router.patch('/:id', (req, res) => {
    const body = req.body;
    const sets = Object.keys(body).map(k => `${k} = @${k}`).join(', ');
    if (!sets) return res.status(400).json({ error: 'No fields to update' });
    body.id = Number(req.params.id);
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run(body);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id: body.id });
    res.json(row);
  });

  router.delete('/:id', (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
    res.status(204).end();
  });

  return router;
}

app.use('/api/market',  crudRouter('market',  ['name', 'person']));
app.use('/api/notes',   crudRouter('notes',   ['dest', 'text']));
app.use('/api/todos',   crudRouter('todos',   ['text', 'person']));

// ── Health check ──────────────────────────────────────────────────
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Amore Fiore running on port ${PORT}`));
