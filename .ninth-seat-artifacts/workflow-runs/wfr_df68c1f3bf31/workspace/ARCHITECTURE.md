# 4-Function Calculator (Web) — Architecture & Tech Design (MVP)

## 1) Context & Scope
**Goal:** In-browser calculator supporting +, −, ×, ÷ with decimal input, equals, clear, display, and division-by-zero handling. Should-have: backspace, keyboard input, responsive layout.

**Deployment target:** Local web (runs in a browser; no server required for MVP).

**Key acceptance criteria (from requirements):**
- AC-1..AC-8 must-have: digit entry, single decimal per operand, 4 operations, equals, clear, div-by-zero error.
- AC-9..AC-11 should-have: backspace, keyboard parity, responsive UI.

## 2) High-level Architecture
### Chosen architecture (MVP)
**Single-page static web app**
- **Frontend:** Vanilla HTML + CSS + JavaScript (ES modules)
- **Backend:** None
- **Database:** None

Rationale: MVP explicitly allows static implementation; no persistence or user data; simplest path to meet ACs with minimal complexity.

### Component boundaries
- **UI Layer**
  - Display component (read-only)
  - Keypad component (buttons)
- **Input Controller**
  - Maps button clicks + keyboard events to calculator actions
- **Calculator Engine (pure logic)**
  - State machine for operands/operator/error
  - Deterministic functions; no DOM access

### Data flow (event-driven)
```text
User click/keypress
   ↓
Input Controller (normalize to Action)
   ↓
Calculator Engine (reduce(state, action) -> newState)
   ↓
UI Renderer (render(newState))
```

## 3) Calculator State Model (in-memory)
State is held in JS memory only.

```ts
type Operator = '+' | '-' | '*' | '/';

type CalcState = {
  display: string;          // what user sees, e.g. "0", "123", "Error"
  operand1: string | null;  // stored as string to preserve user input
  operand2: string | null;  // current entry when operator is set
  operator: Operator | null;
  awaitingNextOperand: boolean; // after operator press, next digit starts operand2
  error: string | null;     // e.g. "DIV_BY_ZERO"
};
```

## 4) Behavior Rules (implementation-ready)
- **Digits (0-9):** append to current operand; if display is "0" and digit != '.', replace.
- **Decimal '.':** allowed once per operand; ignore subsequent '.' (AC-2).
- **Operator press (+-*/):**
  - If `operator` is null: store current display as `operand1`, set `operator`, set `awaitingNextOperand=true`.
  - If `operator` already set and user has entered operand2: compute intermediate result left-to-right, store as operand1, keep new operator.
- **Equals '=' / Enter:**
  - If operator and operand2 present: compute; show result; clear operator; set awaitingNextOperand=false.
- **Clear 'C' / Escape:** reset to initial state (AC-8).
- **Backspace '⌫' / Backspace key:** delete last char of current entry; if empty -> "0" (AC-9).
- **Division by zero:** set error state; display "Error"; next digit or clear resets appropriately (AC-7).

**Precision/formatting:** Use JS `Number` for computation; display result as string via `String(result)`; no BigDecimal requirement (assumption).

## 5) Non-functional considerations
- **Accessibility:**
  - Buttons are `<button>` with `aria-label`.
  - Keyboard navigation via natural tab order.
- **Responsive:** CSS grid for keypad; scale to 360×640 without horizontal scroll.
- **Performance:** pure reducer + minimal DOM updates.

## 6) Tradeoffs
- **Vanilla JS vs React/Vue**
  - Chosen: Vanilla for smallest footprint and fastest MVP.
  - Rejected: React adds build tooling and complexity not needed for a calculator.
- **No backend/DB vs adding persistence/history**
  - Chosen: none to match “no server required” constraint.
  - Rejected: persistence/history would require localStorage (still no server) or backend; out of MVP.
- **String-based input state vs numeric-only state**
  - Chosen: strings preserve user intent (leading zeros, decimal entry) and simplify AC-2.
  - Tradeoff: must convert to Number at compute time.

## 7) Deployment
- Serve as static files:
  - Open `index.html` directly, or
  - `python -m http.server` for local dev.

No environment variables required.
