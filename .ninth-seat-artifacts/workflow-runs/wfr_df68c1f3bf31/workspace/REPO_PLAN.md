# Repo Plan (MVP)

## Structure
```text
calculator-web/
  index.html
  assets/
    styles.css
  src/
    main.js            # bootstraps app, binds events
    engine/
      calculator.js    # reducer + compute helpers (pure)
    ui/
      render.js        # render(state) -> DOM updates
      keymap.js        # keyboard mapping to actions
  tests/
    engine.test.js     # optional: engine unit tests (node or browser)
  ARCHITECTURE.md
  DATA_MODEL.md
  api-spec.json
```

## Build tooling
- None required.
- Optional: add `npm` + `vite` later if desired.

## Conventions
- Engine is pure and unit-testable.
- UI layer does not implement business logic.
