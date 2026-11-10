const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const dates = require('./public/dates');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------------------------------------------- helpers */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const newId = () => 'p_' + crypto.randomBytes(5).toString('hex');
const newEventId = () => 'e_' + crypto.randomBytes(4).toString('hex');

const GENDERS = ['male', 'female', 'other', 'unknown'];

function str(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

// Accepts "12 May 1948", "May 12 1948", "May 1948", "1948" or "1948-05-12"
// and stores it as YYYY-MM-DD / YYYY-MM / YYYY.
function date(value, field) {
  if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, `${field}: ${dates.HINT}`);
  }
  const result = dates.parse(value);
  if (result.error) throw new HttpError(400, `${field}: ${result.error}`);
  return result.value;
}

function lifeEvent(value, field) {
  if (!value) return { date: null, place: '' };
  return { date: date(value.date, `${field}.date`), place: str(value.place) };
}

function cleanEvent(input, existing = {}) {
  const ev = {
    id: existing.id || input.id || newEventId(),
    type: str(input.type ?? existing.type, 60) || 'Other',
    date: 'date' in input ? date(input.date, 'event.date') : existing.date ?? null,
    endDate: 'endDate' in input ? date(input.endDate, 'event.endDate') : existing.endDate ?? null,
    place: 'place' in input ? str(input.place) : existing.place || '',
    note: 'note' in input ? str(input.note, 2000) : existing.note || ''
  };
  return ev;
}

function applyPersonFields(input, p) {
  for (const key of ['firstName', 'middleName', 'lastName', 'maidenName', 'nickname']) {
    if (key in input) p[key] = str(input[key]);
  }
  if ('gender' in input) {
    if (!GENDERS.includes(input.gender)) {
      throw new HttpError(400, `gender must be one of: ${GENDERS.join(', ')}`);
    }
    p.gender = input.gender;
  }
  if ('birth' in input) p.birth = lifeEvent(input.birth, 'birth');
  if ('death' in input) p.death = input.death ? lifeEvent(input.death, 'death') : null;
  if ('living' in input) p.living = Boolean(input.living);
  if ('photo' in input) p.photo = str(input.photo, 500000);
  if ('bio' in input) p.bio = str(input.bio, 10000);
  if ('events' in input) {
    if (!Array.isArray(input.events)) throw new HttpError(400, 'events must be an array');
    p.events = input.events.map((e) => cleanEvent(e));
  }
  if (p.death && (p.death.date || p.death.place)) p.living = false;
  if (p.living) p.death = null;
  return p;
}

function find(data, id) {
  const person = data.people.find((p) => p.id === id);
  if (!person) throw new HttpError(404, `No person with id "${id}"`);
  return person;
}

function childrenOf(data, id) {
  return data.people.filter((p) => p.parents.includes(id)).map((p) => p.id);
}

// Is `ancestorId` an ancestor of `personId`?
function isAncestor(data, ancestorId, personId, seen = new Set()) {
  const person = data.people.find((p) => p.id === personId);
  if (!person || seen.has(personId)) return false;
  seen.add(personId);
  return person.parents.some((pid) => pid === ancestorId || isAncestor(data, ancestorId, pid, seen));
}

function linkParent(data, childId, parentId) {
  if (childId === parentId) throw new HttpError(400, 'A person cannot be their own parent');
  const child = find(data, childId);
  find(data, parentId);
  if (child.parents.includes(parentId)) return;
  if (child.parents.length >= 2) throw new HttpError(409, 'This person already has two parents');
  if (isAncestor(data, childId, parentId)) {
    throw new HttpError(409, 'That link would make someone their own ancestor');
  }
  child.parents.push(parentId);
}

function unlinkParent(data, childId, parentId) {
  const child = find(data, childId);
  child.parents = child.parents.filter((id) => id !== parentId);
}

function partnership(input = {}, existing = {}) {
  return {
    marriageDate: 'marriageDate' in input ? date(input.marriageDate, 'marriageDate') : existing.marriageDate ?? null,
    marriagePlace: 'marriagePlace' in input ? str(input.marriagePlace) : existing.marriagePlace || '',
    divorceDate: 'divorceDate' in input ? date(input.divorceDate, 'divorceDate') : existing.divorceDate ?? null,
    status: 'status' in input ? str(input.status, 40) : existing.status || 'married'
  };
}

