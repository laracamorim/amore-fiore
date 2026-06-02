const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── JSON data store ───────────────────────────────────────────────
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { market: [], notes: [], todos: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nextId(items) {
  return items.length === 0 ? 1 : Math.max(...items.map(i => i.id)) + 1;
}

// ── Generic CRUD factory ──────────────────────────────────────────
function crudRouter(table) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const data = loadData();
    res.json(data[table]);
  });

  router.post('/', (req, res) => {
    const data = loadData();
    const item = { id: nextId(data[table]), ...req.body, created_at: Math.floor(Date.now() / 1000) };
    data[table].unshift(item);
    saveData(data);
    res.status(201).json(item);
  });

  router.patch('/:id', (req, res) => {
    const data = loadData();
    const idx = data[table].findIndex(i => i.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    data[table][idx] = { ...data[table][idx], ...req.body };
    saveData(data);
    res.json(data[table][idx]);
  });

  router.delete('/:id', (req, res) => {
    const data = loadData();
    data[table] = data[table].filter(i => i.id !== Number(req.params.id));
    saveData(data);
    res.status(204).end();
  });

  return router;
}

app.use('/api/market',  crudRouter('market'));
app.use('/api/notes',   crudRouter('notes'));
app.use('/api/todos',   crudRouter('todos'));

app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Amore Fiore running on port ${PORT}`));
