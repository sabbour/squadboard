# Non-Tech Role Charter Templates

Reusable charter starting points for the 7 non-tech roles Squad supports. These are **templates**, not active charters. Copy → fill in → place in `.squad/agents/{name}/charter.md` when adding a real team member.

## Available templates

| Emoji | Role | File |
|---|---|---|
| 🎯 | Product Manager — roadmap, requirements, prioritization, stakeholder alignment | [`pm-charter.md`](./pm-charter.md) |
| 🎨 | Designer (UX / Visual / Brand) — design system, accessibility, interaction prototypes | [`designer-charter.md`](./designer-charter.md) |
| 👔 | Founder / CEO / Executive — vision, capital, board, senior hiring, strategic bets | [`founder-charter.md`](./founder-charter.md) |
| 💼 | Sales / Account Executive / BD — pipeline, ICP, deal mechanics, contracts | [`sales-charter.md`](./sales-charter.md) |
| 📣 | Marketing / Growth / Brand Marketing — positioning, launches, content, channels | [`marketing-charter.md`](./marketing-charter.md) |
| 🎧 | Customer Success / Support — onboarding, retention, churn analysis, support escalation | [`customer-success-charter.md`](./customer-success-charter.md) |
| 🔬 | Research (User Research / Data Science) — hypothesis design, study reports, persona docs | [`research-charter.md`](./research-charter.md) |

## How to use

When the coordinator (Ralph) is asked to add a non-tech team member:

1. **Pick the template** that matches the role from the table above.
2. **Copy** it to `.squad/agents/{persistent-name}/charter.md` (e.g. `.squad/agents/donna/charter.md`).
3. **Cast the name.** Run the casting algorithm against the active universe in `.squad/casting/history.json` and pick a name that fits the role's voice. Replace the literal `{Name}` placeholder in three places:
   - The H1 heading: `# {Name} — Product Manager`
   - The `**Name:**` line under `## Identity`
4. **Tune** any role-specific details that the actual hire's scope shifts (e.g. "Designer" template defaults to UX + visual + brand; if your hire is visual-only, narrow the `## What I Own` list).
5. **Register** the new agent in `.squad/casting/registry.json` per the squad.agent.md casting rules.

## Why these templates exist

Charters drive how every Squad agent works — they set scope, voice, model preference, and collaboration expectations. Without a template, every new non-tech hire starts from a blank page or copies a tech charter that doesn't quite fit (engineering invariants, code-review gates, etc. don't translate to PM or sales work). These templates give the team a starting point that's already shaped to non-tech work.

## What's intentionally consistent across templates

- **Section structure:** Identity, What I Own, How I Work, Boundaries, Voice, Model, Collaboration — same shape as the existing tech charters in `.squad/agents/*/charter.md`.
- **`{Name}` placeholder:** literal, used in two places (H1 + Identity Name line) so casting can fill once.
- **`## How I Work` opener:** Every template starts with "Read `.squad/decisions.md` before starting" — every Squad agent reads team decisions before acting.
- **`## Collaboration` block:** Identical across all templates so coordinator pathways stay consistent.

## What's intentionally distinct per template

- **Tagline (`>` line):** captures the role's core philosophy in one sentence.
- **`## What I Own`:** lists artifacts and processes that role actually produces day-to-day.
- **`## How I Work`:** 3–5 working principles specific to the role's craft.
- **`## Boundaries`:** explicitly names what the role does NOT handle, with pointers to other roles where it might land.
- **`## Voice`:** tone, vocabulary, and habits of mind that distinguish this role's output.
- **`## Model` rationale:** which work justifies the cost-first vs standard-tier model choice.

## Related references

- `.squad/templates/casting-reference.md` — universe table, selection algorithm, casting state file schemas
- `.squad/routing.md` — work-type taxonomy including non-tech routing rules
- `.github/agents/squad.agent.md` — full agent governance including non-tech role emoji mapping
- `.squad/agents/*/charter.md` — existing tech charters for structural reference
