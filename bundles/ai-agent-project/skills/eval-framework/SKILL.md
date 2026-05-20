# Eval Framework

**Category:** ai

LLM evaluation discipline: golden dataset, metric selection, regression guard, human-in-the-loop review.

## Eval Framework

Every agent capability must have a corresponding eval:

1. **Golden dataset**: curate a labelled dataset of inputs and expected outputs. Minimum 20 examples; cover happy path, edge cases, and adversarial inputs.
2. **Metric selection**: pick metrics appropriate to the task — accuracy (classification), F1 (extraction), BLEU/ROUGE (generation), or custom rubric-based.
3. **Regression guard**: run evals on every prompt or model change. A regression (metric drop > threshold) blocks the change.
4. **Human-in-the-loop**: route eval failures and borderline cases to a human reviewer before overriding.
5. **Baseline versioning**: commit the baseline scores alongside the prompt version in source control.
6. **Separate train/eval sets**: never tune prompts on your eval set — it invalidates the measurement.
