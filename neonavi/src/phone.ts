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
<title>navi</title>
<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161615" media="(prefers-color-scheme: dark)">
<style>
  :root {
    --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1b; --muted: #74746e; --line: #e6e6e1;
    --bubble: #ecece8; --accent: #3b5bdb; --accent-text: #ffffff; --wait: #c2410c; --wait-bg: #fff7ed;
    --ok: #2f9e44; --bad: #d6336c; --code: #f1f1ee; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #161615; --card: #20201e; --text: #ececea; --muted: #9b9b95; --line: #2f2f2c;
      --bubble: #2c2c29; --accent: #8ca0ff; --accent-text: #0d0d0c; --wait: #fdba74; --wait-bg: #2a1d10;
      --ok: #69db7c; --bad: #ff8fab; --code: #262624; --shadow: 0 4px 16px rgba(0,0,0,.4);
    }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  #app { max-width: 720px; margin: 0 auto; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 12px; padding: 11px 16px; background: var(--text); color: var(--bg); cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
  button.no { background: var(--card); color: var(--text); border: 1px solid var(--line); }
  button.plain { background: transparent; color: var(--accent); padding: 8px 4px; }
  button.danger { color: var(--bad); }
  textarea, select, input { font: inherit; color: var(--text); }

  /* The bar along the top, as chat apps have it. */
  .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 2px;
    padding: calc(env(safe-area-inset-top) + 6px) 6px 6px; background: var(--bg); border-bottom: 1px solid var(--line); }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
    .bar { background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: saturate(1.6) blur(14px); -webkit-backdrop-filter: saturate(1.6) blur(14px); }
  }
  .bar .title { flex: 1; min-width: 0; padding: 0 6px; }
  .bar .title.center { text-align: center; }
  .bar h1 { font-size: 17px; line-height: 1.25; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar h1.big { font-size: 22px; padding-left: 6px; }
  .bar small { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .icon { width: 40px; height: 40px; flex: none; border-radius: 20px; padding: 0; display: inline-grid; place-items: center; background: transparent; color: var(--text); position: relative; }
  .icon svg { width: 22px; height: 22px; }
  .icon:active { background: var(--bubble); }
  .badge { position: absolute; top: 4px; right: 4px; min-width: 16px; height: 16px; border-radius: 8px; background: var(--wait); color: #fff; font-size: 10px; line-height: 16px; padding: 0 4px; }
  .content { flex: 1; padding: 8px 16px 16px; }

  /* The box to type in, kept at the bottom. */
  .composer { position: sticky; bottom: 0; z-index: 4; padding: 24px 12px calc(env(safe-area-inset-bottom) + 10px);
    background: linear-gradient(to bottom, transparent, var(--bg) 20px); }
  .pill { display: flex; align-items: flex-end; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 26px; padding: 5px; box-shadow: var(--shadow); }
  .pill textarea { flex: 1; min-width: 0; border: 0; background: transparent; resize: none; padding: 8px 6px; max-height: 168px; outline: none; font-size: 16px; line-height: 1.4; }
  .send { width: 38px; height: 38px; flex: none; border-radius: 19px; padding: 0; display: grid; place-items: center; }
  .send svg { width: 20px; height: 20px; }
  .send:disabled { opacity: .2; }
  .attach { width: 38px; height: 38px; flex: none; border-radius: 19px; display: grid; place-items: center; color: var(--muted); cursor: pointer; }
  .attach svg { width: 22px; height: 22px; }
  .attach input { display: none; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 2px 8px; }
  .chip { font-size: 13px; font-weight: 500; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; line-height: 1.3; max-width: 100%; }
  .chip svg { width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px; }
  select.chip { -webkit-appearance: none; appearance: none; padding-right: 26px; min-width: 0; text-overflow: ellipsis;
    background: var(--card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 10px center / 10px 6px; }
  input.chip[type=time] { padding: 4px 10px; }
  label.chip { display: inline-flex; gap: 6px; align-items: center; }
  label.chip input { margin: 0; width: 16px; height: 16px; accent-color: var(--accent); }
  .file { display: inline-flex; align-items: center; gap: 2px; padding: 4px 4px 4px 10px; }
  .file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .file button { padding: 0 6px; background: none; color: var(--muted); font-size: 18px; line-height: 1; }

  /* The list of chats. */
  .find { width: 100%; background: var(--bubble); border: 0; border-radius: 12px; padding: 9px 12px; margin: 4px 0 6px; outline: none; }
  .row-link { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin: 6px 0 10px; font-weight: 500; }
  .row-link span { flex: 1; } .row-link .meta { flex: none; }
  .chat { display: flex; gap: 12px; width: 100%; text-align: left; background: none; color: var(--text); border: 0; border-radius: 0; border-bottom: 1px solid var(--line); padding: 13px 2px; font-weight: 400; }
  .chat:active { background: var(--bubble); }
  .chat .body { flex: 1; min-width: 0; }
  .chat .top { display: flex; gap: 8px; align-items: baseline; }
  .chat .t { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chat .when { flex: none; font-size: 12px; color: var(--muted); }
  .chat .pv { color: var(--muted); font-size: 14px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .chat .pv.s-waiting { color: var(--wait); font-weight: 600; } .chat .pv.s-failed, .chat .pv.s-interrupted { color: var(--bad); }
  .dot { width: 9px; height: 9px; border-radius: 5px; margin-top: 7px; flex: none; background: var(--line); }
  .dot.s-done { background: var(--ok); } .dot.s-failed, .dot.s-interrupted { background: var(--bad); }
  .dot.s-waiting { background: var(--wait); animation: pulse 1.4s ease-in-out infinite; }
  .dot.s-running, .dot.s-queued { background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .hello { text-align: center; padding: 18vh 16px 24px; }
  .hello b { display: block; font-size: 24px; margin-bottom: 6px; }
  .hello span { color: var(--muted); }
  .clear { display: block; margin: 14px auto 0; font-size: 14px; }

  /* A chat, as a thread. */
  .thread { display: flex; flex-direction: column; gap: 18px; padding-top: 10px; }
  .you { align-self: flex-end; max-width: 86%; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .bubble { background: var(--bubble); border-radius: 20px 20px 6px 20px; padding: 9px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .navi { overflow-wrap: anywhere; }
  .navi .from { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
  .working { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 15px; }
  .dots { display: inline-flex; gap: 4px; } .dots i { width: 6px; height: 6px; border-radius: 3px; background: var(--muted); animation: bounce 1.2s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
  @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .4; } 40% { transform: translateY(-4px); opacity: 1; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px; }
  .approval { border-color: var(--wait); background: var(--wait-bg); }
  .approval .head { font-weight: 700; color: var(--wait); font-size: 14px; margin-bottom: 6px; }
  .buttons { display: flex; gap: 8px; margin-top: 12px; } .buttons > button { flex: 1; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .actions .chip { cursor: pointer; }
  details.steps summary { cursor: pointer; color: var(--muted); font-size: 14px; list-style: none; }
  details.steps summary::-webkit-details-marker { display: none; }
  details.steps summary::before { content: '›'; display: inline-block; width: 14px; transition: transform .15s; }
  details.steps[open] summary::before { transform: rotate(90deg); }
  .meta { color: var(--muted); font-size: 13px; }
  .err { color: var(--bad); font-size: 14px; margin: 8px 0 0; }
  .note { color: var(--muted); text-align: center; padding: 32px 8px; }
  pre { background: var(--code); border-radius: 10px; padding: 10px 12px; overflow-x: auto; font: 12.5px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; }
  .suggest { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
  .suggest:first-of-type { border-top: 0; }
  .suggest > div { flex: 1; min-width: 0; }
  .suggest button { padding: 7px 12px; font-size: 14px; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .form .chips { margin: 0; }

  /* Formatted answers (JOB-17). */
  .md { white-space: normal; }
  .md > :first-child { margin-top: 0; } .md > :last-child { margin-bottom: 0; }
  .md p, .md ul, .md ol, .md blockquote, .md .mt, .md pre { margin: 0 0 12px; }
  .md p { white-space: pre-line; }
  .md ul, .md ol { padding-left: 22px; } .md li { margin: 3px 0; white-space: pre-line; }
  .md .mh { font-weight: 700; margin-top: 16px; } .md .mh1, .md .mh2 { font-size: 1.15em; }
  .md code { background: var(--code); border-radius: 5px; padding: 1px 5px; font: .88em ui-monospace, Menlo, monospace; }
  .md pre code { background: none; padding: 0; }
  .md blockquote { border-left: 3px solid var(--line); padding-left: 10px; color: var(--muted); }
  .md hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  .md .mt { overflow-x: auto; }
  .md table { border-collapse: collapse; font-size: 14px; }
  .md th, .md td { border: 1px solid var(--line); padding: 5px 9px; text-align: left; vertical-align: top; }
  .md a { color: var(--accent); word-break: break-all; }

  /* Lists of facts and schedules. */
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 22px 4px 8px; }
  .group { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .fact { display: flex; align-items: center; gap: 8px; padding: 10px 6px 10px 14px; border-top: 1px solid var(--line); }
  .fact:first-child { border-top: 0; }
  .fact span { flex: 1; overflow-wrap: anywhere; }
  .fact button { padding: 6px 10px; color: var(--muted); font-size: 20px; line-height: 1; }
  .group .empty { padding: 14px; color: var(--muted); font-size: 14px; }
  .sched { padding: 14px; border-top: 1px solid var(--line); }
  .sched:first-child { border-top: 0; }
  .sched .status { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); }
  .sched .status.paused { color: var(--muted); }
  .sched .p { display: block; margin: 3px 0; overflow-wrap: anywhere; }
  .runs { display: flex; align-items: center; gap: 2px; margin-top: 6px; }
  .runs .meta { margin-right: 4px; }
  button.run { background: none; color: var(--text); padding: 2px 6px; min-width: 28px; font-size: 17px; line-height: 1.2; border-radius: 6px; }
  .run.s-done { color: var(--ok); } .run.s-failed, .run.s-interrupted { color: var(--bad); } .run.s-stopped { color: var(--muted); }
  .sched .actions .chip { flex: 1 0 auto; text-align: center; }
  .sched textarea, .form textarea { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 10px; resize: vertical; min-height: 70px; }
</style>
</head>
<body>
<div id="app"><p class="note">Loading…</p></div>
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
  let remembering = false, memory = { facts: [], off: false, projects: [] }, fact = '', about = ''
  // Whether a job's steps are unfolded, kept across refreshes; which screen; the thread last scrolled to.
  let stepsOpen = false, scheduling = false, seen = '', from = ''
  // MEM-23: what the model found worth remembering from the open job, and which were kept.
  let suggested = null
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
    return el('div', { class: 'sched form' },
      el('textarea', { id: 'edit-prompt', 'aria-label': 'Prompt', oninput: (ev) => { e.prompt = ev.target.value; save.disabled = busy || !e.prompt.trim() } }, e.prompt),
      el('div', { class: 'chips' },
        el('select', { id: 'edit-repeat', class: 'chip', 'aria-label': 'When', onchange: (ev) => { e.repeat = ev.target.value; render() } },
          (repeatOf(s) === 'keep' ? [['keep', 'As it is: ' + when(s)]] : []).concat(REPEATS.slice(1))
            .map(([v, t]) => el('option', { value: v, selected: v === e.repeat }, t))),
        editTimed({ ...e, at: s.at }) && el('input', { id: 'edit-time', class: 'chip', type: 'time', 'aria-label': 'Time', value: e.time, oninput: (ev) => (e.time = ev.target.value) })),
      el('label', { class: 'chip', style: 'align-self:flex-start' },
        el('input', { id: 'edit-quiet', type: 'checkbox', checked: e.quiet, onchange: (ev) => (e.quiet = ev.target.checked) }),
        'Only tell me when something changes'),
      el('div', { class: 'buttons', style: 'margin-top:0' },
        el('button', { class: 'no', onclick: () => { editing = null; failed = ''; render() } }, 'Cancel'),
        save = el('button', { disabled: busy || !e.prompt.trim(), onclick: () => saveEdit(s) }, 'Save')))
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

  // Icons, drawn as the system's own are: a stroke, no fill.
  const ICONS = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    send: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    memory: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  }
  const icon = (name) => {
    const s = document.createElement('span')
    s.style.display = 'contents'
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'
    return s
  }
  const bar = (left, title, right) => el('header', { class: 'bar' }, left, title, right)
  const back = () => el('button', { class: 'icon', 'aria-label': 'Back', onclick: () => {
    // A job opened from Schedules goes back there.
    const toSchedules = !!open && from === 'schedules'
    open = null; job = null; reply = ''; more = []; remembering = false; scheduling = toSchedules; from = ''; failed = ''; repeating = null; suggested = null; seen = ''
    render(); refresh(); window.scrollTo(0, 0)
  } }, icon('back'))
  const STATUS = { queued: 'Queued', running: 'Working', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped', interrupted: 'Interrupted' }
  const statusOf = (j) => j.unchanged ? 'Nothing new' : STATUS[j.status] || j.status
  const firstLine = (t) => (t || '').split('\\n').find((l) => l.trim()) || ''
  // What a chat row says under its title: what navi asks, how it ended, or its answer's first line.
  const preview = (j) => j.status === 'waiting' && j.pending ? 'Needs you: ' + j.pending.command
    : j.status === 'done' && j.answer && !j.unchanged ? plain(j.answer)
    : j.error ? statusOf(j) + ': ' + firstLine(j.error) : statusOf(j)
  // A line of an answer without its marks, for a preview.
  const plain = (t) => firstLine(t).replace(/^\\s*(#+|[-*>]|\\d+\\.)\\s+/, '').replace(/[*_\x60]+/g, '')
  // A textarea grows with what is typed, up to a few lines.
  const fit = (t) => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 168) + 'px' }

  // The box at the bottom: a pill with ＋ for files, the text, and a round send button.
  function composer(o) {
    const list = o.files
    const chosen = list && list.length > 0 && el('div', { class: 'chips' }, list.map((f, i) => el('span', { class: 'chip file' },
      el('span', {}, f.name),
      el('button', { 'aria-label': 'Remove ' + f.name, onclick: () => { list.splice(i, 1); render() } }, '×'))))
    const attach = list && list.length < 4 && el('label', { class: 'attach', title: 'Add photo or file' }, icon('plus'),
      el('input', { type: 'file', multiple: true, 'aria-label': 'Add photo or file', onchange: (e) => act(async () => {
        for (const file of [...e.target.files].slice(0, 4 - list.length)) list.push(await readPicked(file))
      }) }))
    let go
    const text = el('textarea', { id: o.id, rows: 1, placeholder: o.placeholder, 'aria-label': o.placeholder,
      oninput: (e) => { o.set(e.target.value); fit(e.target); if (go) go.disabled = busy || !e.target.value.trim() },
      // Enter sends on a keyboard with Shift for a new line; a phone's return key makes a new line.
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window) && e.target.value.trim() && !busy && !o.stop) { e.preventDefault(); o.send() } } }, o.value)
    go = o.stop
      ? el('button', { class: 'send', 'aria-label': 'Stop', title: 'Stop', disabled: busy, onclick: o.stop }, icon('stop'))
      : el('button', { class: 'send', 'aria-label': o.label || 'Send', title: o.label || 'Send', disabled: busy || !o.value.trim(), onclick: o.send }, icon('send'))
    return el('footer', { class: 'composer' }, o.chips, chosen, el('div', { class: 'pill' }, attach, text, go))
  }

  // The turns of a job as a thread: what was asked, and what navi answered.
  function thread() {
    const live = job.status === 'queued' || job.status === 'running' || job.status === 'waiting'
    const turns = (job.turns && job.turns.length ? job.turns : [{ prompt: job.prompt, files: job.files }]).map((t) => ({ ...t }))
    const last = turns[turns.length - 1]
    if (!live && !last.answer && job.answer) last.answer = job.answer
    const steps = job.log.filter((l) => /^[·✓✗↶]/.test(l)).length
    return el('div', { class: 'thread' }, turns.map((t, i) => {
      const isLast = i === turns.length - 1
      return [
        el('div', { class: 'you' },
          t.files && el('div', { class: 'chips' }, t.files.map((f) => el('span', { class: 'chip' }, f))),
          el('div', { class: 'bubble' }, t.prompt)),
        isLast
          ? el('div', { class: 'navi' },
              // What it did, folded away as chat apps fold their tool calls.
              job.log.length > 0 && el('details', { class: 'steps', open: stepsOpen, ontoggle: (e) => (stepsOpen = e.target.open) },
                el('summary', {}, steps ? 'Worked through ' + steps + ' step' + (steps === 1 ? '' : 's') : 'What it did'),
                el('pre', {}, job.log.join('\\n'))),
              job.pending && approval(),
              live && !job.pending && el('div', { class: 'working', style: job.log.length ? 'margin-top:8px' : false }, el('span', { class: 'dots' }, el('i'), el('i'), el('i')), latest() || (job.status === 'queued' ? 'Queued' : 'Working')),
              // JOB-17: formatted, as elements holding the text.
              !live && t.answer && el('div', { class: 'md', style: job.log.length ? 'margin-top:10px' : false }, renderMarkdown(t.answer, el)),
              job.error && el('p', { class: 'err' }, job.error),
              !live && job.status === 'stopped' && !t.answer && el('div', { class: 'meta' }, 'Stopped.'),
              !live && after())
          : el('div', { class: 'navi' }, t.answer ? el('div', { class: 'md' }, renderMarkdown(t.answer, el)) : el('div', { class: 'meta' }, 'No answer')),
      ]
    }))
  }

  // What navi did last, as a chat app says what it is doing: a line of its log.
  const latest = () => (job.log[job.log.length - 1] || '').replace(/^[·\\s]+/, '').slice(0, 120)
  // What an undo just did, said where it was asked for (UND-13): the log's last undo, if nothing came after it.
  const undone = () => {
    const at = job.log.map((l) => l.startsWith('↶')).lastIndexOf(true)
    return at < 0 ? [] : job.log.slice(at + 1).filter((l) => /^\\s/.test(l)).map((l) => l.trim())
  }

  // An approval, in the thread where it is asked.
  const approval = () => el('div', { class: 'card approval', style: 'margin-top:10px' },
    el('div', { class: 'head' }, 'Allow this?'),
    el('pre', {}, job.pending.command),
    job.pending.url && el('div', { class: 'meta', style: 'margin-top:6px' }, 'On ' + job.pending.url),
    job.pending.diff && el('pre', {}, job.pending.diff),
    el('div', { class: 'buttons' },
      el('button', { class: 'no', disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: false })) }, 'No'),
      el('button', { disabled: busy, onclick: () => act(() => api('/jobs/' + job.id + '/answer', { yes: true })) }, 'Yes')))

  // What can be done with a finished job, as chips under its answer.
  function after() {
    const chip = (label, onclick, extra = {}) => el('button', { class: 'chip', disabled: busy, onclick, ...extra }, label)
    return [
      // JOB-35: an answer cut at the token cap goes on with one tap.
      job.cut && el('div', { class: 'meta', style: 'margin-top:10px' }, 'Cut short: the answer reached the model’s token cap.'),
      // UND-13: what it changed can be put back.
      job.changes && job.changes.length > 0 && el('div', { class: 'meta', style: 'margin-top:10px' }, 'Changed ' + job.changes.join(', ')),
      undone().length > 0 && el('div', { class: 'meta', style: 'margin-top:10px' }, 'Undone: ' + undone().join('; ')),
      el('div', { class: 'actions' },
        job.cut && chip('Go on', () => act(() => api('/jobs/' + job.id + '/reply', { prompt: 'Go on from where you stopped.' }))),
        job.changes && job.changes.length > 0 && chip('Undo changes', () => {
          if (confirm('Put back the files this job changed? Files edited since are left alone.')) act(() => api('/jobs/' + job.id + '/undo', {}))
        }),
        // MEM-23: asked for, never by itself.
        job.suggests && !(suggested && suggested.id === job.id) && chip('Anything to remember?', () => act(async () => {
          suggested = { id: job.id, list: (await api('/jobs/' + job.id + '/suggest', {})).suggestions, kept: [] }
        })),
        // JOB-34: a job that went well, again on a schedule.
        !job.schedule && !repeating && chip('Repeat this…', () => { repeating = { repeat: 'daily', time: '08:00', quiet: false }; failed = ''; render() }),
        // JOB-26: done with, it can go.
        chip('Delete job', () => {
          if (confirm('Delete this job? Its answer and log go; files it changed stay as they are.')) act(async () => {
            await api('/jobs/' + job.id + '/delete', {}); open = null; job = null; reply = ''; more = []
          })
        }, { style: 'color:var(--bad)' })),
      suggested && suggested.id === job.id && el('div', { class: 'card', style: 'margin-top:12px' },
        suggested.list.length
          ? [el('div', { class: 'meta' }, 'Worth remembering?'), suggested.list.map((s) => el('div', { class: 'suggest' },
              el('div', {}, el('div', {}, s.fact), el('div', { class: 'meta' }, s.project ? 'About ' + short(s.project) : 'About you')),
              suggested.kept.includes(s.fact)
                ? el('span', { class: 'meta' }, 'Remembered')
                : el('button', { disabled: busy, onclick: () => act(async () => {
                    await api('/memory', s.project ? { fact: s.fact, project: s.project } : { fact: s.fact })
                    suggested.kept.push(s.fact)
                  }) }, 'Remember')))]
          : el('div', { class: 'meta' }, 'Nothing new to remember from this job.')),
      repeating && el('div', { class: 'card form', style: 'margin-top:12px' },
        el('div', { class: 'meta' }, 'Repeat this job'),
        el('div', { class: 'chips' },
          el('select', { id: 'again-repeat', class: 'chip', 'aria-label': 'Repeat', onchange: (e) => { repeating.repeat = e.target.value; render() } },
            REPEATS.slice(1).map(([v, t]) => el('option', { value: v, selected: v === repeating.repeat }, t))),
          (repeating.repeat === 'daily' || repeating.repeat === 'weekdays') &&
            el('input', { id: 'again-time', class: 'chip', type: 'time', 'aria-label': 'Repeat at', value: repeating.time, oninput: (e) => (repeating.time = e.target.value) }),
          el('label', { class: 'chip' },
            el('input', { id: 'again-quiet', type: 'checkbox', checked: repeating.quiet, onchange: (e) => (repeating.quiet = e.target.checked) }),
            'Only tell me when something changes')),
        el('div', { class: 'buttons', style: 'margin-top:0' },
          el('button', { class: 'no', onclick: () => { repeating = null; render() } }, 'Cancel'),
          el('button', { disabled: busy, onclick: () => act(async () => {
            const r = repeating
            await api('/jobs/' + job.id + '/schedule', { quiet: r.quiet,
              ...(r.repeat === 'daily' || r.repeat === 'weekdays' ? { at: r.time, ...(r.repeat === 'weekdays' && { days: [1, 2, 3, 4, 5] }) } : { every: Number(r.repeat) }) })
            // To Schedules, where the new one is.
            repeating = null; open = null; job = null; reply = ''; more = []; scheduling = true
          }) }, 'Schedule'))),
    ]
  }

  function render() {
    // A half-typed prompt survives the refresh.
    const active = document.activeElement?.id
    if (!token) {
      put(bar(null, el('div', { class: 'title' }, el('h1', { class: 'big' }, 'navi'))),
        el('p', { class: 'note' }, 'Open the link that navi jobs link prints on your computer.'))
      return
    }
    const waiting = jobs.filter((j) => j.status === 'waiting').length
    const finished = jobs.filter((j) => !['queued', 'running', 'waiting'].includes(j.status)).length
    const err = (failed || problem) && el('p', { class: 'err' }, failed || problem)
    if (remembering) {
      // MEM-19: a project's facts too, for the directories navi serve offers.
      const projects = memory.projects || []
      if (about && !projects.some((p) => p.root === about)) about = ''
      const add = () => act(async () => { memory = await api('/memory', about ? { fact, project: about } : { fact }); fact = '' })
      const factList = (facts, project) => facts.map((f) => el('div', { class: 'fact' },
        el('span', {}, f),
        el('button', { class: 'plain', 'aria-label': 'Forget ' + f, disabled: busy, onclick: () => {
          if (confirm('Forget this?\\n\\n' + f)) act(async () => { memory = await api('/memory/forget', project ? { fact: f, project } : { fact: f }) })
        } }, '×')))
      put(bar(back(), el('div', { class: 'title center' }, el('h1', {}, 'What navi remembers')), el('span', { class: 'icon' })),
        el('main', { class: 'content' },
          el('h2', {}, 'About you'),
          el('div', { class: 'group' },
            memory.facts.length
              ? factList(memory.facts)
              : el('div', { class: 'empty' }, (projects.some((p) => p.facts.length) ? 'Nothing about you yet.' : 'Nothing yet.') + ' navi asks before it remembers anything, or add a fact below.')),
          projects.filter((p) => p.facts.length).map((p) => [
            el('h2', { title: p.root }, 'About ' + short(p.root)),
            el('div', { class: 'group' }, factList(p.facts, p.root))]),
          el('p', { class: 'meta', style: 'margin:14px 4px' }, memory.off
            ? 'Memory is off ("memory": false in the config), so none of this goes with your turns.'
            : projects.some((p) => p.facts.length)
              ? 'Yours go with every turn, and a project' + String.fromCharCode(39) + 's with every turn in it, to whichever model answers.'
              : 'These go with every turn, to whichever model answers.'),
          err),
        composer({ id: 'fact', placeholder: about ? 'Something navi should know about this project' : 'Something navi should know about you', label: 'Remember',
          value: fact, set: (v) => (fact = v), send: add,
          chips: projects.length > 0 && el('div', { class: 'chips' },
            el('select', { id: 'about', class: 'chip', 'aria-label': 'About', onchange: (e) => { about = e.target.value; render() } },
              [el('option', { value: '', selected: !about }, 'About you')].concat(projects.map((p) => el('option', { value: p.root, selected: p.root === about }, 'About ' + short(p.root)))))) }))
    } else if (scheduling) {
      put(bar(back(), el('div', { class: 'title center' }, el('h1', {}, 'Schedules')), el('span', { class: 'icon' })),
        el('main', { class: 'content' },
          schedules.length
            ? el('div', { class: 'group', style: 'margin-top:8px' }, schedules.map((s) => editing && editing.id === s.id ? editForm(s) : el('div', { class: 'sched' },
                el('div', { class: 'status' + (s.paused ? ' paused' : '') }, (s.stuck ? 'Paused after ' + (s.failures || 3) + ' failed runs · ' : s.paused ? 'Paused · ' : '') + when(s) + (s.quiet ? ' · watch' : '')),
                el('span', { class: 'p' }, s.prompt),
                el('span', { class: 'meta' }, (s.paused ? 'Not running' : s.retryAt ? 'Trying again ' + soon(s.retryAt) : 'Next ' + soon(s.next)) + ' · ' + short(s.directory)),
                // SCH-24: how its last runs went, oldest first; each opens its job.
                s.runs && s.runs.length > 0 && el('div', { class: 'runs' }, el('span', { class: 'meta' }, 'Last runs'),
                  s.runs.slice().reverse().map((r) => el('button', { class: 'run s-' + (r.unchanged ? 'stopped' : r.status),
                    'aria-label': (r.unchanged ? 'nothing new' : r.status) + ', ' + ago(r.created), title: (r.unchanged ? 'nothing new' : r.status) + ', ' + ago(r.created),
                    onclick: () => { open = r.id; scheduling = false; from = 'schedules'; failed = ''; refresh() } }, mark(r)))),
                el('div', { class: 'actions' },
                  el('button', { class: 'chip', disabled: busy, onclick: () => act(async () => { open = (await api('/schedules/' + s.id + '/run', {})).id; scheduling = false; from = 'schedules' }) }, 'Run now'),
                  // SCH-21
                  el('button', { class: 'chip', disabled: busy, onclick: () => act(() => api('/schedules/' + s.id + (s.paused ? '/resume' : '/pause'), {})) }, s.paused ? 'Resume' : 'Pause'),
                  el('button', { class: 'chip', disabled: busy, onclick: () => { editing = { id: s.id, prompt: s.prompt, repeat: repeatOf(s), time: s.at || '08:00', quiet: !!s.quiet }; failed = ''; render() } }, 'Edit'),
                  el('button', { class: 'chip', style: 'color:var(--bad)', disabled: busy, onclick: () => { if (confirm('Delete this schedule?')) act(() => api('/schedules/' + s.id + '/delete', {})) } }, 'Delete')))))
            : el('p', { class: 'note' }, 'No schedules yet. Pick Every hour or Every day in the box on the first page to make one.'),
          err))
    } else if (open && job) {
      // JOB-23: a queued job is stopped as one running is.
      const live = job.status === 'queued' || job.status === 'running' || job.status === 'waiting'
      put(bar(back(),
          el('div', { class: 'title center' }, el('h1', {}, firstLine(job.prompt)),
            el('small', {}, statusOf(job) + ' · ' + short(job.directory) + (job.model ? ' · ' + job.model : ''))),
          el('span', { class: 'icon' })),
        el('main', { class: 'content' }, thread(), err),
        composer({ id: 'reply', placeholder: live ? 'navi is working…' : 'Follow up…', files: live ? null : more, value: reply, set: (v) => (reply = v),
          stop: live && (() => act(() => api('/jobs/' + job.id + '/stop', {}))),
          // JOB-20: files with the follow-up, as with a new job.
          send: () => act(async () => {
            await api('/jobs/' + job.id + '/reply', { prompt: reply, ...(more.length && { files: more }) })
            reply = ''; more = []
          }) }))
      // A thread opens at its end, and follows it as it grows.
      const now = job.id + '|' + (job.turns || []).length + '|' + job.status + '|' + job.log.length
      if (now !== seen) { seen = now; requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight)) }
    } else {
      const shownJobs = jobs.filter((j) => holds(j, find))
      put(bar(null, el('div', { class: 'title' }, el('h1', { class: 'big' }, 'navi')),
          [el('button', { class: 'icon', 'aria-label': 'Schedules', title: 'Schedules', onclick: () => { scheduling = true; failed = ''; render(); window.scrollTo(0, 0) } }, icon('clock'),
              schedules.length > 0 && el('span', { class: 'badge', style: 'background:var(--muted)' }, String(schedules.length))),
            el('button', { class: 'icon', 'aria-label': 'What navi remembers', title: 'What navi remembers', onclick: () => { remembering = true; failed = ''; refresh(); window.scrollTo(0, 0) } }, icon('memory'))]),
        el('main', { class: 'content' },
          jobs.length > 3 && el('input', { id: 'find', type: 'search', class: 'find', placeholder: 'Search', 'aria-label': 'Find a job', value: find, autocomplete: 'off',
            oninput: (e) => { find = e.target.value; render() } }),
          jobs.length && find.trim() && !shownJobs.length && el('p', { class: 'note' }, 'No job mentions ' + find.trim() + '.'),
          jobs.length
            ? shownJobs.map((j) => el('button', { class: 'chat', onclick: () => { open = j.id; failed = ''; refresh() } },
                el('span', { class: 'dot s-' + j.status, 'aria-hidden': 'true' }),
                el('span', { class: 'body' },
                  el('span', { class: 'top' }, el('span', { class: 't' }, firstLine(j.prompt)), el('span', { class: 'when' }, ago(j.updated || j.created))),
                  el('span', { class: 'pv s-' + j.status }, preview(j)))))
            : el('div', { class: 'hello' }, el('b', {}, 'What should navi do?'), el('span', {}, 'It works on this computer while you are away, and asks before it changes anything.')),
          finished > 0 && el('button', { class: 'plain clear', disabled: busy, onclick: () => {
            if (confirm('Delete ' + finished + ' finished job' + (finished === 1 ? '' : 's') + '? Any still working are kept.')) act(() => api('/jobs/clear', {}))
          } }, 'Clear finished jobs'),
          err),
        composer({ id: 'draft', placeholder: repeat === 'now' ? 'Ask navi' : 'What should it do each time?', label: repeat === 'now' ? 'Start' : 'Schedule',
          files: repeat === 'now' ? picked : null, value: draft, set: (v) => (draft = v),
          chips: el('div', { class: 'chips' },
            dirs.length > 1 && el('select', { class: 'chip', 'aria-label': 'Folder', onchange: (e) => (dir = e.target.value) }, dirs.map((d) => el('option', { value: d, selected: d === dir }, short(d)))),
            el('select', { id: 'repeat', class: 'chip', 'aria-label': 'When', onchange: (e) => { repeat = e.target.value; render() } }, REPEATS.map(([v, t]) => el('option', { value: v, selected: v === repeat }, t))),
            timed() && el('input', { id: 'time', class: 'chip', type: 'time', 'aria-label': 'Time', value: time, oninput: (e) => (time = e.target.value) }),
            repeat !== 'now' && el('label', { class: 'chip' },
              el('input', { id: 'quiet', type: 'checkbox', checked: quiet, onchange: (e) => (quiet = e.target.checked) }),
              'Only tell me when something changes')),
          send: () => act(async () => {
            const where = dir ? { directory: dir } : {}
            if (repeat === 'now') {
              open = (await api('/jobs', { prompt: draft, ...where, ...(picked.length && { files: picked }) })).id
              picked = []
            } else {
              await api('/schedules', { prompt: draft, ...where, quiet,
                ...(timed() ? { at: time, ...(repeat === 'weekdays' && { days: [1, 2, 3, 4, 5] }) } : { every: Number(repeat) }) })
              repeat = 'now'; quiet = false; scheduling = true
            }
            draft = ''
          }) }))
      document.title = waiting ? '(' + waiting + ') navi' : 'navi'
    }
    for (const t of app.querySelectorAll('.pill textarea')) fit(t)
    if (active) {
      const again = document.getElementById(active)
      if (again) {
        again.focus()
        // A list, time or checkbox has no caret to put back.
        if (again.tagName === 'TEXTAREA' || again.type === 'search') { const n = again.value.length; again.setSelectionRange(n, n) }
      }
    }
  }

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
