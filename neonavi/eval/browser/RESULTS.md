# Browser eval

14 of 14 passed, 2026-11-03, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 18 s | 9 (9) | 0 | I found 7 kettles. Let me filter for those that hold **at least 1.7 litres** and find the cheapest: \| Kettle \| Capacity \| Price \| \|---\ |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** 1-star review (Review 12). This is the last page (no "Next" link). **Total 1-star reviews across all 3 pages: 4** |
| form | filling a form: text, a list, a checkbox | ✓ | 28 s | 13 (12) | 5 | The contact form has been sent successfully! Here's a summary of what was submitted: - **Name:** Robin Vale - **Email:** robin@example.test  |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order **#4471** (placed on 19 Oct) has status: **Out for delivery**. |
| long-table | finding rows in a table of 150 | ✓ | 20 s | 1 (1) | 0 | I can see the timetable data. Let me identify all trains from **Elm to Harbor** that depart **before 18:00**. From the data I already have,  |
| cookie-banner | a banner over the page that must be closed first | ✓ | 10 s | 5 (5) | 0 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | **45 days of notice in writing** is needed to cancel the Pulse Gym membership. |
| frame | a booking form inside a frame | ✓ | 24 s | 11 (8) | 4 | The table has been successfully booked! The confirmation shows: - **Table for 2 on Friday at 19:30** - Name: Sam Ortiz The booking at The Ol |
| dependent-lists | a list filled in by choosing in another | ✓ | 20 s | 9 (7) | 3 | The shipping cost for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here are the checkout details: - **Items:** £22.50 (Blue umbrella) - **Shipping:** £4.95 - **Total: £27.45** I did not place the order — it' |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 8 s | 3 (3) | 0 | April had the highest sales at **$91**. |
| upload | attaching a file from this computer to a form (BRW-19) | ✓ | 30 s | 13 (11) | 5 | Application submitted successfully! The application for Robin Vale has been sent with the CV attached. The confirmation page shows "Thank yo |
| download | downloading a file, then reading it (BRW-20) | ✓ | 12 s | 4 (3) | 1 | The October sales report contains the following: \| Product \| Sales \| \|---\|---\| \| Kettles \| 3,120 \| \| Mugs \| 845 \| \| Teapots \|  |
