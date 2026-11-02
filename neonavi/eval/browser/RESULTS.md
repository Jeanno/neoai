# Browser eval

12 of 13 passed, 2026-11-02, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 30 s | 17 (15) | 0 | The kettles that hold **at least 1.7 litres** are: \| Kettle \| Capacity \| Price \| \|---\|---\|---\| \| Aero Glass Kettle \| 1.7 L \| £54. |
| late-page | a page drawn seconds after it loads | ✓ | 8 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 14 s | 5 (5) | 0 | Page 3 has 1 one-star review. Here's the total: \| Page \| 1-star reviews \| \|------\|----------------\| \| 1 \| 2 (Review 2, Review 5) \|  |
| form | filling a form: text, a list, a checkbox | ✓ | 30 s | 13 (12) | 6 | The contact form has been sent successfully. The page shows "Thanks, we got your message." confirming delivery with: - **Name:** Robin Vale  |
| sign-in | signing in, then reading behind it | ✓ | 20 s | 7 (7) | 3 | The status of **order #4471** is **Out for delivery**. It was placed on 19 Oct. |
| long-table | finding rows in a table of 150 | ✓ | 8 s | 1 (1) | 0 | The last train from Elm to Harbor that departs before 18:00 is: - **Departs:** 17:39 - **Platform:** 1 |
| cookie-banner | a banner over the page that must be closed first | ✓ | 20 s | 7 (7) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | According to the membership terms on Pulse Gym's page: **45 days' notice is required to cancel**, and it must be given **in writing**. |
| frame | a booking form inside a frame | ✓ | 24 s | 11 (8) | 4 | The table has been successfully booked! Here's the confirmation: - **Name:** Sam Ortiz - **Guests:** 2 - **Day:** Friday - **Time:** 19:30 T |
| dependent-lists | a list filled in by choosing in another | ✓ | 20 s | 11 (9) | 1 | Shipping for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here are the details: - **Items:** £22.50 (Blue umbrella) - **Shipping:** £4.95 - **Total: £27.45** The order has not been placed — I stoppe |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 8 s | 3 (3) | 0 | Looking at the bar chart showing monthly sales: - Jan: 42 - Feb: 55 - Mar: 38 - Apr: 91 - May: 47 - Jun: 60 **April had the highest sales wi |
| upload | attaching a file from this computer to a form (BRW-19) | ✗ | 22 s | 10 (9) | 3 | the application was never sent |
