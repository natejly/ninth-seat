# Task Breakdown (Architecture → Implementation)

## A) UI
1. Create `index.html` layout: display + keypad grid.
2. Implement responsive CSS grid in `assets/styles.css`.
3. Add accessible labels and focus styles.

## B) Engine (core logic)
1. Define `CalcState` initial state.
2. Implement `reduce(state, action)` with actions:
   - `DIGIT`, `DECIMAL`, `OPERATOR`, `EQUALS`, `CLEAR`, `BACKSPACE`.
3. Implement `compute(a, op, b)` with div-by-zero handling.
4. Add formatting rules for display.

## C) Controller
1. Map button clicks to actions.
2. Map keyboard events to actions (AC-10).

## D) Testing
1. Unit tests for reducer transitions:
   - AC-1..AC-8 coverage.
2. Manual responsive check at 360×640.

## E) Packaging
1. Ensure app runs by opening `index.html`.
2. Optional: document `python -m http.server` usage.
