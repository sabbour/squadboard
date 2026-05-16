# TDD Loop

**Category:** engineering

Test-driven development: red → green → refactor cycle with explicit test-first discipline.

## TDD Loop

Follow the red-green-refactor cycle:

1. **Red**: Write a failing test that describes the behaviour you're about to implement. Do not write implementation code yet.
2. **Green**: Write the minimal implementation to make the test pass. Resist the urge to over-engineer.
3. **Refactor**: Clean up the code — extract duplication, improve names, simplify logic — while keeping the test green.
4. **Repeat** for each new behaviour.

Rules:
- Test files live alongside source files or in a `__tests__/` sibling folder.
- Test names describe intent, not implementation: `'creates an issue in the backlog column'` not `'calls insertRow()'`.
- Edge cases (empty input, null, concurrent access) get their own test.
- Integration tests are separate from unit tests; don't conflate them.
