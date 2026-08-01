#!/usr/bin/env node

const path = require("node:path");

const { flattenBatchDirectory } = require("../app/flat_batch");

const target = process.argv[2];
if (!target) {
  console.error("用法：node scripts/flatten_batch.js <批次目录>");
  process.exit(2);
}

try {
  const result = flattenBatchDirectory(path.resolve(target));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
