# Browser eval

11 of 11 passed, 2026-11-02, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 16 s | 9 (9) | 0 | Here are the results. Kettles that hold **at least 1.7 litres**, sorted by price: \| Name \| Capacity \| Price \| \|---\|---\|---\| \| Dawn  |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** more 1-star review (Review 12). **Total 1-star reviews across all 3 pages: 4** - Page 1: Reviews 2, 5 (2) - Page 2: Review  |
| form | filling a form: text, a list, a checkbox | ✓ | 28 s | 13 (12) | 5 | Sent! The contact form was filled with: - **Name:** Robin Vale - **Email:** robin@example.test - **Topic:** Repairs - **Message:** "My kettl |
| sign-in | signing in, then reading behind it | ✓ | 18 s | 7 (7) | 3 | Order **#4471** (placed on 19 Oct) is currently **Out for delivery**. |
| long-table | finding rows in a table of 150 | ✓ | 16 s | 1 (1) | 0 | The page returned fully, so let me scan the data for Elm to Harbor trains departing before 18:00. From what I can already see in the timetab |
| cookie-banner | a banner over the page that must be closed first | ✓ | 12 s | 5 (5) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | **45 days' notice** is required to cancel, in writing. |
| frame | a booking form inside a frame | ✓ | 24 s | 11 (8) | 4 | The booking is confirmed! Here's a summary: - **Table for 2** - **Day:** Friday - **Time:** 19:30 - **Name:** Sam Ortiz The reservation has  |
| dependent-lists | a list filled in by choosing in another | ✓ | 18 s | 11 (9) | 1 | Shipping for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here are the order details: - **Items:** £22.50 (blue umbrella) - **Shipping:** £4.95 - **Total:** **£27.45** I did not place the order. |
