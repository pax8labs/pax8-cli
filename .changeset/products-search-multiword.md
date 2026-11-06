---
"@pax8/cli": patch
---

`products search` and product-name lookup (`products show`, `cost sim --product`, `orders create --product`, and the quote commands) now search the whole catalog. Both used to scan a single page of results for one keyword. The live API caps that page at 100 rows, so `products search "Microsoft 365 Business Premium"` returned nothing, and `--product "Microsoft 365 E3"` resolved to an unrelated Defender add-on because it was the only phrase match on that page. Search now looks up the query's rarest word, reads every page for it, and keeps products whose name contains all the words. A name that matches several products now fails with a "Did you mean" list instead of picking one.
