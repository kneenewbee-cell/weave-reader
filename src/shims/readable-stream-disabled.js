/**
 * Browser/mobile stub for `readable-stream`.
 * JSZip only checks for `.Readable` to decide whether Node stream adapters
 * should be enabled. Exporting an empty object keeps that path disabled.
 */
const stub = {};
export default stub;
