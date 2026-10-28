# Larchwood Outfitters: returns desk policy

These are the rules for the returns desk: deciding returns and their refunds, answering questions about orders, and booking carrier pickups for returns.

The records are current as of the business date, **Tuesday, November 24, 2026** (2026-11-24). "Today" always means the business date. The files were exported from the shop's systems over the years, and not every system wrote values the same way.

**New rows.** Copy ids and SKUs as the request gives them, write dates as YYYY-MM-DD, and write money as a whole number of cents: 12900 means $129.00. Answers give money in whole cents too.

**Rounding.** "Round half up" means round to the nearest whole cent, with exact halves going up: 1948.5 becomes 1949.

## Returns and refunds

A return request names an order, a SKU, a quantity and the item's condition: `unopened`, `opened` or `defective`. The item reached the desk today. Decide the request and add one row for it to returns.csv, approved or denied.

1. **Member perks.** The customer has member perks on an order when their `member_since` date is on or before the order's `order_date`. Joining later doesn't count for earlier orders.
2. **Approve or deny.** Count calendar days from the order's `delivered_on` to today. Approve only if all three hold:
   - On time: at most 30 days, or at most 60 with member perks. A defective item has 90 days for everyone.
   - Not final sale: a product with `final_sale` = yes can only come back defective.
   - Enough left: the quantity is at most the line's `qty` minus the units of the same SKU on the same order in approved returns already in returns.csv.
3. **Item** (`item_cents`): the quantity × the line's `unit_price` in order_lines.csv, the price paid (not the list price). Record it for a denied return too.
4. **Restocking fee** (`restocking_fee_cents`): 15% of the item amount, rounded half up, for an `opened` item in the tents, sleeping or electronics category. Otherwise 0.
5. **Return shipping** (`return_shipping_cents`): 695 for the prepaid label, unless the customer has member perks or the item is defective. Then 0.
6. **Shipping refund** (`shipping_refund_cents`): a defective item gets the order's original `shipping` back, unless an earlier approved return on the same order already refunded it. Otherwise 0.
7. **Refund** (`refund_cents`) = item − restocking fee − return shipping + shipping refund.
8. **Refund to** (`refund_to`): `card` when the order was paid by card and it is at most 30 days since delivery; otherwise `store_credit`.
9. **Denied.** A denied return keeps its `item_cents`; every other amount is 0 and `refund_to` is `none`.
10. **The row.** `return_id` is RT- plus the request's number (request RQ-5012 gets RT-5012). Fill in `order_id`, `sku`, `qty`, `condition`, `decided_on` (today), `decision` (`approved` or `denied`), the five amounts and `refund_to`. Leave `pickup_from` empty: it is only for returns that go back by carrier.

Example: a customer without member perks returns 2 opened sleeping pads (sleeping) bought at 64.50 each on an order delivered 2026-10-27, 28 days ago, paid by card. Item 12900. Restocking fee 15% of 12900 = 1935. Return shipping 695. Refund 12900 − 1935 − 695 = 10270, to card.

Example: a member whose perks cover the order returns a defective headlamp bought at 59.95. The order was delivered 45 days ago, shipping was 7.95, and nothing on it was refunded before. Item 5995, no fees, shipping refund 795, refund 6790. It's more than 30 days since delivery, so it goes to store_credit.

## Order questions

- A customer's **spending** is the quantity × `unit_price` of the lines on their orders placed in the period asked about. Shipping isn't spending, and returns don't reduce it.
- A product's **sales** in a month are the units on its order lines and their quantity × `unit_price`, counting orders by `order_date`.
- An order's **total** is its lines (quantity × `unit_price`) plus its `shipping`.
- A month runs from its first day to its last. "Since" a date and "on or before" a date both include that date.
- An order is **unshipped** while its `shipped_on` is empty.
- A product's category is in products.csv.

Example: a customer placed two orders in October. On 2026-10-02: 2 mugs at 29.95 (kitchen), shipping 7.95. On 2026-10-30: a stove at 79.95 (kitchen) and a headlamp at 59.95 (electronics), free shipping. Since 2026-10-30 they have spent 7995 in the kitchen category, and since 2026-10-01, 2 × 2995 + 7995 = 13985. Their October total is 2 × 2995 + 795 + 7995 + 5995 = 20775.

Example: if that second order hasn't shipped, it is one of the customer's unshipped orders placed on or before 2026-10-30, and the stove's sales in October include its 1 unit for 7995.

## Pickups

An approved return the customer sends back is collected by a carrier. Its row in returns.csv has a `pickup_from` date: the first day the customer can hand the parcel over. Book the pickup by adding one row to pickups.csv.

- **Carrier.** By the customer's `region` in customers.csv: Cedarline Parcel for Lakeshore and Valley, Kettlepoint Courier for Foothills and Uplands. A bulky product (`bulky` = yes in products.csv) goes with Basalt Freight from any region.
- **Days.** Cedarline picks up on Monday, Tuesday, Thursday and Friday; Kettlepoint on Monday, Wednesday, Friday and Saturday; Basalt on Tuesday and Thursday. No carrier picks up on Thursday, November 26, 2026 (Thanksgiving).
- **Not too soon.** Booked before 14:00, the earliest pickup is tomorrow; booked at 14:00 or later, the day after tomorrow. Never before the return's `pickup_from` date.
- **Capacity.** A carrier collects at most 3 of our returns a day. Count the pickups already in pickups.csv: a day with 3 is full.
- **Earliest.** Book the earliest date that passes every rule.
- **The row.** `pickup_id` is PU- plus the return's number (return RT-4410 gets PU-4410). Fill in `return_id`, `carrier`, `pickup_date` and `booked_on` (today).

Example: at 15:10 today, a Valley customer's daypack (not bulky) goes with Cedarline, and its `pickup_from` is 2026-11-25. Booked after 14:00, the earliest day is Thursday 2026-11-26, but no carrier picks up on Thanksgiving. Friday 2026-11-27 is a Cedarline day; if pickups.csv already has 3 Cedarline pickups that day, the next one, Monday 2026-11-30, is the date to book.
