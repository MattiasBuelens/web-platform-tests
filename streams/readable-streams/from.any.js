// META: global=window,worker,jsshell
// META: script=../resources/test-utils.js
'use strict';

const iterableFactories = [
  ['an array of values', () => {
    return ['a', 'b'];
  }],

  ['an array of promises', () => {
    return [
      Promise.resolve('a'),
      Promise.resolve('b')
    ];
  }],

  ['a string', () => {
    // This iterates over the code points of the string.
    return 'ab';
  }],

  ['a Set', () => {
    return new Set(['a', 'b']);
  }],

  ['a sync generator', () => {
    function* syncGenerator() {
      yield 'a';
      yield 'b';
    }

    return syncGenerator();
  }],

  ['an async generator', () => {
    async function* asyncGenerator() {
      yield 'a';
      yield 'b';
    }

    return asyncGenerator();
  }],

  ['a sync iterable of values', () => {
    const chunks = ['a', 'b'];
    const it = {
      next() {
        return {
          done: chunks.length === 0,
          value: chunks.shift()
        };
      },
      [Symbol.iterator]: () => it
    };
    return it;
  }],

  ['a sync iterable of promises', () => {
    const chunks = ['a', 'b'];
    const it = {
      next() {
        return chunks.length === 0 ? { done: true } : {
          done: false,
          value: Promise.resolve(chunks.shift())
        };
      },
      [Symbol.iterator]: () => it
    };
    return it;
  }],

  ['an async iterable', () => {
    const chunks = ['a', 'b'];
    const it = {
      next() {
        return Promise.resolve({
          done: chunks.length === 0,
          value: chunks.shift()
        })
      },
      [Symbol.asyncIterator]: () => it
    };
    return it;
  }],

  ['a ReadableStream', () => {
    return new ReadableStream({
      start(c) {
        c.enqueue('a');
        c.enqueue('b');
        c.close();
      }
    });
  }]
];

for (const [label, factory] of iterableFactories) {
  promise_test(async () => {

    const iterable = factory();
    const rs = ReadableStream.from(iterable);
    assert_equals(rs.constructor, ReadableStream, 'from() should return a ReadableStream');

    const reader = rs.getReader();
    assert_object_equals(await reader.read(), { value: 'a', done: false }, 'first read should be correct');
    assert_object_equals(await reader.read(), { value: 'b', done: false }, 'second read should be correct');
    assert_object_equals(await reader.read(), { value: undefined, done: true }, 'third read should be done');
    await reader.closed;

  }, `ReadableStream.from accepts ${label}`);
}

const badIterables = [
  ['null', null],
  ['undefined', undefined],
  ['0', 0],
  ['NaN', NaN],
  ['true', true],
  ['{}', {}],
  ['Object.create(null)', Object.create(null)],
  ['a function', () => 42],
  ['a symbol', Symbol()],
  ['an object with a non-callable @@iterator method', {
    [Symbol.iterator]: 42
  }],
  ['an object with a non-callable @@asyncIterator method', {
    [Symbol.asyncIterator]: 42
  }],
];

for (const [label, iterable] of badIterables) {
  test(() => {
    assert_throws_js(TypeError, () => ReadableStream.from(iterable), 'from() should throw a TypeError')
  }, `ReadableStream.from throws on invalid iterables; specifically ${label}`);
}

test(() => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.iterator]() {
      throw theError;
    }
  };

  assert_throws_exactly(theError, () => ReadableStream.from(iterable), 'from() should re-throw the error');
}, `ReadableStream.from re-throws errors from calling the @@iterator method`);

test(() => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.asyncIterator]() {
      throw theError;
    }
  };

  assert_throws_exactly(theError, () => ReadableStream.from(iterable), 'from() should re-throw the error');
}, `ReadableStream.from re-throws errors from calling the @@asyncIterator method`);

test(t => {
  const theError = new Error('a unique string');
  const iterable = {
    [Symbol.iterator]: t.unreached_func('@@iterator should not be called'),
    [Symbol.asyncIterator]() {
      throw theError;
    }
  };

  assert_throws_exactly(theError, () => ReadableStream.from(iterable), 'from() should re-throw the error');
}, `ReadableStream.from ignores @@iterator if @@asyncIterator exists`);

promise_test(async t => {

  const theError = new Error('a unique string');

  let returnCalled = false;
  let returnArgs;
  let resolveReturnCall;
  let resolveReturn;
  const returnCallPromise = new Promise(r => resolveReturnCall = r);

  const iterable = {
    next: t.unreached_func('next() should not be called'),
    return(...args) {
      returnCalled = true;
      returnArgs = args;
      resolveReturnCall();
      return new Promise(r => resolveReturn = r);
    },
    [Symbol.asyncIterator]: () => iterable
  };

  const rs = ReadableStream.from(iterable);
  const reader = rs.getReader();
  assert_false(returnCalled, 'return() should not be called yet');

  let cancelResolved = false;
  const cancelPromise = reader.cancel(theError).then(() => {
    cancelResolved = true;
  });

  await returnCallPromise;
  assert_true(returnCalled, 'return() should be called');
  assert_array_equals(returnArgs, [theError], 'return() should be called with cancel reason');

  await flushAsyncEvents();
  assert_false(cancelResolved, 'cancel() should not resolve while promise from return() is pending');

  resolveReturn({ done: true });
  await Promise.all([
    cancelPromise,
    reader.closed
  ]);

}, `ReadableStream.from: cancelling the returned stream calls and awaits return()`);
