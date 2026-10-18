# Mission

## Why

FindYourDent ships `origin/main` (tag `v0.2.2`) as the AI Builder Cup 2026 submission build on 18 October 2026. Three specs are not done: #105 (spec 09 part 1, Proven Testimonies), #124 (spec 07, Payment Method) and #106 (spec 09 part 2, buzzer detection). The evaluation window runs 19 October to 6 November, the live URL must stay up, and there are no retries if it is down.

The learner wants to judge, for any change that lands after a build is live, whether it is safe to deploy, in what order, and what it does to data already in production.

## Success looks like

- Can sort a pending change into additive, semantic or contract change, and name the deploy order each needs.
- Can say which production data a change rewrites, and what the users who wrote it will see.
- Can decide "deploy during evaluation or wait" for #105, #124 and #106 with reasons, not gut feel.

## Out of scope

- Writing the specs' code.
- General DevOps theory not tied to this release.
