import json, sqlite3, os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')
PUBLIC  = os.path.join(os.path.dirname(__file__), 'public')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS market (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            person TEXT NOT NULL DEFAULT 'ambos',
            bought INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dest TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            person TEXT NOT NULL DEFAULT 'ambos',
            done INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
    """)
    db.commit()
    return db

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def log_message(self, fmt, *args): pass

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def route(self, method):
        p = urlparse(self.path).path.rstrip('/')
        parts = p.split('/')  # ['', 'api', 'table', maybe 'id']

        if p == '/api/ping':
            return self.send_json(200, {'ok': True})

        if len(parts) < 3 or parts[1] != 'api':
            return None

        table = parts[2]
        if table not in ('market', 'notes', 'todos'):
            return self.send_json(404, {'error': 'not found'})

        row_id = int(parts[3]) if len(parts) == 4 else None
        db = get_db()

        try:
            if method == 'GET' and row_id is None:
                rows = db.execute(f"SELECT * FROM {table} ORDER BY created_at DESC").fetchall()
                return self.send_json(200, [dict(r) for r in rows])

            if method == 'POST' and row_id is None:
                body = self.read_body()
                if table == 'market':
                    cur = db.execute("INSERT INTO market (name,person) VALUES (?,?)", (body['name'], body.get('person','ambos')))
                elif table == 'notes':
                    cur = db.execute("INSERT INTO notes (dest,text) VALUES (?,?)", (body['dest'], body['text']))
                else:
                    cur = db.execute("INSERT INTO todos (text,person) VALUES (?,?)", (body['text'], body.get('person','ambos')))
                db.commit()
                row = db.execute(f"SELECT * FROM {table} WHERE id=?", (cur.lastrowid,)).fetchone()
                return self.send_json(201, dict(row))

            if method == 'PATCH' and row_id:
                body = self.read_body()
                sets = ', '.join(f"{k}=?" for k in body)
                vals = list(body.values()) + [row_id]
                db.execute(f"UPDATE {table} SET {sets} WHERE id=?", vals)
                db.commit()
                row = db.execute(f"SELECT * FROM {table} WHERE id=?", (row_id,)).fetchone()
                return self.send_json(200, dict(row))

            if method == 'DELETE' and row_id:
                db.execute(f"DELETE FROM {table} WHERE id=?", (row_id,))
                db.commit()
                self.send_response(204)
                self.end_headers()
                return True

        finally:
            db.close()

        return self.send_json(405, {'error': 'method not allowed'})

    def do_GET(self):
        if self.path.startswith('/api'):
            self.route('GET')
        else:
            if not os.path.exists(os.path.join(PUBLIC, self.path.lstrip('/'))):
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        self.route('POST')

    def do_PATCH(self):
        self.route('PATCH')

    def do_DELETE(self):
        self.route('DELETE')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 4444))
    print(f"Amore Fiore running on http://localhost:{port}")
    HTTPServer(('', port), Handler).serve_forever()
