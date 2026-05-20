# Prompt Engineering

**Category:** ai

Structured prompt authoring: system prompt, few-shot examples, chain-of-thought, output schema.

## Prompt Engineering

Follow this discipline when authoring or modifying prompts:

1. **System prompt first**: write the system prompt before any few-shot examples.
2. **Hypothesis-driven iteration**: every prompt change has a stated hypothesis and a metric to validate it.
3. **Few-shot examples**: include 2–5 high-quality, diverse examples covering edge cases.
4. **Chain-of-thought**: ask the model to reason step-by-step before answering for complex tasks.
5. **Output schema**: define the expected output format (JSON schema, XML tags, or markdown structure) in the system prompt.
6. **Eval before shipping**: no prompt change ships without a passing eval run.
7. **Version prompts**: store prompt versions in source control with changelogs.
