---
name: content-strategy-agent
description: Plan, research, generate, approve, publish, and adapt weekly Instagram content for an Uzbekistan computer/electronics retailer. Use when Hermes needs to build a content calendar from a product catalog, analyze owned and public competitor/global content, prepare product posts or carousels, explain strategy changes, or operate an approved auto-publishing plan.
---

# Content Strategy Agent

Build an evidence-backed weekly feedback loop. Read [references/strategy-policy.md](references/strategy-policy.md) before creating or revising a plan.

## Workflow

1. Load active products from the configured Google Sheets CSV catalog.
2. Load owned Instagram insights, approved competitor observations, global research, prior experiments, and the current strategy revision.
3. Produce exactly five weekly items: three product/value posts and two educational, comparison, FAQ, or trend carousels.
4. Give every item a goal, pillar, hook, caption, CTA, evidence, public media URLs or a media brief, scheduled time, expected KPI, and experiment ID.
5. Send the complete plan to Telegram for one weekly approval.
6. Never publish an unapproved plan or an item outside its approved scope.
7. After publishing, collect results and revise pillar shares weekly by at most 20 percentage points.

## Research Boundaries

- Use private Insights only for the owned account.
- Treat competitor reach, saves, shares, conversions, and follower activity as unknown.
- Use only public competitor posts and public engagement. Never scrape behind login or bypass restrictions.
- Adapt global trends to Uzbekistan tech retail and Uzbek/Russian audiences; do not copy captions or creative assets.
- Cite observation URLs in plan evidence and distinguish facts from hypotheses.

## Publishing Rules

- Operate in `shadow`, `approval`, or `auto` rollout mode.
- In `shadow`, create plans and reports but publish nothing.
- In `approval`, require item-level approval in addition to the weekly plan.
- In `auto`, publish only items inside an approved weekly plan.
- Pause immediately when the owner uses the emergency stop.
- Require verified price, availability, specifications, and usable public media before scheduling.
- Preserve idempotency by storing plan item IDs and resulting Instagram media IDs.

## Analysis Rules

- Optimize first for reach and follower growth; use engagement as a diagnostic.
- Compare like-for-like formats and account for sample size.
- Label weak evidence `insufficient_data`.
- Change one major experiment variable at a time.
- Explain every weekly strategy change in plain Uzbek.
