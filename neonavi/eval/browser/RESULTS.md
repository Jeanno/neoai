# Browser eval

13 of 13 passed, 2026-11-03, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 18 s | 9 (9) | 1 | I found 7 kettle results. Now let me filter for those that hold **at least 1.7 litres** and find the cheapest: \| Kettle \| Capacity \| Pric |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** more 1-star review (Review 12). Here's the total across all 3 pages: - Page 1: 2 1-star reviews (Reviews 2, 5) - Page 2: 1  |
| form | filling a form: text, a list, a checkbox | ✓ | 28 s | 13 (12) | 5 | The contact form has been sent successfully. Here's a summary: - **Name:** Robin Vale - **Email:** robin@example.test - **Topic:** Repairs - |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order #4471 status is **Out for delivery**. It was placed on 19 Oct. |
| long-table | finding rows in a table of 150 | ✓ | 22 s | 1 (1) | 0 | The timetable was returned in full. Let me parse it to find the last train from Elm to Harbor that departs before 18:00. Looking through the |
| cookie-banner | a banner over the page that must be closed first | ✓ | 22 s | 9 (9) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | **45 days of notice** is required to cancel a Pulse Gym membership, and it must be given **in writing**. You can cancel at any time. |
| frame | a booking form inside a frame | ✓ | 22 s | 9 (6) | 3 | The table has been successfully booked! Here are the details: - **Restaurant:** The Olive Tree - **Guests:** 2 people - **Day:** Friday - ** |
| dependent-lists | a list filled in by choosing in another | ✓ | 24 s | 11 (9) | 2 | The shipping cost for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | The order is at checkout but **not placed**. Here's the breakdown: - **Items (Blue umbrella):** £22.50 - **Shipping:** £4.95 - **Total: £27. |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 8 s | 2 (2) | 0 | April had the highest sales at **91**. |
| upload | attaching a file from this computer to a form (BRW-19) | ✓ | 34 s | 15 (13) | 5 | The application has been submitted successfully. Here's what happened: 1. **Filled in the name:** Robin Vale 2. **Attached the CV:** robin-v |
