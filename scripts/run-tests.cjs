/* eslint-disable no-console */
/**
 * DeepCloud 社区规则跨平台测试调度器 (run-tests.cjs)
 * 递归扫描 tests/ 下的 *.test.cjs 与 *.test.js 并交由 Node 原生测试运行器执行。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TESTS_DIR = path.resolve(__dirname, '..', 'tests');

function collectTests(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures' || entry.name === 'lib') continue;
      collectTests(full, out);
    } else if (entry.isFile() && /\.test\.(?:cjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = collectTests(TESTS_DIR);
if (files.length === 0) {
  console.log('ℹ️ 未发现任何测试文件 (*.test.cjs / *.test.js)');
  process.exit(0);
}

console.log(`🧪 共发现 ${files.length} 个规则测试文件，开始执行...`);
const res = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(res.status ?? 1);
