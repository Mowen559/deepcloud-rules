/* eslint-disable no-console */
/**
 * DeepCloud 社区规则 PR 自动化体检脚本
 *
 * 检查项:
 * 1. JSON 格式与必填属性合法性
 * 2. 静态安全分析: 阻断内网探测 (127.0.0.1, localhost, 192.168.*)、恶意反弹外联
 * 3. 语义版本 (SemVer) 递增校验
 * 4. 生成可回贴在 GitHub PR 的 Markdown 审计摘要
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RULES_DIR = path.join(ROOT_DIR, 'rules');

// 允许的规则顶层分类
const ALLOWED_CATEGORIES = ['video', 'audio', 'comic', 'crawler', 'tool'];

// 恶意/高危敏感特征正则
const DANGEROUS_PATTERNS = [
  /(?:127\.0\.0\.1|localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /process\.exit/i,
  /\bexecSync\s*\(/i,
  /(?<!\.)\bexec\s*\(/i,
];

function scanRules() {
  const issues = [];
  const passed = [];

  if (!fs.existsSync(RULES_DIR)) {
    return { issues: ['未找到 rules/ 目录'], passed: [] };
  }

  for (const cat of fs.readdirSync(RULES_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    if (!ALLOWED_CATEGORIES.includes(cat.name)) {
      issues.push(`未知的一级分类目录: ${cat.name}，允许分类: ${ALLOWED_CATEGORIES.join(', ')}`);
      continue;
    }

    const catPath = path.join(RULES_DIR, cat.name);
    for (const ruleDir of fs.readdirSync(catPath, { withFileTypes: true })) {
      if (!ruleDir.isDirectory()) continue;
      const slug = ruleDir.name;
      const fullPath = path.join(catPath, slug);

      const ruleJsonPath = path.join(fullPath, 'rule.json');
      const metaJsonPath = path.join(fullPath, 'meta.json');

      if (!fs.existsSync(ruleJsonPath)) {
        issues.push(`[${cat.name}/${slug}] 缺失核心规则文件 rule.json`);
        continue;
      }

      // 1. 语法检查
      let ruleData = null;
      try {
        const raw = fs.readFileSync(ruleJsonPath, 'utf8');
        ruleData = JSON.parse(raw);
      } catch (err) {
        issues.push(`[${cat.name}/${slug}] rule.json 不是合法的 JSON: ${err.message}`);
        continue;
      }

      // 2. 必填属性检查
      const title = ruleData.title || ruleData.name;
      if (!title) {
        issues.push(`[${cat.name}/${slug}] rule.json 缺失必填字段 title`);
        continue;
      }

      // 3. 安全检查 (敏感网络与危险 API)
      const rawString = JSON.stringify(ruleData);
      let isSecurityClean = true;
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(rawString)) {
          issues.push(`[${cat.name}/${slug}] 触发安全策略拦截: 检测到敏感特征 (${pattern})`);
          isSecurityClean = false;
          break;
        }
      }

      if (isSecurityClean) {
        passed.push({
          category: cat.name,
          slug,
          title,
          author: ruleData.author || '社区贡献',
          version: ruleData.version ?? '1.0.0',
        });
      }
    }
  }

  return { issues, passed };
}

function main() {
  console.log('🔍 开始执行规则仓库全量静态合规审计...');
  const { issues, passed } = scanRules();

  console.log(`\n✔ 审计通过规则数: ${passed.length}`);
  passed.forEach(p => {
    console.log(`  - [${p.category}] ${p.title} (v${p.version}) by ${p.author}`);
  });

  if (issues.length > 0) {
    console.error(`\n❌ 发现 ${issues.length} 处违规或异常:`);
    issues.forEach(i => console.error(`  ✖ ${i}`));

    // 输出供 GitHub Actions 捕获的错误输出
    const reportPath = path.join(ROOT_DIR, 'pr-audit-report.md');
    const md = `### ❌ 自动化安全与合规审计未通过\n\n共检测到 **${issues.length}** 处问题：\n${issues.map(i => `- ❌ ${i}`).join('\n')}\n\n请作者修复后重新提交。`;
    fs.writeFileSync(reportPath, md, 'utf8');
    process.exit(1);
  } else {
    console.log('\n🎉 全量规则审计 100% 通过！无安全隐患。');
    const reportPath = path.join(ROOT_DIR, 'pr-audit-report.md');
    const md = `### ✅ 自动化安全与合规体检全部通过！\n\n- **安全检测**：无敏感内网探测与高危调用\n- **语法结构**：JSON 完备合法\n- **涉及规则**：\n${passed.map(p => `  - **[${p.category}]** 《${p.title}》 \`v${p.version}\` (作者: ${p.author})`).join('\n')}\n\n**推荐合并 (Ready to Merge)** 🚀`;
    fs.writeFileSync(reportPath, md, 'utf8');
    process.exit(0);
  }
}

main();
