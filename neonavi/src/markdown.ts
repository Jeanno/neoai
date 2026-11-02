/**
 * Markdown for the phone page (JOB-17, JOB-18), as the page's own script:
 * `parseMarkdown(text)` gives plain blocks, and `renderMarkdown(text, el)`
 * turns them into elements with the page's `el`, holding the text as text,
 * so nothing in an answer is ever read as HTML. Kept as source so the page
 * embeds it and the tests run the very same code. A backtick cannot appear
 * in it, so it is made from its character code.
 */
export const MARKDOWN_JS = String.raw`
const BT = String.fromCharCode(96)
const INLINE = new RegExp(BT + '([^' + BT + ']+)' + BT + '|' +
  /\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)|\*(?![\s*])([^*]+?)\*|(?<![A-Za-z0-9])_(?![\s_])([^_]+?)_(?![A-Za-z0-9])/.source, 'g')

// JOB-18: only the web; anything else stays the text it was written as.
const safeHref = (url) => (/^https?:\/\//i.test(url) ? url : null)

function parseInline(s) {
  const out = []
  let at = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push({ t: 'text', v: s.slice(at, m.index) })
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] })
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'b', c: parseInline(m[2] ?? m[3]) })
    else if (m[4] !== undefined) {
      const href = safeHref(m[5])
      out.push(href ? { t: 'a', href, c: parseInline(m[4]) } : { t: 'text', v: m[0] })
    } else out.push({ t: 'i', c: parseInline(m[6] ?? m[7]) })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ t: 'text', v: s.slice(at) })
  return out
}

const FENCE = new RegExp('^\\s*(' + BT + '{3,}|~{3,})')
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim()))

function parseMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const code = []
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i])
      blocks.push({ t: 'pre', v: code.join('\n') })
      continue
    }
    if (!line.trim()) { flush(); continue }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) { flush(); blocks.push({ t: 'h', level: heading[1].length, c: parseInline(heading[2]) }); continue }
    if (RULE.test(line)) { flush(); blocks.push({ t: 'hr' }); continue }
    if (line.includes('|') && i + 1 < lines.length && DIVIDER.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush()
      const head = cells(line)
      const rows = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]))
      i--
      blocks.push({ t: 'table', head, rows })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quoted = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quoted.push(lines[i].replace(/^\s*>\s?/, ''))
      i--
      blocks.push({ t: 'quote', c: parseMarkdown(quoted.join('\n')) })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      flush()
      const ordered = /\d/.test(item[1])
      const items = []
      for (; i < lines.length; i++) {
        const next = ITEM.exec(lines[i])
        if (next && /\d/.test(next[1]) === ordered) items.push([next[2]])
        // An indented line goes on with the item before it.
        else if (!next && /^\s+\S/.test(lines[i]) && items.length) items[items.length - 1].push(lines[i].trim())
        else break
      }
      i--
      const start = ordered ? parseInt(item[1], 10) : 1
      blocks.push({ t: ordered ? 'ol' : 'ul', start, items: items.map((parts) => parseInline(parts.join('\n'))) })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

function renderInline(nodes, el) {
  return nodes.map((n) =>
    n.t === 'text' ? n.v
      : n.t === 'code' ? el('code', {}, n.v)
        : n.t === 'b' ? el('strong', {}, renderInline(n.c, el))
          : n.t === 'i' ? el('em', {}, renderInline(n.c, el))
            : el('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer' }, renderInline(n.c, el)))
}

function renderBlocks(blocks, el) {
  return blocks.map((b) =>
    b.t === 'p' ? el('p', {}, renderInline(b.c, el))
      : b.t === 'h' ? el('p', { class: 'mh mh' + b.level }, renderInline(b.c, el))
        : b.t === 'pre' ? el('pre', {}, b.v)
          : b.t === 'hr' ? el('hr')
            : b.t === 'quote' ? el('blockquote', {}, renderBlocks(b.c, el))
              : b.t === 'table' ? el('div', { class: 'mt' }, el('table', {},
                  el('thead', {}, el('tr', {}, b.head.map((c) => el('th', {}, renderInline(c, el))))),
                  el('tbody', {}, b.rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, renderInline(c, el))))))))
                : el(b.t, b.t === 'ol' && b.start !== 1 ? { start: String(b.start) } : {}, b.items.map((c) => el('li', {}, renderInline(c, el)))))
}

function renderMarkdown(text, el) {
  return renderBlocks(parseMarkdown(text), el)
}
`