function linkSpouse(data, aId, bId, details = {}) {
  if (aId === bId) throw new HttpError(400, 'A person cannot be their own partner');
  const a = find(data, aId);
  const b = find(data, bId);
  const existing = a.spouses.find((s) => s.id === bId) || {};
  const info = partnership(details, existing);
  a.spouses = a.spouses.filter((s) => s.id !== bId).concat({ id: bId, ...info });
  b.spouses = b.spouses.filter((s) => s.id !== aId).concat({ id: aId, ...info });
}

function unlinkSpouse(data, aId, bId) {
  const a = find(data, aId);
  const b = find(data, bId);
  a.spouses = a.spouses.filter((s) => s.id !== bId);
  b.spouses = b.spouses.filter((s) => s.id !== aId);
}

// Children are derived from everyone else's `parents` list, so they never go out of sync.
function withChildren(data, person) {
  return { ...person, children: childrenOf(data, person.id) };
}

function displayName(p) {
  return [p.firstName, p.middleName, p.lastName, p.maidenName].filter(Boolean).join(' ').toLowerCase();
}

/* ----------------------------------------------------------------- routes */

// Whole tree in one call (used by the website).
app.get('/api/tree', wrap(async (req, res) => {
  const data = await db.read();
  res.json({ meta: data.meta, people: data.people.map((p) => withChildren(data, p)) });
}));

app.put('/api/meta', wrap(async (req, res) => {
  const meta = await db.transaction((data) => {
    if ('name' in req.body) data.meta.name = str(req.body.name, 120) || 'Our Family';
    if ('rootPersonId' in req.body) {
      if (req.body.rootPersonId) find(data, req.body.rootPersonId);
      data.meta.rootPersonId = req.body.rootPersonId || null;
    }
    return data.meta;
  });
  res.json(meta);
}));

// List people, optionally filtered with ?q=name
app.get('/api/people', wrap(async (req, res) => {
  const data = await db.read();
  const q = str(req.query.q).toLowerCase();
  const people = data.people
    .filter((p) => !q || displayName(p).includes(q))
    .map((p) => withChildren(data, p));
  res.json(people);
}));

app.get('/api/people/:id', wrap(async (req, res) => {
  const data = await db.read();
  res.json(withChildren(data, find(data, req.params.id)));
}));

// Create a person. Optional relationship arrays:
//   parents: ["id", ...]  children: ["id", ...]  spouses: [{ id, marriageDate, marriagePlace, divorceDate }]
app.post('/api/people', wrap(async (req, res) => {
  const body = req.body || {};
  const person = await db.transaction((data) => {
    const p = applyPersonFields(body, {
      id: newId(),
      firstName: '', middleName: '', lastName: '', maidenName: '', nickname: '',
      gender: 'unknown',
      birth: { date: null, place: '' },
      death: null,
      living: true,
      photo: '', bio: '',
      parents: [], spouses: [], events: [],
      createdAt: new Date().toISOString()
    });
    if (!p.firstName && !p.lastName) throw new HttpError(400, 'Add at least a first or last name');
    data.people.push(p);

    for (const parentId of body.parents || []) linkParent(data, p.id, parentId);
    for (const childId of body.children || []) linkParent(data, childId, p.id);
    for (const s of body.spouses || []) {
      const spouse = typeof s === 'string' ? { id: s } : s;
      linkSpouse(data, p.id, spouse.id, spouse);
    }
    if (!data.meta.rootPersonId) data.meta.rootPersonId = p.id;
    return withChildren(data, p);
  });
  res.status(201).json(person);
}));

// Update profile fields (relationships use the dedicated routes below).
app.put('/api/people/:id', wrap(async (req, res) => {
  const person = await db.transaction((data) => {
    const p = find(data, req.params.id);
    const { id, parents, spouses, children, ...fields } = req.body || {};
    applyPersonFields(fields, p);
    if (!p.firstName && !p.lastName) throw new HttpError(400, 'Add at least a first or last name');
    p.updatedAt = new Date().toISOString();
    return withChildren(data, p);
  });
  res.json(person);
}));

