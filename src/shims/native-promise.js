const NativePromise = globalThis.Promise;

if (typeof NativePromise !== "function") {
  throw new Error("Native Promise is required in this runtime.");
}

export default NativePromise;
