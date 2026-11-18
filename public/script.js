const GUARD = { 'X-Requested-With': 'forwarder-ui' }
const $ = (id) => document.getElementById(id)

let groupsData = { groups: [], currentId: '' }
let groupsLoaded = false
let shownDestination = null

// ---- Wording: how a log line becomes a sentence for the activity list ----
const ACTIVITY_RULES = [
    ['forwarded', () => ['Forwarded a message', 'ok']],
    ['connected', () => ['Connected to WhatsApp', 'ok']],
    ['destination set', (d) => ['Destination set · ' + d.destination, 'neutral']],
    ['destination loaded', (d) => ['Destination · ' + d.destination, 'neutral']],
    ['no destination saved', () => ['No destination chosen yet', 'warn']],
    ['no destination yet', () => ['A message was not forwarded: no destination', 'warn']],
    ['QR ready', () => ['Waiting for a QR scan', 'warn']],
    ['connection closed', (d) =>
        d.code === 401 ? ['Logged out', 'warn']
            : d.code === 515 ? ['Restarting after scan (normal)', 'warn']
                : ['Connection lost, reconnecting', 'warn']],
    ['job attempt failed', () => ['A send failed, trying again', 'warn']],
    ['job gave up', () => ['Could not forward a message', 'error']],
    ['queue full', () => ['Queue full: a message was dropped', 'error']],
    ['logout requested', () => ['Log out requested', 'neutral']],
]

function describe(entry) {
    const rule = ACTIVITY_RULES.find(([prefix]) => entry.msg.startsWith(prefix))
    if (!rule) return null                       // not interesting for users
    const [text, tone] = rule[1](entry.details)
    return { time: entry.time, text, tone }
}

// ---- Formatting ----
function fmtTime(iso) {
    const d = new Date(iso)
    return d.toDateString() === new Date().toDateString()
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function fmtUptime(min) {
    if (min < 1) return 'less than a minute'
    if (min < 60) return min + ' min'
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min'
}

// ---- Data ----
async function loadGroups() {
    const res = await fetch('/api/groups')
    if (!res.ok) return false
    groupsData = await res.json()
    return true
}

async function fetchQr() {
    const res = await fetch('/api/qr')
    return res.status === 200 ? (await res.json()).image : null
}

async function loadActivity() {
    const res = await fetch('/api/logs?level=info&limit=100')
    if (!res.ok) return
    const items = (await res.json()).map(describe).filter(Boolean).slice(0, 5)
    const box = $('activity')
    if (items.length === 0) { box.textContent = 'Nothing yet.'; return }
    box.replaceChildren(...items.map((item) => {
        const row = document.createElement('div')
        row.className = 'row ' + item.tone
        const time = document.createElement('time')
        time.textContent = new Date(item.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        const dot = document.createElement('i')
        const text = document.createElement('span')
        text.textContent = item.text
        row.append(time, dot, text)
        return row
    }))
}

function renderLog(entry) {
    const row = document.createElement('div')
    row.className = 'log ' + entry.level
    const date = new Date(entry.time)
    row.title = date.toLocaleString()
    const details = Object.entries(entry.details)
        .map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v))
        .join('  ')
        .slice(0, 300)
    row.textContent =
        date.toLocaleTimeString() + '  ' + entry.level.toUpperCase().padEnd(5) + '  ' +
        entry.msg + (details ? '  ' + details : '')
    return row
}

async function loadLogs() {
    const container = $('logs')
    try {
        const res = await fetch('/api/logs?level=' + encodeURIComponent($('loglevel').value) + '&limit=200')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const entries = await res.json()
        if (entries.length === 0) container.textContent = 'No log lines yet.'
        else container.replaceChildren(...entries.map(renderLog))
    } catch (err) {
        container.textContent = 'Cannot load logs (' + err.message + ')'
    }
}

