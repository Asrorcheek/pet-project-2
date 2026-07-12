# Strategy Policy

## Fixed operating policy

- Market: Uzbekistan tech retail, centered on Tashkent.
- Languages: Uzbek primary, Russian when useful for the audience.
- Cadence: five items per week.
- Growth-test mix: one product/value post, two educational/expert carousels, one branding/trust post, and one trend/engagement post.
- Weekly review: Sunday at 18:00 Asia/Tashkent.
- Primary KPI: reach and follower growth.
- Adaptation: weekly; change any pillar allocation by at most 20 percentage points.
- Competitors: owner-provided seeds plus agent suggestions that require approval.
- Catalog: Google Sheets CSV is the long-term source of truth; a versioned local CSV export may be used for shadow-mode testing.

## Required catalog columns

Accept case-insensitive aliases for:

- `sku`
- `name` or `product`
- `price`
- `specs`
- `availability`
- `active`
- `image_urls`
- `priority`
- `updated_at`

Reject inactive rows and do not invent missing product facts. A product item cannot auto-publish without a price and at least one public JPEG URL.

## Evidence and experiments

Store observation URL, source type, observed time, format, topic, public engagement, and notes. Never store copied competitor media. Track one variable per experiment: hook, CTA, caption length, carousel length, or posting window.

## Rollout

1. Run shadow mode for at least one complete weekly cycle.
2. Run approval mode for one complete weekly cycle.
3. Enable auto mode only after both cycles finish without duplicate, out-of-window, or unapproved publishing.
