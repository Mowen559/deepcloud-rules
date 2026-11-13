/**
 * 社区规则测试自动生成器回归测试 (generator.test.cjs)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { generateForAll } = require('../scripts/generate-rule-tests.cjs');

test('1. 默认模式尊重已有手写专项测试，不盲目生成重复文件', () => {
  const res = generateForAll({ rule: 'video/dmghk', force: false, dryRun: true });
  assert.equal(res.generated.length, 0);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].rule, 'video/dmghk');
});

test('2. 强制/新规则模式下能自动推导规则入口并生成合法可编译的测试脚本', () => {
  const res = generateForAll({ rule: 'video/dmghk', force: true, dryRun: true });
  assert.equal(res.generated.length, 1);

  const code = res.generated[0].content;
  assert.match(code, /@generated/);
  assert.match(code, /find_rule 沙箱冒烟/);
  assert.match(code, /search_find 沙箱冒烟/);
  assert.match(code, /detail_find_rule 沙箱冒烟/);
  assert.match(code, /DEEPCLOUD_LIVE_TEST/);

  // 确认生成的 JS 源码本身语法 100% 可编译
  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: 'dmghk.generated.test.cjs' });
  });
});
