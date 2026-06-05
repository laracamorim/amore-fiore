const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      person TEXT NOT NULL DEFAULT 'ambos',
      bought BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      dest TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      person TEXT NOT NULL DEFAULT 'ambos',
      done BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
  `);
}

function crudRouter(table, insertFields) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const cols = insertFields.join(', ');
    const placeholders = insertFields.map((_, i) => `$${i + 1}`).join(', ');
    const vals = insertFields.map(f => req.body[f] ?? null);
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`, vals
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const body = req.body;
    const keys = Object.keys(body);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const vals = [...keys.map(k => body[k]), Number(req.params.id)];
    const { rows } = await pool.query(
      `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, vals
    );
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [Number(req.params.id)]);
    res.status(204).end();
  });

  return router;
}

app.use('/api/market', crudRouter('market', ['name', 'person']));
app.use('/api/notes',  crudRouter('notes',  ['dest', 'text']));
app.use('/api/todos',  crudRouter('todos',  ['text', 'person']));

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`Amore Fiore running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