app.delete('/api/people/:id', wrap(async (req, res) => {
  await db.transaction((data) => {
    const p = find(data, req.params.id);
    data.people = data.people.filter((x) => x.id !== p.id);
    for (const other of data.people) {
      other.parents = other.parents.filter((id) => id !== p.id);
      other.spouses = other.spouses.filter((s) => s.id !== p.id);
    }
    if (data.meta.rootPersonId === p.id) data.meta.rootPersonId = data.people[0]?.id || null;
  });
  res.status(204).end();
}));

// Parents
app.post('/api/people/:id/parents', wrap(async (req, res) => {
  const p = await db.transaction((data) => {
    linkParent(data, req.params.id, req.body.parentId);
    return withChildren(data, find(data, req.params.id));
  });
  res.json(p);
}));

app.delete('/api/people/:id/parents/:parentId', wrap(async (req, res) => {
  await db.transaction((data) => unlinkParent(data, req.params.id, req.params.parentId));
  res.status(204).end();
}));

// Children (stored as the child's parents)
app.post('/api/people/:id/children', wrap(async (req, res) => {
  const p = await db.transaction((data) => {
    linkParent(data, req.body.childId, req.params.id);
    return withChildren(data, find(data, req.params.id));
  });
  res.json(p);
}));

app.delete('/api/people/:id/children/:childId', wrap(async (req, res) => {
  await db.transaction((data) => unlinkParent(data, req.params.childId, req.params.id));
  res.status(204).end();
}));

// Spouses / partners (stored on both people)
app.post('/api/people/:id/spouses', wrap(async (req, res) => {
  const p = await db.transaction((data) => {
    linkSpouse(data, req.params.id, req.body.spouseId, req.body);
    return withChildren(data, find(data, req.params.id));
  });
  res.json(p);
}));

app.put('/api/people/:id/spouses/:spouseId', wrap(async (req, res) => {
  const p = await db.transaction((data) => {
    const a = find(data, req.params.id);
    if (!a.spouses.some((s) => s.id === req.params.spouseId)) {
      throw new HttpError(404, 'These two people are not linked as partners');
    }
    linkSpouse(data, req.params.id, req.params.spouseId, req.body);
    return withChildren(data, a);
  });
  res.json(p);
}));

app.delete('/api/people/:id/spouses/:spouseId', wrap(async (req, res) => {
  await db.transaction((data) => unlinkSpouse(data, req.params.id, req.params.spouseId));
  res.status(204).end();
}));

// Life events (baptism, graduation, immigration, military service, ...)
app.post('/api/people/:id/events', wrap(async (req, res) => {
  const ev = await db.transaction((data) => {
    const p = find(data, req.params.id);
    const e = cleanEvent(req.body || {});
    p.events.push(e);
    return e;
  });
  res.status(201).json(ev);
}));

app.put('/api/people/:id/events/:eventId', wrap(async (req, res) => {
  const ev = await db.transaction((data) => {
    const p = find(data, req.params.id);
    const idx = p.events.findIndex((e) => e.id === req.params.eventId);
    if (idx === -1) throw new HttpError(404, 'Event not found');
    p.events[idx] = cleanEvent(req.body || {}, p.events[idx]);
    return p.events[idx];
  });
  res.json(ev);
}));

app.delete('/api/people/:id/events/:eventId', wrap(async (req, res) => {
  await db.transaction((data) => {
    const p = find(data, req.params.id);
    p.events = p.events.filter((e) => e.id !== req.params.eventId);
  });
  res.status(204).end();
}));

// Download a backup of the database
app.get('/api/export', wrap(async (req, res) => {
  const data = await db.read();
  res.setHeader('Content-Disposition', 'attachment; filename="family-tree-backup.json"');
  res.json(data);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Family tree running at http://localhost:${PORT}`);
  console.log(`Database file: ${db.DB_PATH}`);
});
