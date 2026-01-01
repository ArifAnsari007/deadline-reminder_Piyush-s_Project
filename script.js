// Frontend script: fetch tasks, register SSE, show popup on deadline
const apiBase = '';

async function fetchTasks() {
    const res = await fetch(apiBase + '/api/tasks');
    if (!res.ok) throw new Error('Failed to fetch tasks');
    return res.json();
}

function renderTasks(tasks) {
    const ul = document.getElementById('deadlines');
    ul.innerHTML = '';
    tasks.sort((a,b)=> new Date(a.datetime) - new Date(b.datetime));
    for (const t of tasks) {
        const li = document.createElement('li');
        const info = document.createElement('div');
        info.className = 'deadline-info';
        const title = document.createElement('strong');
        title.textContent = t.name;
        const when = document.createElement('div');
        when.textContent = new Date(t.datetime).toLocaleString();
        info.appendChild(title);
        info.appendChild(when);

        const del = document.createElement('button');
        del.className = 'delete-btn';
        del.textContent = 'Delete';
        del.onclick = async ()=>{
            try {
                const resp = await fetch(apiBase + '/api/tasks/' + encodeURIComponent(t.id), { method: 'DELETE' });
                if (!resp.ok) throw new Error('Delete failed');
                showStatus('Deadline deleted');
                loadAndRender();
            } catch (err) { console.error(err); showStatus('Failed to delete task', true); }
        };

        li.appendChild(info);
        li.appendChild(del);
        ul.appendChild(li);
    }
}

let _retryInterval = null;

async function loadAndRender(){
    try {
        const tasks = await fetchTasks();
        renderTasks(tasks);
        // If we previously failed, clear retry timer
        if (_retryInterval) { clearInterval(_retryInterval); _retryInterval = null; showStatus('Loaded deadlines'); }
    } catch (err) {
        console.error(err);
        showStatus('Unable to load tasks. Is the server running?', true);
        // Start a retry loop if not already running
        if (!_retryInterval) {
            _retryInterval = setInterval(async ()=>{
                try {
                    const tasks = await fetchTasks();
                    renderTasks(tasks);
                    clearInterval(_retryInterval);
                    _retryInterval = null;
                    showStatus('Reconnected and loaded deadlines');
                } catch (e) {
                    console.log('Retrying to connect...');
                }
            }, 5000);
        }
    }
}

function showStatus(msg, isError=false) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? 'rgba(64,0,0,0.85)' : 'rgba(0,20,0,0.85)';
    el.style.display = 'block';
    clearTimeout(showStatus._t);
    showStatus._t = setTimeout(()=>{ el.style.display = 'none'; }, 3500);
}

document.addEventListener('DOMContentLoaded', ()=>{
    const form = document.getElementById('deadline-form');

    // If user opened file directly (file://), show instruction and disable form
    if (location.protocol === 'file:') {
        showStatus('Open this app via the server: run `npm start` and visit http://localhost:3000', true);
        form.querySelector('button[type=submit]').disabled = true;
        return;
    }

    form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const name = document.getElementById('name').value.trim();
        const date = document.getElementById('date').value;
        const time = document.getElementById('time').value;
        if (!name || !date || !time) { showStatus('Please fill all fields', true); return; }

        // Build datetime using local interpretation and require future time
        const dt = new Date(`${date}T${time}`);
        if (isNaN(dt.getTime())) { showStatus('Invalid date or time', true); return; }
        if (dt.getTime() <= Date.now()) { showStatus('Please select a future date/time', true); return; }
        const localIso = dt.toISOString();

        try {
            const resp = await fetch(apiBase + '/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, datetime: localIso })
            });
            if (!resp.ok) {
                const errBody = await resp.json().catch(()=>({ error: 'unknown' }));
                showStatus(errBody.error || 'Failed to add deadline', true);
                return;
            }
            form.reset();
            showStatus('Deadline added ✅');
            loadAndRender();
        } catch (err) {
            console.error(err);
            showStatus('Failed to add deadline', true);
        }
    });

    document.getElementById('delete-all-btn').addEventListener('click', async ()=>{
        try {
            const resp = await fetch(apiBase + '/api/tasks/past', { method: 'DELETE' });
            if (!resp.ok) throw new Error('Failed');
            showStatus('Past deadlines deleted');
            loadAndRender();
        } catch (err) {
            console.error(err);
            showStatus('Failed to delete past deadlines', true);
        }
    });

    // Modal handling
    const modal = document.getElementById('reminder-modal');
    const message = document.getElementById('reminder-message');
    const closeSpan = document.querySelector('.close');
    const dismissBtn = document.getElementById('dismiss-reminder');
    function showModal(text){
        message.textContent = text;
        modal.style.display = 'block';
    }
    function hideModal(){ modal.style.display = 'none'; }
    closeSpan.onclick = hideModal;
    dismissBtn.onclick = hideModal;
    window.onclick = (e)=>{ if (e.target === modal) hideModal(); };

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Robust SSE connect with backoff
    let es = null;
    let esBackoff = 1000;
    function connectEvents() {
        if (!window.EventSource) { showStatus('EventSource not supported in this browser', true); return; }
        if (es) try { es.close(); } catch(e) {}
        es = new EventSource('/events');
        es.onopen = ()=>{ showStatus('Connected to deadline events'); esBackoff = 1000; };
        es.onmessage = ()=>{/* heartbeat / generic messages ignored */};
        es.addEventListener('deadline', (ev)=>{
            try {
                const payload = JSON.parse(ev.data);
                const text = `${payload.name} is due now (${new Date(payload.datetime).toLocaleString()})`;
                showModal(text);
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('Deadline Reminder', { body: text });
                }
                loadAndRender();
            } catch (err) { console.error(err); showStatus('Error processing event', true); }
        });
        es.onerror = (e)=>{
            console.warn('SSE error', e);
            showStatus(`Event connection lost, retrying in ${esBackoff/1000}s`, true);
            try { es.close(); } catch (_) {}
            setTimeout(()=>{ esBackoff = Math.min(esBackoff * 2, 30000); connectEvents(); }, esBackoff);
        };
    }

    connectEvents();

    loadAndRender();
});
