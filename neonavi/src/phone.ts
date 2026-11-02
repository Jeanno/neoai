import { MARKDOWN_JS } from './markdown.ts'

/**
 * The page navi serve gives a phone (JOB-10, SCH-12): jobs, their approvals,
 * schedules, and a box to start either. It holds no secret: the token comes
 * in the link's fragment, which no server sees, and stays in the phone's
 * storage.
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
  input.find { width: 100%; font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; margin-bottom: 12px; }
  select { margin-top: 8px; }
  .row > select, .row > input[type=time] { margin-top: 0; flex: 1; min-width: 0; }
  input[type=time] { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; }
  .check { display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 15px; }
  .check input { width: 20px; height: 20px; margin: 0; accent-color: var(--accent); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 20px 4px 8px; }
  .sched .p { display: block; margin: 2px 0; }
  .sched .status { color: var(--accent); }
  .sched .status.paused { color: var(--muted); }
  .runs { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
  .runs .meta { margin-right: 4px; }
  button.run { background: none; padding: 2px 6px; min-width: 28px; font-size: 17px; line-height: 1.2; border-radius: 6px; }
  .sched .row { flex-wrap: wrap; }
  .sched .row button { white-space: nowrap; padding-left: 6px; padding-right: 6px; flex: 1 0 auto; }
  .files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .file { display: inline-flex; align-items: center; gap: 4px; background: var(--code); border-radius: 8px; padding: 2px 2px 2px 10px; font-size: 14px; max-width: 100%; }
  .file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file button { padding: 4px 8px; }
  .pick { display: inline-block; color: var(--accent); font-weight: 600; padding: 8px 4px; cursor: pointer; }
  .pick input { display: none; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 11px 16px; background: var(--accent); color: var(--accent-text); }
  button.plain { background: transparent; color: var(--accent); padding: 8px 4px; }
  button.more { display: block; margin: 0 0 4px; font-weight: 600; }
  .fact { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
  .fact:first-child { border-top: 0; }
  .fact span { flex: 1; padding-top: 8px; overflow-wrap: anywhere; }
  .fact button { padding: 8px 10px; }
  textarea.one { min-height: 0; }
  button.no { background: var(--code); color: var(--text); }
  button:disabled { opacity: .5; }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  .row > button { flex: 1; }
  .job { display: block; width: 100%; text-align: left; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-bottom: 8px; font-weight: 400; }
  .job .p { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); font-size: 13px; }
  .status { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .s-waiting { color: var(--wait); } .s-done { color: var(--ok); } .s-failed, .s-interrupted { color: var(--bad); }
  .s-running, .s-queued, .s-stopped { color: var(--muted); }
  .pending { background: var(--wait-bg); border-color: var(--wait); }
  pre { background: var(--code); border-radius: 8px; padding: 10px; overflow-x: auto; font: 12.5px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; }
  .answer { white-space: pre-wrap; word-break: break-word; }
  .earlier summary { color: var(--accent); font-weight: 600; cursor: pointer; }
  .turn { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
  .asked { white-space: pre-wrap; word-break: break-word; font-weight: 600; margin-bottom: 6px; }
  .md { white-space: normal; }
  .md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
  .md p, .md ul, .md ol, .md blockquote, .md .mt, .md pre { margin: 0 0 10px; }
  .md p { white-space: pre-line; }
  .md ul, .md ol { padding-left: 22px; } .md li { margin: 2px 0; white-space: pre-line; }
  .md .mh { font-weight: 700; margin-top: 14px; } .md .mh1, .md .mh2 { font-size: 1.15em; }
  .md code { background: var(--code); border-radius: 5px; padding: 1px 5px; font: .9em ui-monospace, Menlo, monospace; }
  .md pre code { background: none; padding: 0; }
  .md blockquote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 12px 0; }
  .md .mt { overflow-x: auto; }
  .md table { border-collapse: collapse; font-size: 14px; }
  .md th, .md td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
  .md a { color: var(--accent); word-break: break-all; }
  .empty, .note { color: var(--muted); text-align: center; padding: 24px 8px; }
  .err { color: var(--bad); font-size: 14px; margin-top: 8px; }
</style>
</head>
<body>
<main id="app"><p class="note">Loading…</p></main>
<script>
${MARKDOWN_JS}
(() => {
  const KEY = 'navi-token'
  const store = {
    get() { try { return localStorage.getItem(KEY) } catch { return null } },
    set(v) { try { localStorage.setItem(KEY, v) } catch {} },
  }
  // The token arrives as #<token> and is taken out of the address at once;
  // a push opens a job as #job=<id> (PSH-5).
  const hash = location.hash.slice(1)
  let token = /^[0-9a-f]{64}$/.test(hash) ? hash : store.get()
  const linked = /^job=([0-9a-f]{8})$/.exec(hash)?.[1] ?? null
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

  // SCH-12: how a schedule runs, in words, and when it next does.
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const when = (s) => s.every
    ? (s.every % 60 ? 'Every ' + s.every + ' min' : s.every === 60 ? 'Every hour' : 'Every ' + s.every / 60 + ' h')
    : 'At ' + s.at + (!s.days ? ' every day' : s.days.join() === '1,2,3,4,5' ? ' on weekdays' : s.days.join() === '0,6' ? ' at weekends' : ' on ' + s.days.map((d) => DAYS[d]).join(', '))
  const mark = (r) => r.status === 'done' ? (r.unchanged ? '–' : '✓') : r.status === 'failed' || r.status === 'interrupted' ? '✗' : r.status === 'stopped' ? '■' : '…'
  const soon = (iso) => {
    const t = new Date(iso), mins = Math.round((t - Date.now()) / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return 'in ' + mins + ' min'
    const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
    const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
    return (days === 0 ? 'today ' : days === 1 ? 'tomorrow ' : DAYS[t.getDay()] + ' ') + hm
  }
  // What the start box makes: a job now, or a schedule.
  const REPEATS = [['now', 'Once, now'], ['30', 'Every 30 minutes'], ['60', 'Every hour'], ['daily', 'Every day at…'], ['weekdays', 'Weekdays at…']]
  const timed = () => repeat === 'daily' || repeat === 'weekdays'

  let jobs = [], schedules = [], dirs = [], open = linked, job = null, problem = '', failed = '', draft = '', reply = '', dir = '', busy = false
  let repeat = 'now', time = '08:00', quiet = false
  // MEM-13: what navi remembers, on a page of its own.
  let remembering = false, memory = { facts: [], off: false }, fact = ''
  // JOB-28: whether a job's earlier turns are shown, kept across refreshes.
  let earlierOpen = false
  // JOB-34: repeating the open job on a schedule, as { repeat, time, quiet }, or null.
  let repeating = null
  // SCH-18: the schedule being edited, as { id, prompt, repeat, time, quiet }, kept across refreshes.
  let editing = null
  const repeatOf = (s) => s.every === 30 ? '30' : s.every === 60 ? '60' : !s.at ? 'keep'
    : !s.days ? 'daily' : s.days.join() === '1,2,3,4,5' ? 'weekdays' : 'keep'
  const editTimed = (e) => e.repeat === 'daily' || e.repeat === 'weekdays' || (e.repeat === 'keep' && e.at)
  function saveEdit(s) {
    const e = editing
    const body = { prompt: e.prompt, quiet: e.quiet }
    if (e.repeat === '30' || e.repeat === '60') body.every = Number(e.repeat)
    else if (e.repeat === 'daily') Object.assign(body, { at: e.time, days: null })
    else if (e.repeat === 'weekdays') Object.assign(body, { at: e.time, days: [1, 2, 3, 4, 5] })
    else if (s.at && e.time !== s.at) Object.assign(body, { at: e.time, days: s.days ?? null })
    return act(async () => { await api('/schedules/' + s.id + '/edit', body); editing = null })
  }
  function editForm(s) {
    const e = editing
    return el('div', { class: 'card sched' },
      el('textarea', { id: 'edit-prompt', 'aria-label': 'Prompt', oninput: (ev) => { e.prompt = ev.target.value; save.disabled = busy || !e.prompt.trim() } }, e.prompt),
      el('div', { class: 'row' },
        el('select', { id: 'edit-repeat', 'aria-label': 'When', onchange: (ev) => { e.repeat = ev.target.value; render() } },
          (repeatOf(s) === 'keep' ? [['keep', 'As it is: ' + when(s)]] : []).concat(REPEATS.slice(1))
            .map(([v, t]) => el('option', { value: v, selected: v === e.repeat }, t))),
        editTimed({ ...e, at: s.at }) && el('input', { id: 'edit-time', type: 'time', 'aria-label': 'Time', value: e.time, oninput: (ev) => (e.time = ev.target.value) })),
      el('label', { class: 'check' },
        el('input', { id: 'edit-quiet', type: 'checkbox', checked: e.quiet, onchange: (ev) => (e.quiet = ev.target.checked) }),
        'Only tell me when something changes'),
      el('div', { class: 'row' },
        save = el('button', { disabled: busy || !e.prompt.trim(), onclick: () => saveEdit(s) }, 'Save'),
        el('button', { class: 'no', onclick: () => { editing = null; failed = ''; render() } }, 'Cancel')))
  }
  let save

  // JOB-30: the words the job list is narrowed to.
  let find = ''
  const holds = (j, words) => {
    const hay = [j.prompt, j.answer, j.error, j.status].filter(Boolean).join(' ').toLowerCase()
    return words.toLowerCase().split(/\\s+/).filter(Boolean).every((w) => hay.includes(w))
  }
  // The files chosen for a new job and for a follow-up, as { name, data } with data base64 (JOB-16, JOB-20).
  let picked = [], more = []

  // A photo is sent as a JPEG at most 1600 pixels on a side, which also turns
  // an iPhone's HEIC into something navi reads; anything else goes as it is.
  async function readPicked(file) {
    if (file.type.startsWith('image/') && file.type !== 'image/gif') {
      try {
        const bitmap = await createImageBitmap(file)
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(bitmap.width * scale)
        canvas.height = Math.round(bitmap.height * scale)
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
        return { name: file.name.replace(/\.[^.]*$/, '') + '.jpg', data }
      } catch {}
    }
    const data = await new Promise((done, fail) => {
      const reader = new FileReader()
      reader.onload = () => done(String(reader.result).split(',')[1] || '')
      reader.onerror = () => fail(reader.error)
      reader.readAsDataURL(file)
    })
    return { name: file.name, data }
  }

  // The chosen files, each with a way to remove it, and a button to add more, up to 4.
  function filePicker(list) {
    return el('div', {},
      list.length > 0 && el('div', { class: 'files' }, list.map((f, i) => el('span', { class: 'file' },
        el('span', {}, f.name),
        el('button', { class: 'plain', 'aria-label': 'Remove ' + f.name, onclick: () => { list.splice(i, 1); render() } }, '×')))),
      list.length < 4 && el('label', { class: 'pick' }, 'Add photo or file',
        el('input', { type: 'file', multiple: true, 'aria-label': 'Add photo or file', onchange: (e) => act(async () => {
          for (const file of [...e.target.files].slice(0, 4 - list.length)) list.push(await readPicked(file))
        }) })))
  }

  async function refresh() {
    if (!token) return render()
    try {
      jobs = (await api('/jobs')).jobs
      // A navi serve from before schedules has none to give.
      schedules = (await api('/schedules').catch(() => ({ schedules: [] }))).schedules
      if (!dirs.length) { dirs = (await api('/jobs/directories')).directories; dir = dir || dirs[0] || '' }
      // A job that is gone (pruned, or a stale link) goes back to the list.
      job = open ? await api('/jobs/' + open).catch((e) => { open = null; throw e }) : null
      if (remembering) memory = await api('/memory')
      problem = ''
    } catch (e) { problem = e.message }
    render()
  }

  async function act(fn) {
    busy = true; render()
    // What an action could not do stays said until the next, past the refresh after it.
    failed = ''
    try { await fn() } catch (e) { failed = e.message }
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
    const finished = jobs.filter((j) => !['queued', 'running', 'waiting'].includes(j.status)).length
    const head = el('h1', {}, open || remembering ? el('button', { class: 'plain', onclick: () => { open = null; job = null; reply = ''; more = []; remembering = false; failed = ''; earlierOpen = false; repeating = null; render(); refresh() } }, '‹ Jobs') : 'navi',
      el('small', {}, waiting ? waiting + ' waiting' : jobs.some((j) => j.status === 'running' || j.status === 'queued') ? 'working' : ''))
    const err = (failed || problem) && el('p', { class: 'err' }, failed || problem)
    if (remembering) {
      const add = () => act(async () => { memory = await api('/memory', { fact }); fact = '' })
      put(head,
        el('h2', {}, 'What navi remembers'),
        el('div', { class: 'card' },
          memory.facts.length
            ? memory.facts.map((f) => el('div', { class: 'fact' },
                el('span', {}, f),
                el('button', { class: 'plain', 'aria-label': 'Forget ' + f, disabled: busy, onclick: () => {
                  if (confirm('Forget this?\\n\\n' + f)) act(async () => { memory = await api('/memory/forget', { fact: f }) })
                } }, '×')))
            : el('p', { class: 'meta' }, 'Nothing yet. navi asks before it remembers anything, or add a fact here.')),
        el('div', { class: 'card' },
          el('textarea', { id: 'fact', class: 'one', rows: 2, maxlength: 300, placeholder: 'Something navi should know about you', oninput: (e) => { fact = e.target.value; addButton.disabled = busy || !fact.trim() },
            onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (fact.trim() && !busy) add() } } }, fact),
          el('div', { class: 'row' }, addButton = el('button', { disabled: busy || !fact.trim(), onclick: add }, 'Remember'))),
        el('p', { class: 'meta' }, memory.off
          ? 'Memory is off ("memory": false in the config), so none of this goes with your turns.'
          : 'These go with every turn, to whichever model answers.'),
        err)
    } else if (open && job) {
      // JOB-23: a queued job is stopped as one running is.
      const live = job.status === 'queued' || job.status === 'running' || job.status === 'waiting'
      const turns = job.turns || []
      put(head,
        el('div', { class: 'card' },
          el('div', { class: 'status s-' + job.status }, job.unchanged ? 'nothing new' : job.status),
          el('div', { class: 'answer' }, job.prompt),
          el('div', { class: 'meta' }, short(job.directory) + (job.model ? ' · ' + job.model : '') + ' · ' + ago(job.created)),
          job.files && el('div', { class: 'meta' }, 'With ' + job.files.join(', '))),
        // JOB-28: after a follow-up, the turns before it folded away, and what was asked last.
        turns.length > 1 && el('details', { class: 'card earlier', open: earlierOpen, ontoggle: (e) => (earlierOpen = e.target.open) },
          el('summary', {}, 'Earlier in this job (' + (turns.length - 1) + ')'),
          turns.slice(0, -1).map((t) => el('div', { class: 'turn' },
            el('div', { class: 'asked' }, t.prompt),
            t.files && el('div', { class: 'meta' }, 'With ' + t.files.join(', ')),
            t.answer ? el('div', { class: 'md' }, renderMarkdown(t.answer, el)) : el('div', { class: 'meta' }, 'No answer')))),
        turns.length > 1 && el('div', { class: 'card' }, el('div', { class: 'meta' }, 'Then you asked'), el('div', { class: 'answer' }, turns[turns.length - 1].prompt)),
        job.pending && el('div', { class: 'card pending' },
          el('div', { class: 'status s-waiting' }, 'Allow this?'),
          el('pre', {}, job.pending.command),
          job.pending.url && el('div', { class: 'meta' }, 'On ' + job.pending.url),
          job.pending.diff && el('pre', {}, job.pending.diff),
          el('div', { class: 'row' },
            el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: false })) }, 'No'),
            el('button', { disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: true })) }, 'Yes'))),
        // JOB-17: formatted, as elements holding the text.
        job.answer && el('div', { class: 'card answer md' }, renderMarkdown(job.answer, el)),
        job.error && el('p', { class: 'err' }, job.error),
        job.log.length > 0 && el('div', { class: 'card' }, el('div', { class: 'meta' }, 'What it did'), el('pre', {}, job.log.join('\\n'))),
        // UND-13: what it changed can be put back once it is done; what happened goes in the log above.
        !live && job.changes && job.changes.length > 0 && el('div', { class: 'card' },
          el('div', { class: 'meta' }, 'Changed ' + job.changes.join(', ')),
          el('div', { class: 'row' }, el('button', { class: 'no', disabled: busy, onclick: () => {
            if (confirm('Put back the files this job changed? Files edited since are left alone.')) act(() => api('/jobs/' + job.id + '/undo', {}))
          } }, 'Undo changes'))),
        live
          ? el('div', { class: 'row' }, el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/stop', {})) }, 'Stop'))
          : el('div', { class: 'card' },
              el('textarea', { id: 'reply', placeholder: 'Follow up…', oninput: (e) => (reply = e.target.value) }, reply),
              // JOB-20: files with the follow-up, as with a new job.
              filePicker(more),
              el('div', { class: 'row' }, el('button', { disabled: busy || !reply.trim(), onclick: () => act(async () => {
                await api('/jobs/' + job.id + '/reply', { prompt: reply, ...(more.length && { files: more }) })
                reply = ''; more = []
              }) }, 'Send'))),
        // JOB-34: a job that went well, again on a schedule.
        !live && !job.schedule && (repeating
          ? el('div', { class: 'card' },
              el('div', { class: 'meta' }, 'Repeat this job'),
              el('div', { class: 'row' },
                el('select', { id: 'again-repeat', 'aria-label': 'Repeat', onchange: (e) => { repeating.repeat = e.target.value; render() } },
                  REPEATS.slice(1).map(([v, t]) => el('option', { value: v, selected: v === repeating.repeat }, t))),
                (repeating.repeat === 'daily' || repeating.repeat === 'weekdays') &&
                  el('input', { id: 'again-time', type: 'time', 'aria-label': 'Repeat at', value: repeating.time, oninput: (e) => (repeating.time = e.target.value) })),
              el('label', { class: 'check' },
                el('input', { id: 'again-quiet', type: 'checkbox', checked: repeating.quiet, onchange: (e) => (repeating.quiet = e.target.checked) }),
                'Only tell me when something changes'),
              el('div', { class: 'row' },
                el('button', { disabled: busy, onclick: () => act(async () => {
                  const r = repeating
                  await api('/jobs/' + job.id + '/schedule', { quiet: r.quiet,
                    ...(r.repeat === 'daily' || r.repeat === 'weekdays' ? { at: r.time, ...(r.repeat === 'weekdays' && { days: [1, 2, 3, 4, 5] }) } : { every: Number(r.repeat) }) })
                  repeating = null; open = null; job = null; reply = ''; more = []; earlierOpen = false
                }) }, 'Schedule'),
                el('button', { class: 'no', onclick: () => { repeating = null; render() } }, 'Cancel')))
          : el('button', { class: 'plain more', onclick: () => { repeating = { repeat: 'daily', time: '08:00', quiet: false }; failed = ''; render() } }, 'Repeat this…')),
        // JOB-26: done with, it can go.
        !live && el('button', { class: 'plain more', disabled: busy, onclick: () => {
          if (confirm('Delete this job? Its answer and log go; files it changed stay as they are.')) act(async () => {
            await api('/jobs/' + job.id + '/delete', {}); open = null; job = null; reply = ''; more = []
          })
        } }, 'Delete job'),
        err)
    } else {
      put(head,
        el('div', { class: 'card' },
          el('textarea', { id: 'draft', placeholder: 'What should navi do?', oninput: (e) => { draft = e.target.value; start.disabled = busy || !draft.trim() } }, draft),
          dirs.length > 1 && el('select', { onchange: (e) => (dir = e.target.value) }, dirs.map((d) => el('option', { value: d, selected: d === dir }, short(d)))),
          el('div', { class: 'row' },
            el('select', { id: 'repeat', 'aria-label': 'When', onchange: (e) => { repeat = e.target.value; render() } }, REPEATS.map(([v, t]) => el('option', { value: v, selected: v === repeat }, t))),
            timed() && el('input', { id: 'time', type: 'time', 'aria-label': 'Time', value: time, oninput: (e) => (time = e.target.value) })),
          repeat === 'now' && filePicker(picked),
          repeat !== 'now' && el('label', { class: 'check' },
            el('input', { id: 'quiet', type: 'checkbox', checked: quiet, onchange: (e) => (quiet = e.target.checked) }),
            'Only tell me when something changes'),
          el('div', { class: 'row' }, start = el('button', { disabled: busy || !draft.trim(), onclick: () => act(async () => {
            const where = dir ? { directory: dir } : {}
            if (repeat === 'now') {
              open = (await api('/jobs', { prompt: draft, ...where, ...(picked.length && { files: picked }) })).id
              picked = []
            } else {
              await api('/schedules', { prompt: draft, ...where, quiet,
                ...(timed() ? { at: time, ...(repeat === 'weekdays' && { days: [1, 2, 3, 4, 5] }) } : { every: Number(repeat) }) })
              repeat = 'now'; quiet = false
            }
            draft = ''
          }) }, repeat === 'now' ? 'Start' : 'Schedule'))),
        err,
        el('button', { class: 'plain more', onclick: () => { remembering = true; failed = ''; refresh() } }, 'What navi remembers ›'),
        schedules.length > 0 && el('h2', {}, 'Schedules'),
        schedules.map((s) => editing && editing.id === s.id ? editForm(s) : el('div', { class: 'card sched' },
          el('div', { class: 'status' + (s.paused ? ' paused' : '') }, (s.paused ? 'Paused · ' : '') + when(s) + (s.quiet ? ' · watch' : '')),
          el('span', { class: 'p' }, s.prompt),
          el('span', { class: 'meta' }, (s.paused ? 'Not running' : 'Next ' + soon(s.next)) + ' · ' + short(s.directory)),
          // SCH-24: how its last runs went, oldest first; each opens its job.
          s.runs && s.runs.length > 0 && el('div', { class: 'runs' }, el('span', { class: 'meta' }, 'Last runs'),
            s.runs.slice().reverse().map((r) => el('button', { class: 'run s-' + (r.unchanged ? 'stopped' : r.status),
              'aria-label': (r.unchanged ? 'nothing new' : r.status) + ', ' + ago(r.created), title: (r.unchanged ? 'nothing new' : r.status) + ', ' + ago(r.created),
              onclick: () => { open = r.id; failed = ''; refresh() } }, mark(r)))),
          el('div', { class: 'row' },
            el('button', { class: 'no', disabled: busy, onclick: () => act(async () => { open = (await api('/schedules/' + s.id + '/run', {})).id }) }, 'Run now'),
            // SCH-21
            el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/schedules/' + s.id + (s.paused ? '/resume' : '/pause'), {})) }, s.paused ? 'Resume' : 'Pause'),
            el('button', { class: 'no', disabled: busy, onclick: () => { editing = { id: s.id, prompt: s.prompt, repeat: repeatOf(s), time: s.at || '08:00', quiet: !!s.quiet }; failed = ''; render() } }, 'Edit'),
            el('button', { class: 'no', disabled: busy, onclick: () => { if (confirm('Delete this schedule?')) act(() => api('/schedules/' + s.id + '/delete', {})) } }, 'Delete')))),
        schedules.length > 0 && el('h2', {}, 'Jobs'),
        jobs.length > 3 && el('input', { id: 'find', type: 'search', class: 'find', placeholder: 'Find a job', value: find, autocomplete: 'off',
          oninput: (e) => { find = e.target.value; render() } }),
        jobs.length && find.trim() && !jobs.some((j) => holds(j, find)) && el('p', { class: 'empty' }, 'No job mentions ' + find.trim() + '.'),
        jobs.length ? jobs.filter((j) => holds(j, find)).map((j) => el('button', { class: 'job', onclick: () => { open = j.id; failed = ''; refresh() } },
          el('span', { class: 'status s-' + j.status }, j.unchanged ? 'nothing new' : j.status),
          el('span', { class: 'p' }, j.prompt),
          el('span', { class: 'meta' }, ago(j.created) + (j.model ? ' · ' + j.model : ''))))
          : el('p', { class: 'empty' }, 'No jobs yet.'),
        finished > 0 && el('button', { class: 'plain more', disabled: busy, onclick: () => {
          if (confirm('Delete ' + finished + ' finished job' + (finished === 1 ? '' : 's') + '? Any still working are kept.')) act(() => api('/jobs/clear', {}))
        } }, 'Clear finished jobs'))
    }
    if (active) {
      const again = document.getElementById(active)
      if (again) {
        again.focus()
        // A list, time or checkbox has no caret to put back.
        if (again.tagName === 'TEXTAREA' || again.type === 'search') { const n = again.value.length; again.setSelectionRange(n, n) }
      }
    }
  }
  let start, addButton

  refresh()
  // Every few seconds, and at once when the page comes back into view; never
  // while a list, time or checkbox has focus, which a redraw would close (SCH-13).
  const picking = () => ['SELECT', 'INPUT'].includes(document.activeElement?.tagName)
  setInterval(() => { if (!document.hidden && !busy && !picking()) refresh() }, 3000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
})()
</script>
</body>
</html>
`
