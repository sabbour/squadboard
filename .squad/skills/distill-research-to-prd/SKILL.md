# Skill: Distill Research Doc → PRD

## When to use

You have a large research/design document (50–100KB+) and need a concise Product Requirements Document (8–15KB) that sits on top as the executive layer.

## Pattern

1. **Read the research doc cover to cover.** Don't skim — you need to know what's there to know what to cut.
2. **The PRD answers "what and why." The research doc answers "how."** If a section requires reading code, schema, or implementation detail to understand, it belongs in the research doc.
3. **Tables over prose** for scope, non-goals, roadmap, team, risks. Devs skim tables; they skip paragraphs.
4. **One-line summaries link out.** The roadmap lists demos in one line each; full specs stay in the source doc.
5. **Paste contracts verbatim.** Non-negotiable invariants, binding decisions — copy them word-for-word. They must survive any redesign of the surrounding text.
6. **Frame scope as capabilities (what users get), not components (what engineers build).** The PRD is a product brief.
7. **Open questions stay open.** List them with a recommended default and a "decide by" deadline. Don't invent answers.
8. **The last section is always a pointer** to the deep design — one paragraph + explicit link.

## Size target

8–12KB. If over 15KB, you're duplicating. Cut.

## Structure (recommended order)

1. One-line definition
2. Vision / problem statement
3. Target users (table)
4. Scope — what's in (table)
5. Non-goals (table)
6. Binding invariants / contracts (verbatim)
7. Roadmap (one-line per milestone)
8. Architecture at a glance (one paragraph + diagram link)
9. Tech stack (table)
10. Team & ownership (table)
11. Success criteria (table)
12. Dependencies & risks (table)
13. Open questions (table)
14. Pointer to deep design

## Anti-patterns

- Re-explaining demo exit criteria (that's the research doc's job)
- Including code examples or schema definitions
- Writing marketing copy — active verbs, no fluff
- Making decisions on open questions without declaring them as decisions
