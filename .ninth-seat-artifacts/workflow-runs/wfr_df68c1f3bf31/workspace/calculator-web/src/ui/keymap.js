import {
  actionDigit,
  actionDecimal,
  actionOperator,
  actionEquals,
  actionClear,
  actionDelete,
} from '../engine/calculator.js';

export function keyToAction(e) {
  const k = e.key;

  if (/^[0-9]$/.test(k)) return actionDigit(k);
  if (k === '.') return actionDecimal();
  if (k === '+' || k === '-' || k === '*' || k === '/') return actionOperator(k);
  if (k === 'Enter' || k === '=') return actionEquals();
  if (k === 'Escape') return actionClear();
  if (k === 'Backspace') return actionDelete();

  return null;
}
