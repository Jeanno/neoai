import { lastTrainBefore, shippingFor, type Recorded } from './sites.ts'

/** A browser eval task: what navi is asked, and how its answer and what it did are checked. */
export interface Task {
  id: string
  /** What it tests, in a few words. */
  tests: string
  prompt: (base: string) => string
  check: (answer: string, recorded: Recorded) => string | null
  /** Files the task needs in the job's directory, by name. */
  files?: Record<string, string>
}

/** Null when every part is found, else what is missing. */
const has = (answer: string, ...parts: (string | RegExp)[]) => {
  const a = answer.toLowerCase().replace(/\s+/g, ' ')
  const missing = parts.filter((p) => (typeof p === 'string' ? !a.includes(p.toLowerCase()) : !p.test(a)))
  return missing.length ? `answer lacks ${missing.map(String).join(', ')}` : null
}

const posted = (r: Recorded, path: string) => r.posts.filter((p) => p.path === path).at(-1)?.fields

const train = lastTrainBefore('18:00')
const lyon = shippingFor('Lyon', 3).toFixed(2)

export const TASKS: Task[] = [
  {
    id: 'search-compare',
    tests: 'a search drawn by script, then comparing results',
    prompt: (b) => `Use your browser. On ${b}/shop search for kettles and find the cheapest one that holds at least 1.7 litres. Tell me its name and price.`,
    check: (a) => has(a, 'dawn steel', '34.75'),
  },
  {
    id: 'late-page',
    tests: 'a page drawn seconds after it loads',
    prompt: (b) => `Use your browser to open ${b}/support. How many open tickets are there?`,
    check: (a) => has(a, /\b37\b/),
  },
  {
    id: 'pagination',
    tests: 'following Next through pages and counting',
    prompt: (b) => `Use your browser. The reviews at ${b}/reviews go over several pages. How many 1-star reviews are there in total, across all pages?`,
    check: (a) => has(a, /\b(4|four)\b/),
  },
  {
    id: 'form',
    tests: 'filling a form: text, a list, a checkbox',
    prompt: (b) =>
      `Use your browser to send this through the contact form at ${b}/contact: name Robin Vale, email robin@example.test, topic Repairs, message "My kettle lid is stuck." Agree to be contacted, and send it.`,
    check: (_a, r) => {
      const f = posted(r, '/contact/sent')
      if (!f) return 'the form was never sent'
      const want = { name: 'Robin Vale', email: 'robin@example.test', topic: 'Repairs', consent: 'yes' }
      const wrong = Object.entries(want).filter(([k, v]) => f[k] !== v)
      if (wrong.length) return `sent with ${wrong.map(([k]) => `${k}=${JSON.stringify(f[k])}`).join(', ')}`
      return /lid is stuck/i.test(f.message ?? '') ? null : `message was ${JSON.stringify(f.message)}`
    },
  },
  {
    id: 'sign-in',
    tests: 'signing in, then reading behind it',
    prompt: (b) =>
      `Use your browser. Sign in at ${b}/login with username maple.tester and password green-door-42, then tell me the status of order #4471.`,
    check: (a) => has(a, 'out for delivery'),
  },
  {
    id: 'long-table',
    tests: 'finding rows in a table of 150',
    prompt: (b) =>
      `Use your browser. The timetable at ${b}/trains lists trains between several stations. What is the last train from Elm to Harbor that departs before 18:00, and from which platform?`,
    check: (a) => has(a, train.dep, new RegExp(`platform\\D{0,12}${train.platform}\\b|\\b${train.platform}\\b`)),
  },
  {
    id: 'cookie-banner',
    tests: 'a banner over the page that must be closed first',
    prompt: (b) => `Use your browser. On ${b}/bakery, find the bakery's Saturday opening hours.`,
    check: (a) => has(a, /8[:.]?00/, /16[:.]?30|4[:.]30/),
  },
  {
    id: 'new-tab',
    tests: 'a link that opens in a new tab',
    prompt: (b) => `Use your browser. On ${b}/gym, read the membership terms and tell me how much notice is needed to cancel.`,
    check: (a) => has(a, /\b45\b/),
  },
  {
    id: 'frame',
    tests: 'a booking form inside a frame',
    prompt: (b) => `Use your browser to book a table at ${b}/restaurant for 2 people on Friday at 19:30, in the name of Sam Ortiz.`,
    check: (_a, r) => {
      const f = posted(r, '/restaurant/booked')
      if (!f) return 'no booking was made'
      const want = { guests: '2', day: 'Friday', time: '19:30' }
      const wrong = Object.entries(want).filter(([k, v]) => f[k] !== v)
      if (wrong.length) return `booked with ${wrong.map(([k]) => `${k}=${f[k]}`).join(', ')}`
      return /sam ortiz/i.test(f.name ?? '') ? null : `name was ${JSON.stringify(f.name)}`
    },
  },
  {
    id: 'dependent-lists',
    tests: 'a list filled in by choosing in another',
    prompt: (b) => `Use your browser. With the calculator at ${b}/shipping, how much is shipping for a 3 kg parcel to Lyon, France?`,
    check: (a) => has(a, lyon),
  },
  {
    id: 'stop-before-paying',
    tests: 'doing most of a checkout, but not placing the order',
    prompt: (b) =>
      `Use your browser. At ${b}/store, add the blue umbrella to the cart and go to checkout, but do not place the order. Tell me the total including shipping.`,
    check: (a, r) => (r.orders ? 'it placed the order' : has(a, '27.45')),
  },
  {
    id: 'chart',
    tests: 'a chart drawn on a canvas, with no text to read (BRW-18)',
    prompt: (b) => `Use your browser. The page ${b}/sales shows monthly sales as a chart. Which month had the highest sales, and how much?`,
    check: (a) => has(a, /\bapr(il)?\b/, /\b91\b/),
  },
  {
    id: 'upload',
    tests: 'attaching a file from this computer to a form (BRW-19)',
    files: { 'robin-vale-cv.txt': 'Robin Vale. Kettle designer, 8 years.\n' },
    prompt: (b) => `Use your browser to apply for the job at ${b}/apply as Robin Vale, attaching my CV, the file robin-vale-cv.txt in this folder.`,
    check: (_a, r) => {
      const f = posted(r, '/apply/sent')
      if (!f) return 'the application was never sent'
      if (f.cv !== 'robin-vale-cv.txt' || !/Kettle designer/.test(f['cv.content'] ?? '')) return `sent with cv ${JSON.stringify(f.cv)}`
      return /robin vale/i.test(f.name ?? '') ? null : `name was ${JSON.stringify(f.name)}`
    },
  },
]
