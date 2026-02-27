import {
  initialState,
  reducer,
  actionDigit,
  actionDecimal,
  actionOperator,
  actionEquals,
  actionClear,
  actionDelete,
  actionSign,
  actionPercent,
} from './engine/calculator.js';
import { render } from './ui/render.js';
import { keyToAction } from './ui/keymap.js';

let state = { ...initialState };

function dispatch(action) {
  state = reducer(state, action);
  render(state);
}

function bindButtons() {
  const keys = document.querySelector('.calc__keys');
  if (!keys) return;

  keys.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const actionType = btn.getAttribute('data-action');
    const value = btn.getAttribute('data-value');

    switch (actionType) {
      case 'digit':
        dispatch(actionDigit(value));
        break;
      case 'decimal':
        dispatch(actionDecimal());
        break;
      case 'operator':
        dispatch(actionOperator(value));
        break;
      case 'equals':
        dispatch(actionEquals());
        break;
      case 'clear':
        dispatch(actionClear());
        break;
      case 'delete':
        dispatch(actionDelete());
        break;
      case 'sign':
        dispatch(actionSign());
        break;
      case 'percent':
        dispatch(actionPercent());
        break;
      default:
        break;
    }
  });
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Avoid interfering with browser shortcuts.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const action = keyToAction(e);
    if (!action) return;

    e.preventDefault();
    dispatch(action);
  });
}

function init() {
  bindButtons();
  bindKeyboard();
  render(state);
}

init();
