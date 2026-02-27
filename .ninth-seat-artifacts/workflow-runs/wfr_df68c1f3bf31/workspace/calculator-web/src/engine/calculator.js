export const initialState = Object.freeze({
  display: '0',
  operand1: null,
  operand2: null,
  operator: null,
  awaitingNextOperand: false,
  error: null,
});

function isZeroLike(s) {
  return s === '0' || s === '-0';
}

function normalizeNumberString(s) {
  // Avoid "-0" display unless user explicitly toggled sign on 0.
  if (s === '-0') return '0';
  return s;
}

function toNumber(s) {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatResult(n) {
  if (!Number.isFinite(n)) return 'Error';
  // Keep it simple: trim trailing zeros for decimals.
  const s = String(n);
  if (!s.includes('e') && s.includes('.')) {
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }
  return s;
}

export function compute(aStr, op, bStr) {
  const a = toNumber(aStr);
  const b = toNumber(bStr);
  if (a == null || b == null) return { ok: false, error: 'Invalid number' };

  let r;
  switch (op) {
    case '+':
      r = a + b;
      break;
    case '-':
      r = a - b;
      break;
    case '*':
      r = a * b;
      break;
    case '/':
      if (b === 0) return { ok: false, error: 'Division by zero' };
      r = a / b;
      break;
    default:
      return { ok: false, error: 'Missing operator' };
  }

  return { ok: true, value: formatResult(r) };
}

export function reducer(state, action) {
  if (!state) state = initialState;

  // Clear error on any input except explicit clear.
  if (state.error && action.type !== 'CLEAR') {
    state = { ...state, error: null };
  }

  switch (action.type) {
    case 'CLEAR':
      return { ...initialState };

    case 'DIGIT': {
      const d = action.digit;
      if (!/^[0-9]$/.test(d)) return state;

      if (state.awaitingNextOperand) {
        return {
          ...state,
          display: d,
          operand2: d,
          awaitingNextOperand: false,
        };
      }

      const current = state.operator ? (state.operand2 ?? state.display) : state.display;
      const next = isZeroLike(current) ? d : current + d;

      if (state.operator) {
        return { ...state, display: next, operand2: next };
      }
      return { ...state, display: next, operand1: next };
    }

    case 'DECIMAL': {
      if (state.awaitingNextOperand) {
        return {
          ...state,
          display: '0.',
          operand2: '0.',
          awaitingNextOperand: false,
        };
      }

      const current = state.operator ? (state.operand2 ?? state.display) : state.display;
      if (current.includes('.')) return state;
      const next = current + '.';

      if (state.operator) {
        return { ...state, display: next, operand2: next };
      }
      return { ...state, display: next, operand1: next };
    }

    case 'SIGN': {
      const current = state.operator ? (state.operand2 ?? state.display) : state.display;
      const next = current.startsWith('-') ? current.slice(1) : '-' + current;
      const normalized = normalizeNumberString(next);

      if (state.operator) {
        return { ...state, display: normalized, operand2: normalized };
      }
      return { ...state, display: normalized, operand1: normalized };
    }

    case 'PERCENT': {
      const current = state.operator ? (state.operand2 ?? state.display) : state.display;
      const n = toNumber(current);
      if (n == null) return { ...state, error: 'Invalid number' };
      const normalized = formatResult(n / 100);
      if (normalized === 'Error') return { ...state, error: 'Invalid number' };

      if (state.operator) {
        return { ...state, display: normalized, operand2: normalized };
      }
      return { ...state, display: normalized, operand1: normalized };
    }

    case 'DELETE': {
      if (state.awaitingNextOperand) return state;
      const current = state.operator ? (state.operand2 ?? state.display) : state.display;
      if (current.length <= 1 || (current.length === 2 && current.startsWith('-'))) {
        const reset = '0';
        if (state.operator) return { ...state, display: reset, operand2: reset };
        return { ...state, display: reset, operand1: reset };
      }
      const next = current.slice(0, -1);
      if (state.operator) return { ...state, display: next, operand2: next };
      return { ...state, display: next, operand1: next };
    }

    case 'OPERATOR': {
      const op = action.operator;
      if (!['+', '-', '*', '/'].includes(op)) return state;

      // If we already have operator and operand2, compute chain.
      if (state.operator && state.operand2 != null && !state.awaitingNextOperand) {
        const res = compute(state.operand1 ?? state.display, state.operator, state.operand2);
        if (!res.ok) {
          return { ...state, error: res.error, display: 'Error' };
        }
        return {
          ...state,
          display: res.value,
          operand1: res.value,
          operand2: null,
          operator: op,
          awaitingNextOperand: true,
        };
      }

      // Set operator; ensure operand1 exists.
      const op1 = state.operand1 ?? state.display;
      return {
        ...state,
        operand1: op1,
        operator: op,
        awaitingNextOperand: true,
      };
    }

    case 'EQUALS': {
      if (!state.operator) return state;
      const a = state.operand1 ?? state.display;
      const b = state.operand2 ?? (state.awaitingNextOperand ? state.operand1 ?? state.display : state.display);
      if (b == null) return state;

      const res = compute(a, state.operator, b);
      if (!res.ok) {
        return { ...state, error: res.error, display: 'Error' };
      }
      return {
        ...state,
        display: res.value,
        operand1: res.value,
        operand2: null,
        operator: null,
        awaitingNextOperand: true,
      };
    }

    default:
      return state;
  }
}

export function actionDigit(digit) {
  return { type: 'DIGIT', digit };
}
export function actionDecimal() {
  return { type: 'DECIMAL' };
}
export function actionOperator(operator) {
  return { type: 'OPERATOR', operator };
}
export function actionEquals() {
  return { type: 'EQUALS' };
}
export function actionClear() {
  return { type: 'CLEAR' };
}
export function actionDelete() {
  return { type: 'DELETE' };
}
export function actionSign() {
  return { type: 'SIGN' };
}
export function actionPercent() {
  return { type: 'PERCENT' };
}
