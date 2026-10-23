# Browser

A browser navi drives for pages fetch_url cannot read: ones that need the
user's login, or that are drawn by scripts. Pages are read as text, never as
screenshots, and each action answers with what it changed, so the model never
has to look at the whole page again to see what happened.

## The browser

- BRW-1: navi's browser is its own Chromium window with its own profile in
  `~/.neoai/browser`, separate from every browser the user browses with:
  navi never opens, reads or drives those. The user signs in to sites there
  once, with `navi browser` (BRW-12), and navi uses those logins from then on.
- BRW-2: It is started on first use and stays open when navi exits, so a
  login, and a page left open, survive. Every navi on the computer uses the
  same window, each session in a tab of its own, opened on first use (a
  window navi starts opens on that tab, with no blank one beside it); a tab the user closes is
  opened afresh when next needed. Closing the window is the user's way to
  stop it; navi never closes it.
- BRW-3: navi talks to it over Chrome's debugging port, on 127.0.0.1 only,
  found through the profile. A browser that has gone away is started again.
- BRW-4: It runs the browser `"browser": { "executable": "<path>" }` in
  `~/.neoai/config.json` names, else the Chromium navi installs (BRW-12), else
  Google Chrome when installed. With none, a browser tool answers that there
  is no browser and how to install one; a configured one that does not exist
  is named as such, and nothing else is started or installed in its place.

## Reading

- BRW-5: A page is read as its accessibility tree in text: one line per
  heading, link, button, field, image and run of text, indented under its
  landmark, with layout-only wrappers, URLs, and where focus and the pointer
  are left out. Every element that can be
  clicked, typed into or chosen from carries `[ref=…]`, the handle the
  actions take. A page longer than 8000 characters is cut on a line boundary
  and says how many lines remain and which offset continues. A page that
  cannot be read as elements within 10s (some deeply nested tables take
  Playwright minutes) is read as its plain text instead, saying so: it can be
  read but not acted on by ref, and is read so, without waiting again, until
  its tab moves to another URL.
- BRW-6: `browser_open(url)` opens an http or https page in the session's tab
  and returns its title, its URL after redirects, and its first part (BRW-5).
  Any other scheme is refused.
- BRW-7: `browser_read(offset?, find?)` reads the page as it is now, from
  line `offset`, or only the lines holding `find` (case-insensitive), each
  with its line number and the landmark or heading it sits under, at most
  50.
- BRW-8: `browser_back()` goes back one page and returns it as browser_open
  does.

## Acting

- BRW-9: `browser_click(ref)`, `browser_type(ref, text, submit?)` (replacing
  what the field holds, then pressing Enter when `submit`),
  `browser_select(ref, option)` (by the option's label only, never its
  value, which can stand behind another label) and `browser_press(key)` act
  on the current tab. A ref the page no longer has returns a message saying
  to read the page again, never a throw. An action waits for the page to
  settle (at most 5s: loaded, the network quiet, then nothing on the page
  changing for 300ms, nor marked busy or saying it is loading) before answering, and so does opening a page. Pages
  are read after their scripts run, so a page drawn by scripts reads as it
  shows once drawn.
- BRW-10: An action answers with what changed: a new page answers as
  browser_open; on the same page, the lines that appeared, at most 40, and
  how many went; or that nothing on the page changed.
- BRW-11: Opening, reading and going back run without asking. Every action
  is described in one line, such as `click button "Place order" on
  www.example.com`, and judged first: it runs unasked only when the judge
  calls it safe, meaning it only navigates or reveals (following a link,
  opening a menu or tab, paging, sorting, typing into a search box and
  searching; a link to another site is still following a link). Anything that sends, posts, buys, books, deletes, signs in or
  out, accepts terms or changes a setting, and anything the judge cannot
  tell, asks the user, who sees the line and the page's URL. The line says
  where the action really lands: a key press names the element with focus,
  an element in a frame from another site names that site (`on bank.com (in
  a frame on evil.com)`), and a link to another site names where it goes. Element names
  come from the page, so the judge is told they may lie, and a ref is read
  only where the snapshot puts one, never from the page's words. Just before
  an approved action is done, it is described again: when its page moved on
  (another URL, or the ref now names something else) nothing is done and the
  model is told to read the page again. A session's tab does one thing at a
  time, held from an action's description to its doing, so another call
  cannot move the page in between. Under `"approve":
  "ask"` every action asks. An action is never offered "always". A decline
  returns a message telling the model not to retry it (TL-15).

## Tabs

- BRW-14: A session may have several tabs: `browser_open(url, new_tab)`
  opens one beside the current one, `browser_tabs()` lists the session's
  tabs (`t1`, `t2`, …) with titles and URLs and marks the current one,
  `browser_switch(tab)` makes one current and reads it, and
  `browser_close_tab(tab)` closes one of the session's own. Actions land in
  the current tab. Once there is more than one, a page read names its tab.
- BRW-15: A tab a page opens itself (a link to a new window, a popup) from
  one of the session's tabs becomes one of the session's, and current; the
  action that opened it answers with that tab's page and says so.

## Commands

- BRW-12: `navi browser` opens the window on a new tab, for signing in,
  installing Chromium first when there is no browser (BRW-4). `navi browser
  --install` installs, or updates, Chromium for navi.

## Settings

- BRW-13: `"browser": false` in `~/.neoai/config.json` removes the browser
  tools, and so does `"web_search": false` (TL-30). The tools are also left
  out when a front end does not ask for them.

## Open

- MCP: offer the browser tools to other agents directly, with the client's
  own approval for actions.
- Downloads and file uploads.
