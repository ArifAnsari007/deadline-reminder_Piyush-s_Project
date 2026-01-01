const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Serve static frontend files from this folder
app.use(express.static(path.join(__dirname)));

const DATA_FILE = path.join(__dirname, 'tasks.json');

let clients = [];
function sendEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(res => res.write(payload));
    console.log(`Sent event '${event}' to ${clients.length} clients; data:`, data);
}

let nextId = 1;
let tasks = [];

function loadTasks() {
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
}

function saveTasks() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save tasks:', err);
    }
}

loadTasks();

// Seed a sample task 30 seconds from server start for quick testing only if empty
if (tasks.length === 0) {
    tasks.push({ id: String(nextId++), name: 'Sample task', datetime: new Date(Date.now() + 30000).toISOString(), notified: false });
    saveTasks();
}

app.get('/api/tasks', (req, res)=>{
    // return tasks in ascending datetime order
    const out = tasks.slice().sort((a,b)=> new Date(a.datetime) - new Date(b.datetime));
    res.json(out);
});

app.post('/api/tasks', (req, res)=>{
    const { name, datetime } = req.body;
    if (!name || !datetime) return res.status(400).json({ error: 'name and datetime required' });
    // validate datetime
    const tTime = Date.parse(datetime);
    if (isNaN(tTime)) return res.status(400).json({ error: 'invalid datetime' });
    // Reject datetimes that are already past (avoid immediate 'notified' marking)
    if (tTime <= Date.now()) return res.status(400).json({ error: 'datetime must be in the future' });
    const t = { id: String(nextId++), name: String(name), datetime: new Date(tTime).toISOString(), notified: false };
    tasks.push(t);
    saveTasks();
    res.status(201).json(t);
});

app.delete('/api/tasks/:id', (req, res)=>{
    const id = req.params.id;
    const idx = tasks.findIndex(t=> t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    tasks.splice(idx,1);
    saveTasks();
    res.json({ ok:true });
});

app.delete('/api/tasks/past', (req, res)=>{
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
setInterval(()=>{
    const now = Date.now();
    for (const t of tasks) {
        if (!t.notified && new Date(t.datetime).getTime() <= now) {
            t.notified = true;
            saveTasks();
            console.log('Deadline reached and notified for task:', t);
            sendEvent('deadline', { id: t.id, name: t.name, datetime: t.datetime });
        }
    }
}, 1000);

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`Server running at http://localhost:${port}`));
