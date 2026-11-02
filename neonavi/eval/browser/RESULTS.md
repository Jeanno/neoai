# Browser eval

12 of 12 passed, 2026-11-02, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 16 s | 9 (9) | 0 | Now I can see the kettles. Let me filter for those that hold **at least 1.7 litres** and find the cheapest: \| Kettle \| Capacity \| Price \ |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** more 1-star review. No more pages. Total count of 1-star reviews across all 3 pages: **4** |
| form | filling a form: text, a list, a checkbox | ✓ | 30 s | 13 (12) | 6 | The contact form has been sent successfully with: - **Name:** Robin Vale - **Email:** robin@example.test - **Topic:** Repairs - **Message:** |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order **#4471** status: **Out for delivery** (placed on 19 Oct). |
| long-table | finding rows in a table of 150 | ✓ | 20 s | 2 (2) | 0 | I now have the full timetable. Let me identify the last train from **Elm to Harbor** that departs **before 18:00**. The trains from Elm to H |
| cookie-banner | a banner over the page that must be closed first | ✓ | 12 s | 5 (5) | 0 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | According to the membership terms, **45 days of notice** is required to cancel, and it must be given **in writing**. |
| frame | a booking form inside a frame | ✓ | 24 s | 11 (8) | 4 | The table has been successfully booked! Here's the confirmation: - **Booked** under the name Sam Ortiz - **Table for 2 on Friday at 19:30** |
| dependent-lists | a list filled in by choosing in another | ✓ | 18 s | 11 (9) | 0 | Shipping for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here are the order details: - **Items:** £22.50 (Blue umbrella) - **Shipping:** £4.95 - **Total: £27.45** The order has not been placed. |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 6 s | 2 (2) | 0 | Based on the chart, here are the monthly sales values: \| Month \| Sales \| \|-------\|-------\| \| Jan \| 42 \| \| Feb \| 55 \| \| Mar \| 3 |
