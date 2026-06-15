const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
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
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      tx_date DATE NOT NULL,
      description TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      category TEXT NOT NULL DEFAULT 'Outros',
      tx_key TEXT UNIQUE NOT NULL,
      uploaded_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id SERIAL PRIMARY KEY,
      dep_date DATE NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      dep_key TEXT UNIQUE NOT NULL,
      uploaded_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
    CREATE TABLE IF NOT EXISTS gastos_meta (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_updated BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())
    );
    INSERT INTO gastos_meta (id, last_updated) VALUES (1, EXTRACT(EPOCH FROM NOW()))
    ON CONFLICT (id) DO NOTHING;
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
    const { rows } = await pool.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`, vals);
    res.status(201).json(rows[0]);
  });
  router.patch('/:id', async (req, res) => {
    const body = req.body;
    const keys = Object.keys(body);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const vals = [...keys.map(k => body[k]), Number(req.params.id)];
    const { rows } = await pool.query(`UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, vals);
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

// ── Transactions ──────────────────────────────────────────────────
app.get('/api/transactions', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM transactions ORDER BY tx_date DESC');
  const deposits = await pool.query('SELECT * FROM deposits ORDER BY dep_date ASC');
  const meta = await pool.query('SELECT last_updated FROM gastos_meta WHERE id = 1');
  res.json({ transactions: rows, deposits: deposits.rows, last_updated: meta.rows[0]?.last_updated || null });
});

app.post('/api/transactions/sync', async (req, res) => {
  const { transactions, deposits } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No transactions provided' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    let skipped  = 0;
    for (const tx of transactions) {
      const key = `${tx.tx_date}|${tx.description}|${tx.amount}`;
      const result = await client.query(
        `INSERT INTO transactions (tx_date, description, amount, category, tx_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tx_key) DO NOTHING`,
        [tx.tx_date, tx.description, tx.amount, tx.category, key]
      );
      result.rowCount > 0 ? inserted++ : skipped++;
    }
    if (Array.isArray(deposits)) {
      for (const dep of deposits) {
        const key = `${dep.dep_date}|${dep.amount}`;
        await client.query(
          `INSERT INTO deposits (dep_date, amount, dep_key)
           VALUES ($1, $2, $3)
           ON CONFLICT (dep_key) DO NOTHING`,
          [dep.dep_date, dep.amount, key]
        );
      }
    }
    await client.query(`UPDATE gastos_meta SET last_updated = EXTRACT(EPOCH FROM NOW()) WHERE id = 1`);
    await client.query('COMMIT');
    res.json({ inserted, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/transactions', async (req, res) => {
  await pool.query('DELETE FROM transactions');
  await pool.query('DELETE FROM deposits');
  await pool.query(`UPDATE gastos_meta SET last_updated = EXTRACT(EPOCH FROM NOW()) WHERE id = 1`);
  res.status(204).end();
});

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
