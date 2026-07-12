(() => {
  const globalScope =
    typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : typeof window !== "undefined"
          ? window
          : {};

  if (typeof globalScope.setImmediate === "function") {
    return;
  }

  let nextHandle = 1;
  const tasksByHandle = new Map();

  const scheduleTask =
    typeof globalScope.queueMicrotask === "function"
      ? (callback) => globalScope.queueMicrotask(callback)
      : (callback) => Promise.resolve().then(callback);

  function runTask(handle) {
    const task = tasksByHandle.get(handle);
    if (!task) {
      return;
    }

    tasksByHandle.delete(handle);
    task.callback(...task.args);
  }

  function setImmediatePolyfill(callback, ...args) {
    const cb =
      typeof callback === "function"
        ? callback
        : () => {
            // Match the legacy package behavior without using Function/eval.
          };
    const handle = nextHandle++;
    tasksByHandle.set(handle, { callback: cb, args });
    scheduleTask(() => runTask(handle));
    return handle;
  }

  function clearImmediatePolyfill(handle) {
    tasksByHandle.delete(handle);
  }

  globalScope.setImmediate = setImmediatePolyfill;
  globalScope.clearImmediate = clearImmediatePolyfill;
})();

export default globalThis.setImmediate;
