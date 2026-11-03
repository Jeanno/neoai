# Browser eval

15 of 16 passed, 2026-11-03, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 24 s | 11 (11) | 1 | I can see all the results now. Let me filter for kettles that hold **at least 1.7 litres**: \| Kettle \| Capacity \| Price \| \|---\|---\|-- |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** more 1-star review. Here's the tally across all 3 pages: \| Page \| 1-star reviews \| \|------\|----------------\| \| 1 \|  |
| form | filling a form: text, a list, a checkbox | ✓ | 30 s | 13 (12) | 6 | The contact form has been successfully sent! Here's a summary of what was submitted: - **Name:** Robin Vale - **Email:** robin@example.test  |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order #4471 was placed on 19 Oct and its status is **Out for delivery**. |
| long-table | finding rows in a table of 150 | ✓ | 12 s | 2 (2) | 0 | From the timetable, the last train from **Elm to Harbor** that departs **before 18:00** is the one departing at **17:39**, from **Platform 1 |
| cookie-banner | a banner over the page that must be closed first | ✓ | 12 s | 5 (5) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | You can cancel at any time with **45 days of notice**, in writing. |
| frame | a booking form inside a frame | ✓ | 26 s | 11 (8) | 5 | The table has been successfully booked! Here's the confirmation: - **Restaurant:** The Olive Tree - **Guests:** 2 - **Day:** Friday - **Time |
| dependent-lists | a list filled in by choosing in another | ✓ | 20 s | 9 (7) | 1 | Shipping for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here's the order summary: - **Items:** £22.50 (blue umbrella) - **Shipping:** £4.95 - **Total:** **£27.45** I did not place the order as req |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 8 s | 2 (2) | 0 | April had the highest sales, at **91**. |
| upload | attaching a file from this computer to a form (BRW-19) | ✓ | 32 s | 13 (11) | 5 | Application successfully sent! Here's what happened: 1. ✅ **Full name**: Robin Vale 2. ✅ **CV attached**: robin-vale-cv.txt 3. ✅ **Applicati |
| download | downloading a file, then reading it (BRW-20) | ✓ | 12 s | 4 (3) | 0 | The October sales report shows the following sales: \| Product \| Sales \| \|---------\|-------\| \| Kettles \| 3,120 \| \| Mugs \| 845 \| \ |
| confirm | a delete the page asks "are you sure?" about in a pop-up (BRW-21) | ✓ | 14 s | 5 (5) | 2 | The draft to Old supplier has been deleted. |
| hover-menu | a menu shown only while the pointer is over it (BRW-22) | ✗ | 16 s | 6 (6) | 0 | answer lacks /12[:.]00.{0,6}17[:.]00\|(12\s*pm\|noon).{0,6}5\s*pm/i |
