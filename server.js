const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Serve static frontend files from this folder
app.use(express.static(path.join(__dirname)));

const DATA_FILE = path.join(__dirname, 'tasks.json');
const { Client } = require('pg');

let clients = [];
function sendEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(res => res.write(payload));
    console.log(`Sent event '${event}' to ${clients.length} clients; data:`, data);
}

const useDb = !!process.env.DATABASE_URL;
let db = null; // pg client

let nextId = 1;
let tasks = [];

async function initDb() {
    if (!useDb) return;
    try {
        db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        await db.query(`CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            datetime TIMESTAMPTZ NOT NULL,
            notified BOOLEAN NOT NULL DEFAULT false
        );`);
        console.log('Connected to Postgres and ensured tasks table exists');
        // Seed sample if empty
        const r = await db.query('SELECT COUNT(*) FROM tasks');
        if (parseInt(r.rows[0].count, 10) === 0) {
            const dt = new Date(Date.now() + 30000).toISOString();
            await db.query('INSERT INTO tasks (name, datetime, notified) VALUES ($1, $2, $3)', ['Sample task', dt, false]);
            console.log('Seeded sample task into database');
        }
    } catch (err) {
        console.error('Postgres init failed:', err);
        db = null;
    }
}

async function loadTasks() {
    if (useDb && db) {
        const r = await db.query('SELECT id::text as id, name, datetime, notified FROM tasks ORDER BY datetime ASC');
        return r.rows.map(r=> ({ id: String(r.id), name: r.name, datetime: new Date(r.datetime).toISOString(), notified: r.notified }));
    }
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            tasks = JSON.parse(raw);
            const maxId = tasks.reduce((m, t) => Math.max(m, parseInt(t.id, 10) || 0), 0);
            nextId = maxId + 1;
            console.log(`Loaded ${tasks.length} tasks`);
        } else {
            tasks = [];
        }
    } catch (err) {
        console.error('Failed to load tasks:', err);
        tasks = [];
    }
    return tasks;
}

function saveTasks() {
    if (useDb && db) return; // DB is the source of truth
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save tasks:', err);
    }
}

// initialize DB if requested (no await at top-level; run and catch)
initDb().catch(err=> console.error('DB init error', err));

// Seed a sample task 30 seconds from server start for quick testing only if empty and not using DB
if (!useDb) {
    if (tasks.length === 0) {
        tasks.push({ id: String(nextId++), name: 'Sample task', datetime: new Date(Date.now() + 30000).toISOString(), notified: false });
        saveTasks();
    }
}

app.get('/api/tasks', async (req, res)=>{
    try {
        const t = await loadTasks();
        res.json(t);
    } catch (err) {
        console.error('GET /api/tasks failed', err);
        res.status(500).json({ error: 'failed to load tasks' });
    }
});

app.post('/api/tasks', async (req, res)=>{
    const { name, datetime } = req.body;
    if (!name || !datetime) return res.status(400).json({ error: 'name and datetime required' });
    // validate datetime
    const tTime = Date.parse(datetime);
    if (isNaN(tTime)) return res.status(400).json({ error: 'invalid datetime' });
    // Reject datetimes that are already past (avoid immediate 'notified' marking)
    if (tTime <= Date.now()) return res.status(400).json({ error: 'datetime must be in the future' });
    if (useDb && db) {
        try {
            const r = await db.query('INSERT INTO tasks (name, datetime, notified) VALUES ($1, $2, $3) RETURNING id, name, datetime, notified', [String(name), new Date(tTime).toISOString(), false]);
            const row = r.rows[0];
            const t = { id: String(row.id), name: row.name, datetime: new Date(row.datetime).toISOString(), notified: row.notified };
            res.status(201).json(t);
        } catch (err) { console.error('DB insert failed', err); res.status(500).json({ error: 'db error' }); }
    } else {
        const t = { id: String(nextId++), name: String(name), datetime: new Date(tTime).toISOString(), notified: false };
        tasks.push(t);
        saveTasks();
        res.status(201).json(t);
    }
});

app.delete('/api/tasks/:id', async (req, res)=>{
    const id = req.params.id;
    if (useDb && db) {
        try {
            const r = await db.query('DELETE FROM tasks WHERE id = $1', [id]);
            res.json({ ok:true });
        } catch (err) { console.error('DB delete failed', err); res.status(500).json({ error: 'db error' }); }
        return;
    }
    const idx = tasks.findIndex(t=> t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    tasks.splice(idx,1);
    saveTasks();
    res.json({ ok:true });
});

app.delete('/api/tasks/past', async (req, res)=>{
    if (useDb && db) {
        try {
            await db.query('DELETE FROM tasks WHERE datetime < now()');
            res.json({ ok:true });
        } catch (err) { console.error('DB delete past failed', err); res.status(500).json({ error: 'db error' }); }
        return;
    }
    const now = Date.now();
    for (let i = tasks.length -1; i>=0; i--) {
        if (new Date(tasks[i].datetime).getTime() < now) tasks.splice(i,1);
    }
    saveTasks();
    res.json({ ok:true });
});

app.get('/health', (req, res)=> res.json({ ok:true }));

// SSE endpoint
app.get('/events', (req, res)=>{
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    clients.push(res);
    req.on('close', ()=>{ clients = clients.filter(r=>r !== res); });
});

// Heartbeat to keep SSE connections alive (prevents some proxies from closing)
setInterval(()=>{
    clients.forEach(res=>{
        try { res.write(': heartbeat\n\n'); } catch (err) { /* ignore */ }
    });
}, 15000);


// Check deadlines periodically
setInterval(async ()=>{
    const now = Date.now();
    if (useDb && db) {
        try {
            const r = await db.query("SELECT id::text as id, name, datetime FROM tasks WHERE notified = false AND datetime <= now() ORDER BY datetime ASC");
            for (const row of r.rows) {
                await db.query('UPDATE tasks SET notified = true WHERE id = $1', [row.id]);
                console.log('Deadline reached (DB) and notified for task:', row);
                sendEvent('deadline', { id: String(row.id), name: row.name, datetime: new Date(row.datetime).toISOString() });
            }
        } catch (err) { console.error('DB deadline check failed', err); }
        return;
    }
    for (const t of tasks) {
        if (!t.notified && new Date(t.datetime).getTime() <= now) {
            t.notified = true;
            saveTasks();
            console.log('Deadline reached and notified for task:', t);
            sendEvent('deadline', { id: t.id, name: t.name, datetime: t.datetime });
        }
    }
}, 1000);

// Error handler - return JSON responses for unexpected errors
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
    try { res.status(500).json({ error: 'internal server error' }); } catch (e) { res.status(500).end(); }
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`Server running at http://localhost:${port}`));
