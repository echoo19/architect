# Comparisons: Phil on this computer

Written on Oct 30, 2026. The frozen Phil from `phil-1.md` (the targeted arm, harness `8430022212bd`) took the same 120 locked tasks again, unchanged, on the 2-bit Glimmer that runs on an RTX 4070 Ti with 12 GB (`muse-glimmer:30b-iq2` through Ollama, 16,384-token context). This is a check of another backend for a candidate that was already frozen, on a test that was already released: no teaching, no mentor call, nothing tuned. Hosted numbers are the ones in `phil-1.md`.

| Group | Local | Hosted | Wins / losses | Difference, points (95% Newcombe) |
| --- | --- | --- | --- | --- |
| Harborview | 41/48 | 43/48 | 3 / 5 | -4.2 (-17.2 to +8.7) |
| Real academy | 17/24 | 12/24 | 6 / 1 | +20.8 (-0.9 to +39.6) |
| Seen | 45/48 | 44/48 | 3 / 2 | +2.1 (-9.3 to +13.7) |
| All | 103/120 | 99/120 | 12 / 8 | +3.3 (-4.3 to +11.0) |

No group shows a difference. Local did worse on Harborview's tutoring turn (3/8 against 6/8) and better on Real academy history (7/8 against 3/8).

Median time per task was 38 s locally and 9 s hosted; the slowest 5% took over 174 s locally and 59 s hosted. No prompt was cut short for context. Two replies ran on until the server stopped them. Eleven tasks hit the step limit locally, against seven hosted.

GPU: median 76 C, peak 81 C, about 246 W.

Not finished: the bare arm on the Real academy stopped after 2 of 24 tasks when the system ran low on memory. One seed only.

What this shows, and what it does not: on these 120 tasks the hosted result holds on the local 2-bit build, with no difference in any group under one seed. It does not show that the untaught Glimmer does as well locally; that arm was not finished. Records stay outside the repository; the Real academy is anonymized and not published.
