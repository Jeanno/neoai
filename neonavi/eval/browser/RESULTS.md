# Browser eval

15 of 15 passed, 2026-11-03, with qwen3.6-35b-a3b-vl-mtp-mxfp8 on Darkbloom.

Local practice sites (eval/browser/sites.ts), each task given as a job to `navi serve`, every approval answered yes.
Steps are log lines, those that touched the browser in brackets.

| Task | Tests | | Time | Steps | Approvals | Answer, or why it failed |
|---|---|---|---|---|---|---|
| search-compare | a search drawn by script, then comparing results | ✓ | 42 s | 20 (20) | 0 | I can see the 7 kettle results. Let me identify the cheapest one that holds **at least 1.7 litres**: \| Kettle \| Capacity \| Price \| \|--- |
| late-page | a page drawn seconds after it loads | ✓ | 6 s | 1 (1) | 0 | There are **37** open tickets. |
| pagination | following Next through pages and counting | ✓ | 12 s | 5 (5) | 0 | Page 3 has **1** more 1-star review (Review 12). Across all 3 pages, there are **4** 1-star reviews in total: - Review 2: "Broke in a week." |
| form | filling a form: text, a list, a checkbox | ✓ | 30 s | 13 (12) | 6 | The contact form has been sent successfully. Here's a summary of what was submitted: - **Name:** Robin Vale - **Email:** robin@example.test  |
| sign-in | signing in, then reading behind it | ✓ | 28 s | 13 (13) | 4 | Successfully signed in. The status of **order #4471** is: **Out for delivery** (placed on 19 Oct). |
| long-table | finding rows in a table of 150 | ✓ | 16 s | 1 (1) | 0 | I can see the timetable data. Let me find all "Elm to Harbor" trains that depart **before** 18:00 (strictly before, not at 18:00): From the  |
| cookie-banner | a banner over the page that must be closed first | ✓ | 12 s | 5 (5) | 1 | The bakery's Saturday opening hours are **8:00–16:30**. |
| new-tab | a link that opens in a new tab | ✓ | 8 s | 3 (3) | 0 | **45 days of notice** is needed to cancel, in writing. |
| frame | a booking form inside a frame | ✓ | 22 s | 11 (8) | 2 | The table has been successfully booked! Here's the confirmation: - **Table for 2 on Friday at 19:30** - **Name:** Sam Ortiz The booking at T |
| dependent-lists | a list filled in by choosing in another | ✓ | 22 s | 11 (9) | 2 | Shipping for a 3 kg parcel to Lyon, France is **€10.45**. |
| stop-before-paying | doing most of a checkout, but not placing the order | ✓ | 14 s | 5 (5) | 2 | Here are the details: - **Items:** £22.50 (blue umbrella) - **Shipping:** £4.95 - **Total:** **£27.45** I stopped at the checkout page and d |
| chart | a chart drawn on a canvas, with no text to read (BRW-18) | ✓ | 10 s | 3 (3) | 0 | The page shows: - **Month:** April - **Sales:** 91 |
| upload | attaching a file from this computer to a form (BRW-19) | ✓ | 28 s | 12 (11) | 4 | Robin Vale's job application has been successfully submitted! The application form was filled with: - **Name:** Robin Vale - **CV:** robin-v |
| download | downloading a file, then reading it (BRW-20) | ✓ | 10 s | 4 (3) | 0 | The October sales report contains: \| Product \| Sales \| \|---\|---\| \| Kettles \| 3,120 \| \| Mugs \| 845 \| \| Teapots \| 1,290 \| \| Tr |
| confirm | a delete the page asks "are you sure?" about in a pop-up (BRW-21) | ✓ | 14 s | 5 (5) | 2 | The draft to Old supplier has been deleted. |
