# Browser eval

17 of 17 passed, 2026-11-03, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 24 s | 11 (11) | 0 | Now I can see the 7 kettle results. Let me filter for those holding **at least 1.7 litres**: \| Kettle \| Capacity \| Price \| \|---\|---\|- |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 14 s | 5 (5) | 0 | Page 3 has **1** more 1-star review. Here's the total across all 3 pages: - **Page 1:** 2 (Reviews 2, 5) - **Page 2:** 1 (Review 8) - **Page |
| form | filling a form: text, a list, a checkbox | ✓ | 30 s | 13 (12) | 6 | The contact form has been submitted successfully with: - **Name:** Robin Vale - **Email:** robin@example.test - **Topic:** Repairs - **Messa |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order #4471 status: **Out for delivery** (placed on 19 Oct). |
| long-table | finding rows in a table of 150 | ✓ | 14 s | 2 (2) | 0 | I have the full timetable. Looking for trains from **Elm to Harbor** that depart **before 18:00**: The last such train departs at **17:39**  |
| cookie-banner | a banner over the page that must be closed first | ✓ | 20 s | 7 (7) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | You need to give **45 days of notice**, in writing, to cancel the Pulse Gym membership. |
| frame | a booking form inside a frame | ✓ | 24 s | 11 (8) | 2 | The table has been successfully booked! Here's the confirmation: - **Restaurant:** The Olive Tree - **Guests:** 2 - **Day:** Friday - **Time |
| dependent-lists | a list filled in by choosing in another | ✓ | 26 s | 13 (11) | 2 | The shipping cost for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here's the checkout summary: - **Items:** £22.50 (blue umbrella) - **Shipping:** £4.95 - **Total: £27.45** I did not place the order — the " |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 10 s | 3 (3) | 0 | April had the highest sales at **91**. |
| upload | attaching a file from this computer to a form (BRW-19) | ✓ | 34 s | 14 (12) | 5 | The application has been submitted successfully for Robin Vale. The page confirms: "We have your CV, robin-vale-cv.txt." Your job applicatio |
| download | downloading a file, then reading it (BRW-20) | ✓ | 14 s | 6 (4) | 1 | Here is the October sales report total: \| Product \| Sales \| \|---\|---\| \| Kettles \| 3,120 \| \| Mugs \| 845 \| \| Teapots \| 1,290 \|  |
| confirm | a delete the page asks "are you sure?" about in a pop-up (BRW-21) | ✓ | 14 s | 5 (5) | 2 | The draft to Old supplier has been deleted. The drafts page now shows only the remaining drafts (To Ana Ruiz and To Kettle Co). |
| hover-menu | a menu shown only while the pointer is over it (BRW-22) | ✓ | 18 s | 7 (7) | 0 | The **Riverside branch** is open on **Sunday: 12:00–17:00**. |
| bot-check | a check that the visitor is human, which navi leaves to the user (BRW-25) | ✓ | 8 s | 2 (2) | 0 | This page has a human verification check that I can't pass myself. Could you please click the "Verify you are human" checkbox in the browser |
