// Tiny JSON-file database.
// The file is re-read on every request, so you can edit data/db.json by hand
// while the server is running. Writes are queued and saved atomically
// (write to a temp file, then rename) so the file is never left half-written.
const fs = require('fs/promises');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');

const EMPTY = () => ({
  meta: { name: 'Our Family', rootPersonId: null, updatedAt: new Date().toISOString() },
  people: []
});

async function load() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const db = JSON.parse(raw);
    db.meta = db.meta || {};
    db.people = Array.isArray(db.people) ? db.people : [];
    for (const p of db.people) {
      p.parents = Array.isArray(p.parents) ? p.parents : [];
      p.spouses = Array.isArray(p.spouses) ? p.spouses : [];
      p.events = Array.isArray(p.events) ? p.events : [];
    }
    return db;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const db = EMPTY();
      await save(db);
      return db;
    }
    if (err instanceof SyntaxError) {
      err.message = `data/db.json is not valid JSON: ${err.message}`;
    }
    throw err;
  }
}

async function save(db) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, DB_PATH);
}

let queue = Promise.resolve();

// Run a read-modify-write function. Changes are saved only if fn succeeds.
function transaction(fn) {
  const run = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    db.meta.updatedAt = new Date().toISOString();
    await save(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

async function read() {
  await queue;
  return load();
}

module.exports = { read, transaction, DB_PATH };