// ---- Drawing ----
function setView(name) {
    $('mainView').hidden = name !== 'main'
    $('qrView').hidden = name !== 'qr'
    $('connectingView').hidden = name !== 'connecting'
}

function renderStatus(s) {
    const open = s.connection === 'open'
    const noDest = open && s.destination === ''

    $('pill').className = 'pill ' + (open ? 'ok' : s.connection === 'closed' ? 'warn' : '')
    $('pillText').textContent = open ? 'Connected · ' + s.account
        : s.connection === 'closed' ? 'Disconnected' : 'Starting…'

    const current = groupsData.groups.find((g) => g.id === groupsData.currentId)
    $('destCard').classList.toggle('warn', noDest)
    $('destName').textContent = noDest ? 'No destination yet' : (s.destination || '—')
    $('destMeta').textContent = noDest ? 'Messages are not being forwarded'
        : current ? 'Group · ' + current.members + (current.members === 1 ? ' member' : ' members')
            : s.destination ? 'Group' : ''
    $('changeBtn').textContent = noDest ? 'Choose a group' : 'Change'
    $('changeBtn').disabled = !open
    $('logout').disabled = !open

    $('tQueued').textContent = s.queued
    $('tForwarded').textContent = s.forwarded
    $('tWaiting').textContent = s.waiting
    $('tFailed').textContent = s.gaveUp
    $('tileFailed').classList.toggle('bad', s.gaveUp > 0)
    $('meta').textContent = 'Last message ' + (s.lastMessageAt ? fmtTime(s.lastMessageAt) : 'none yet') +
        ' · Running for ' + fmtUptime(s.uptimeMinutes)
}

async function refresh() {
    try {
        const res = await fetch('/api/status')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const s = await res.json()
        $('banner').hidden = true
        const open = s.connection === 'open'

        // Reload the group list when we reconnect or when the destination changed
        if (!open || s.destination !== shownDestination) groupsLoaded = false
        shownDestination = s.destination
        if (open && !groupsLoaded) groupsLoaded = await loadGroups()

        renderStatus(s)

        if (open) {
            setView('main')
            await loadActivity()
        } else {
            const qr = await fetchQr()
            if (qr) $('qr').src = qr
            setView(qr ? 'qr' : 'connecting')
        }
    } catch (err) {
        $('banner').textContent = 'Cannot reach the program (' + err.message + ')'
        $('banner').hidden = false
    }
}

// ---- Actions ----
$('changeBtn').addEventListener('click', async () => {
    await loadGroups()
    const select = $('groups')
    select.replaceChildren(...groupsData.groups.map((g) => {
        const opt = new Option(g.name + ' (' + g.members + (g.members === 1 ? ' member)' : ' members)'), g.id)
        opt.selected = g.id === groupsData.currentId
        return opt
    }))
    $('save').disabled = !select.value
    $('destDialog').showModal()
})

$('groups').addEventListener('change', () => { $('save').disabled = !$('groups').value })

$('save').addEventListener('click', async () => {
    const id = $('groups').value
    if (!id) return
    const res = await fetch('/api/destination', {
        method: 'POST',
        headers: { ...GUARD, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    })
    if (!res.ok) { alert('Could not save the destination (HTTP ' + res.status + ')'); return }
    $('destDialog').close()
    refresh()
})

$('logsBtn').addEventListener('click', () => { $('logsDialog').showModal(); loadLogs() })
$('loglevel').addEventListener('change', loadLogs)

$('logout').addEventListener('click', async () => {
    if (!confirm('Log out of WhatsApp? You will need to scan a QR code again.')) return
    $('logout').disabled = true
    const res = await fetch('/api/logout', { method: 'POST', headers: GUARD })
    if (!res.ok) alert('Logout failed (HTTP ' + res.status + ')')
    refresh()
})

refresh()
setInterval(refresh, 3000)
setInterval(() => { if ($('logsDialog').open) loadLogs() }, 5000)