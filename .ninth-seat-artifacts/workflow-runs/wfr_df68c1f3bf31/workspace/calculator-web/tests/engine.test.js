import { compute, reducer, initialState, actionDigit, actionOperator, actionEquals, actionDecimal } from '../src/engine/calculator.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`not ok - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('compute adds', () => {
  const r = compute('2', '+', '3');
  assert(r.ok && r.value === '5', '2+3 should be 5');
});

test('division by zero errors', () => {
  const r = compute('2', '/', '0');
  assert(!r.ok && r.error, 'should error');
});

test('reducer digit entry and equals', () => {
  let s = { ...initialState };
  s = reducer(s, actionDigit('1'));
  s = reducer(s, actionDigit('2'));
  s = reducer(s, actionOperator('+'));
  s = reducer(s, actionDigit('3'));
  s = reducer(s, actionEquals());
  assert(s.display === '15', '12+3 should be 15');
});

test('decimal entry', () => {
  let s = { ...initialState };
  s = reducer(s, actionDigit('1'));
  s = reducer(s, actionDecimal());
  s = reducer(s, actionDigit('5'));
  assert(s.display === '1.5', 'should be 1.5');
});
