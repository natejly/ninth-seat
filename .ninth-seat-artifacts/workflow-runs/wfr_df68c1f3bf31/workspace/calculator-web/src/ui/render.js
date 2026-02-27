export function render(state) {
  const displayEl = document.getElementById('calc-display');
  const statusEl = document.getElementById('calc-status');
  if (!displayEl || !statusEl) return;

  displayEl.textContent = state.display;

  const opSymbol =
    state.operator === '+'
      ? '+'
      : state.operator === '-'
        ? '−'
        : state.operator === '*'
          ? '×'
          : state.operator === '/'
            ? '÷'
            : '';

  const left = state.operand1 != null ? state.operand1 : '';
  const right = state.operand2 != null ? state.operand2 : '';

  const parts = [];
  if (state.error) {
    parts.push(`Error: ${state.error}`);
  } else if (opSymbol) {
    parts.push(`${left} ${opSymbol} ${right}`.trim());
  } else if (left) {
    parts.push(left);
  }

  statusEl.textContent = parts.join('');

  // Update pressed state for operator keys
  document.querySelectorAll('[data-action="operator"]').forEach((btn) => {
    const isActive = btn.getAttribute('data-value') === state.operator;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}
