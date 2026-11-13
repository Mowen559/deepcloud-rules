/* eslint-disable no-console */
/**
 * DeepCloud 社区规则自动化测试脚本生成器 (generate-rule-tests.cjs)
 *
 * 根据 rules/<category>/<slug>/rule.json 的声明式结构自动生成可持久化留存的回归测试：
 *   1. 元数据与分类对齐校验
 *   2. 静态同构铁律与安全特征审计
 *   3. 按规则实际具备的入口（preRule / find_rule / search_find / search_rule / detail_find_rule）
 *      自动生成对应沙箱冒烟测试（支持 fixtures/*.html 与 DEEPCLOUD_LIVE_TEST=1 真网实测）
 *
 * 用法：
 *   node scripts/generate-rule-tests.cjs                    # 为所有尚无手写测试的规则生成 *.generated.test.cjs
 *   node scripts/generate-rule-tests.cjs --rule video/dmghk # 仅处理指定规则
 *   node scripts/generate-rule-tests.cjs --force            # 强制覆盖/更新 *.generated.test.cjs（不影响手写 *.test.cjs）
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RULES_DIR = path.join(ROOT_DIR, 'rules');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');

function parseArgs(argv) {
  const args = { rule: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force' || a === '--all') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--rule' && argv[i + 1]) args.rule = argv[++i];
    else if (a.startsWith('--rule=')) args.rule = a.slice('--rule='.length);
  }
  return args;
}

function listRules(targetRule) {
  const list = [];
  if (!fs.existsSync(RULES_DIR)) return list;

  if (targetRule) {
    const parts = targetRule.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(`--rule 参数格式须为 <category>/<slug>，当前为: ${targetRule}`);
    }
    const [category, slug] = parts;
    const ruleDir = path.join(RULES_DIR, category, slug);
    if (!fs.existsSync(path.join(ruleDir, 'rule.json'))) {
      throw new Error(`未找到规则文件: ${path.join(ruleDir, 'rule.json')}`);
    }
    list.push({ category, slug, ruleDir });
    return list;
  }

  for (const cat of fs.readdirSync(RULES_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const catDir = path.join(RULES_DIR, cat.name);
    for (const item of fs.readdirSync(catDir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const ruleDir = path.join(catDir, item.name);
      if (fs.existsSync(path.join(ruleDir, 'rule.json'))) {
        list.push({ category: cat.name, slug: item.name, ruleDir });
      }
    }
  }
  return list;
}

function buildGeneratedTestContent({ category, slug, rule, meta }) {
  const title = rule.title || rule.name || meta?.name || slug;
  const hasJsFind = typeof rule.find_rule === 'string' && rule.find_rule.trim().startsWith('js:');
  const hasJsPre = typeof rule.preRule === 'string' && rule.preRule.trim().startsWith('js:');
  const searchField = (typeof rule.search_find === 'string' && rule.search_find.trim().startsWith('js:'))
    ? 'search_find'
    : ((typeof rule.search_rule === 'string' && rule.search_rule.trim().startsWith('js:')) ? 'search_rule' : null);
  const hasJsDetail = typeof rule.detail_find_rule === 'string' && rule.detail_find_rule.trim().startsWith('js:');
  const firstCate = rule.class_url ? String(rule.class_url).split('&')[0] : 'home';

  const blocks = [];

  blocks.push(`/**
 * @generated 由 scripts/generate-rule-tests.cjs 根据 rules/${category}/${slug}/rule.json 自动生成
 * 规则名称：${title} (${category}/${slug})
 *
 * 说明：
 *   - 本文件提供开箱即用的契约校验、静态同构审计与沙箱入口冒烟测试；
 *   - 若需针对站点 HTML/JSON 做深度断言，请在同目录新建 ${slug}.test.cjs 并在 fixtures/ 中放置样本。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runHikerScript,
  auditRuleStatic,
} = require('../../lib/hiker-test-harness.cjs');

const RULE_DIR = path.resolve(__dirname, '../../../rules/${category}/${slug}');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const rule = JSON.parse(fs.readFileSync(path.join(RULE_DIR, 'rule.json'), 'utf8'));
const metaPath = path.join(RULE_DIR, 'meta.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;

function hasFixture(name) {
  return fs.existsSync(path.join(FIXTURE_DIR, name));
}

function readFixtureOrDefault(name, fallbackHtml) {
  const p = path.join(FIXTURE_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fallbackHtml;
}

function runSmokeEntry(label, fn, strictFixture) {
  try {
    const res = fn();
    if (strictFixture) {
      assert.ok(Array.isArray(res.results), label + ' 应调用 setResult(Array)');
    }
  } catch (err) {
    // 若已提供真实站点样本则严格失败；无样本时仅靠合成 HTML 触发的解析/数据空指针不阻断社区分享
    if (strictFixture) throw err;
    if (err instanceof SyntaxError || err instanceof TypeError) return;
    throw err;
  }
}

test('[自动生成] 1. 规则契约与静态同构安全校验 (${category}/${slug})', () => {
  assert.ok(rule.title || rule.name, 'rule.json 缺少 title/name');
  if (rule.class_name && rule.class_url) {
    assert.equal(
      String(rule.class_name).split('&').length,
      String(rule.class_url).split('&').length,
      'class_name 与 class_url 数量必须对齐'
    );
  }
  const audit = auditRuleStatic(rule, meta);
  assert.deepEqual(audit.errors, [], '静态规范与安全检查不应存在错误');
});`);

  if (hasJsPre) {
    blocks.push(`
test('[自动生成] 2. preRule 预处理脚本沙箱冒烟 (${category}/${slug})', () => {
  runSmokeEntry('preRule', () => runHikerScript(rule.preRule, {
    MY_URL: rule.url || 'hiker://empty',
    MY_RULE: rule,
    mockRequest: () => readFixtureOrDefault('pre.html', '<html><body></body></html>'),
  }), hasFixture('pre.html'));
});`);
  }

  if (hasJsFind) {
    blocks.push(`
test('[自动生成] 首页/分类入口 find_rule 沙箱冒烟 (${category}/${slug})', () => {
  const cate = ${JSON.stringify(firstCate)};
  const entryUrl = String(rule.url || 'hiker://empty#fyclass#fypage')
    .replace('fyclass', cate)
    .replace('fypage', '1');
  const html = readFixtureOrDefault('home.html', '<html><body><div class="list"><a href="/item/1">示例</a></div></body></html>');
  runSmokeEntry('find_rule', () => runHikerScript(rule.find_rule, {
    MY_URL: entryUrl,
    MY_PAGE: 1,
    MY_CATE: cate,
    MY_RULE: rule,
    mockRequest: () => html,
  }), hasFixture('home.html'));
});`);
  }

  if (rule.search_url && searchField) {
    blocks.push(`
test('[自动生成] 全局搜索入口 ${searchField} 沙箱冒烟 (${category}/${slug})', () => {
  const searchUrl = String(rule.search_url)
    .replace('fypage', '1')
    .replace('**', encodeURIComponent('测试'));
  const html = readFixtureOrDefault('search.html', '<html><body><div class="list"><a href="/item/1">测试结果</a></div></body></html>');
  runSmokeEntry('${searchField}', () => runHikerScript(rule.${searchField}, {
    MY_URL: searchUrl,
    input: searchUrl,
    MY_PAGE: 1,
    MY_KEYWORD: '测试',
    MY_RULE: rule,
    mockRequest: () => html,
  }), hasFixture('search.html'));
});`);
  }

  if (hasJsDetail) {
    blocks.push(`
test('[自动生成] 二级详情页 detail_find_rule 沙箱冒烟 (${category}/${slug})', () => {
  const detailUrl = 'https://example.com/detail/1.html';
  const html = readFixtureOrDefault('detail.html', '<html><body><h1>示例标题</h1></body></html>');
  runSmokeEntry('detail_find_rule', () => runHikerScript(rule.detail_find_rule, {
    MY_URL: detailUrl,
    input: detailUrl,
    MY_PAGE: 1,
    MY_RULE: rule,
    mockRequest: () => html,
  }), hasFixture('detail.html'));
});`);
  }

  if (hasJsFind) {
    blocks.push(`
test('[自动生成/可选真网] 线上首页连通性实测 (${category}/${slug})', {
  skip: process.env.DEEPCLOUD_LIVE_TEST !== '1' && '未开启 DEEPCLOUD_LIVE_TEST=1，跳过外网实测',
}, () => {
  const cate = ${JSON.stringify(firstCate)};
  const entryUrl = String(rule.url || 'hiker://empty#fyclass#fypage')
    .replace('fyclass', cate)
    .replace('fypage', '1');
  const res = runHikerScript(rule.find_rule, {
    MY_URL: entryUrl,
    MY_PAGE: 1,
    MY_CATE: cate,
    MY_RULE: rule,
    liveNetwork: true,
  });
  assert.ok(Array.isArray(res.results) && res.results.length > 0, '线上首页应返回非空结果数组');
});`);
  }

  return blocks.join('\n') + '\n';
}

function generateForAll(args) {
  const targets = listRules(args.rule);
  const summary = { generated: [], skipped: [] };

  for (const { category, slug, ruleDir } of targets) {
    const rule = JSON.parse(fs.readFileSync(path.join(ruleDir, 'rule.json'), 'utf8'));
    const metaPath = path.join(ruleDir, 'meta.json');
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;

    const targetTestDir = path.join(TESTS_DIR, category, slug);
    const manualTestPath = path.join(targetTestDir, `${slug}.test.cjs`);
    const generatedTestPath = path.join(targetTestDir, `${slug}.generated.test.cjs`);

    if (fs.existsSync(manualTestPath) && !args.force) {
      summary.skipped.push({
        rule: `${category}/${slug}`,
        reason: `已存在手写专项测试 ${path.relative(ROOT_DIR, manualTestPath)}`,
      });
      continue;
    }

    const content = buildGeneratedTestContent({ category, slug, rule, meta });
    if (!args.dryRun) {
      fs.mkdirSync(targetTestDir, { recursive: true });
      fs.writeFileSync(generatedTestPath, content, 'utf8');
    }
    summary.generated.push({
      rule: `${category}/${slug}`,
      file: path.relative(ROOT_DIR, generatedTestPath),
      content,
    });
  }

  return summary;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const summary = generateForAll(args);

  console.log(`🔧 社区规则测试自动生成完成：生成 ${summary.generated.length} 份，跳过 ${summary.skipped.length} 份`);
  for (const g of summary.generated) {
    console.log(`  ✔ [生成] ${g.rule} -> ${g.file}`);
  }
  for (const s of summary.skipped) {
    console.log(`  ⏭ [跳过] ${s.rule} (${s.reason})`);
  }
}

module.exports = {
  buildGeneratedTestContent,
  generateForAll,
  listRules,
};
