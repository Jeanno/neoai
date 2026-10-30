/**
 * The page navi serve gives a phone (JOB-10): jobs, their approvals, and a
 * box to start one. It holds no secret: the token comes in the link's
 * fragment, which no server sees, and stays in the phone's storage.
 */
export const PHONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>navi jobs</title>
<style>
  :root {
    --bg: #f6f6f4; --card: #ffffff; --text: #1c1c1a; --muted: #6b6b66; --line: #e3e3de;
    --accent: #3b5bdb; --accent-text: #ffffff; --wait: #b35c00; --wait-bg: #fff4e5;
    --ok: #2b8a3e; --bad: #c92a2a; --code: #f1f1ee;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141413; --card: #1e1e1c; --text: #ececea; --muted: #9a9a94; --line: #30302d;
      --accent: #7b93ff; --accent-text: #0d0d0c; --wait: #ffb35c; --wait-bg: #2e2210;
      --ok: #69db7c; --bad: #ff8787; --code: #262624;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: max(16px, env(safe-area-inset-top)) 16px 48px; }
  h1 { font-size: 22px; margin: 4px 0 16px; display: flex; justify-content: space-between; align-items: center; }
  h1 small { font-size: 13px; color: var(--muted); font-weight: 400; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
  textarea, select { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  textarea { min-height: 84px; resize: vertical; }
  select { margin-top: 8px; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 11px 16px; background: var(--accent); color: var(--accent-text); }
  button.plain { background: transparent; color: var(--accent); padding: 8px 4px; }
  button.no { background: var(--code); color: var(--text); }
  button:disabled { opacity: .5; }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  .row > button { flex: 1; }
  .job { display: block; width: 100%; text-align: left; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 8px; font-weight: 400; }
  .job .p { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); font-size: 13px; }
  .status { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .s-waiting { color: var(--wait); } .s-done { color: var(--ok); } .s-failed, .s-interrupted { color: var(--bad); }
  .s-running, .s-stopped { color: var(--muted); }
  .pending { background: var(--wait-bg); border-color: var(--wait); }
  pre { background: var(--code); border-radius: 8px; padding: 10px; overflow-x: auto; font: 12.5px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; }
  .answer { white-space: pre-wrap; word-break: break-word; }
  .empty, .note { color: var(--muted); text-align: center; padding: 24px 8px; }
  .err { color: var(--bad); font-size: 14px; margin-top: 8px; }
</style>
</head>
<body>
<main id="app"><p class="note">Loading…</p></main>
<script>
(() => {
  const KEY = 'navi-token'
  const store = {
    get() { try { return localStorage.getItem(KEY) } catch { return null } },
    set(v) { try { localStorage.setItem(KEY, v) } catch {} },
  }
  // The token arrives as #<token> and is taken out of the address at once.
  const hash = location.hash.slice(1)
  let token = /^[0-9a-f]{64}$/.test(hash) ? hash : store.get()
  if (hash) { if (token === hash) store.set(hash); history.replaceState(null, '', location.pathname) }

  const app = document.getElementById('app')
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v)
    }
    e.append(...shown(kids))
    return e
  }
  // Lists flattened; nothing, false and empty strings left out.
  const shown = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false && k !== '')
  const put = (...kids) => app.replaceChildren(...shown(kids))
  // The last two parts of a path say enough on a phone.
  const short = (d) => { const p = d.split('/').filter(Boolean); return p.length > 2 ? '…/' + p.slice(-2).join('/') : d }
  const api = async (path, body) => {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, ...(body && { 'content-type': 'application/json' }) },
      body: body && JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error?.message || 'navi answered ' + r.status)
    return data
  }
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'
  }

  let jobs = [], dirs = [], open = null, job = null, problem = '', draft = '', reply = '', dir = '', busy = false

  async function refresh() {
    if (!token) return render()
    try {
      jobs = (await api('/jobs')).jobs
      if (!dirs.length) { dirs = (await api('/jobs/directories')).directories; dir = dir || dirs[0] || '' }
      job = open ? await api('/jobs/' + open) : null
      problem = ''
    } catch (e) { problem = e.message }
    render()
  }

  async function act(fn) {
    busy = true; render()
    try { await fn(); problem = '' } catch (e) { problem = e.message }
    busy = false
    await refresh()
  }

  function render() {
    // A half-typed prompt survives the refresh.
    const active = document.activeElement?.id
    if (!token) {
      put(el('h1', {}, 'navi'), el('p', { class: 'note' }, 'Open the link that navi jobs link prints on your computer.'))
      return
    }
    const waiting = jobs.filter((j) => j.status === 'waiting').length
    const head = el('h1', {}, open ? el('button', { class: 'plain', onclick: () => { open = null; job = null; render(); refresh() } }, '‹ Jobs') : 'navi',
      el('small', {}, waiting ? waiting + ' waiting' : jobs.some((j) => j.status === 'running') ? 'working' : ''))
    const err = problem && el('p', { class: 'err' }, problem)
    if (open && job) {
      const live = job.status === 'running' || job.status === 'waiting'
      put(head,
        el('div', { class: 'card' },
          el('div', { class: 'status s-' + job.status }, job.status),
          el('div', { class: 'answer' }, job.prompt),
          el('div', { class: 'meta' }, short(job.directory) + (job.model ? ' · ' + job.model : '') + ' · ' + ago(job.created))),
        job.pending && el('div', { class: 'card pending' },
          el('div', { class: 'status s-waiting' }, 'Allow this?'),
          el('pre', {}, job.pending.command),
          job.pending.url && el('div', { class: 'meta' }, 'On ' + job.pending.url),
          job.pending.diff && el('pre', {}, job.pending.diff),
          el('div', { class: 'row' },
            el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: false })) }, 'No'),
            el('button', { disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: true })) }, 'Yes'))),
        job.answer && el('div', { class: 'card answer' }, job.answer),
        job.error && el('p', { class: 'err' }, job.error),
        job.log.length > 0 && el('div', { class: 'card' }, el('div', { class: 'meta' }, 'What it did'), el('pre', {}, job.log.join('\\n'))),
        live
          ? el('div', { class: 'row' }, el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/stop', {})) }, 'Stop'))
          : el('div', { class: 'card' },
              el('textarea', { id: 'reply', placeholder: 'Follow up…', oninput: (e) => (reply = e.target.value) }, reply),
              el('div', { class: 'row' }, el('button', { disabled: busy || !reply.trim(), onclick: () => act(async () => { await api('/jobs/' + job.id + '/reply', { prompt: reply }); reply = '' }) }, 'Send'))),
        err)
    } else {
      put(head,
        el('div', { class: 'card' },
          el('textarea', { id: 'draft', placeholder: 'What should navi do?', oninput: (e) => { draft = e.target.value; start.disabled = busy || !draft.trim() } }, draft),
          dirs.length > 1 && el('select', { onchange: (e) => (dir = e.target.value) }, dirs.map((d) => el('option', { value: d, selected: d === dir }, short(d)))),
          el('div', { class: 'row' }, start = el('button', { disabled: busy || !draft.trim(), onclick: () => act(async () => {
            const made = await api('/jobs', { prompt: draft, ...(dir && { directory: dir }) })
            draft = ''; open = made.id
          }) }, 'Start'))),
        err,
        jobs.length ? jobs.map((j) => el('button', { class: 'job', onclick: () => { open = j.id; refresh() } },
          el('span', { class: 'status s-' + j.status }, j.status),
          el('span', { class: 'p' }, j.prompt),
          el('span', { class: 'meta' }, ago(j.created) + (j.model ? ' · ' + j.model : ''))))
          : el('p', { class: 'empty' }, 'No jobs yet.'))
    }
    if (active) { const again = document.getElementById(active); if (again) { again.focus(); const n = again.value.length; again.setSelectionRange?.(n, n) } }
  }
  let start

  refresh()
  // Every few seconds, and at once when the page comes back into view.
  setInterval(() => { if (!document.hidden && !busy) refresh() }, 3000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
})()
</script>
</body>
</html>
`
