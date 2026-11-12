/* eslint-disable no-console */
/**
 * 自动构建全量规则索引构建器 (build-index.cjs)
 *
 * 遍历 rules/ 目录，编译输出格式化 rules-index.json，
 * 供 DeepCloud 客户端及 jsDelivr / GitHub Pages CDN 极速分发。
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RULES_DIR = path.join(ROOT_DIR, 'rules');
const KEYS_VAULT = path.join(ROOT_DIR, 'keys', 'vault.json');
const OUTPUT_INDEX = path.join(ROOT_DIR, 'rules-index.json');
const OUTPUT_KEYS = path.join(ROOT_DIR, 'keys-index.json');

const REPO_RAW_BASE = 'https://fastly.jsdelivr.net/gh/Mowen559/deepcloud-rules@main';

function buildIndex() {
  const allRules = [];

  // 1. 同步构建 keys-index.json
  let vaultData = null;
  if (fs.existsSync(KEYS_VAULT)) {
    try {
      vaultData = JSON.parse(fs.readFileSync(KEYS_VAULT, 'utf8'));
      fs.writeFileSync(OUTPUT_KEYS, JSON.stringify(vaultData, null, 2) + '\n', 'utf8');
      console.log(`✔ [BuildIndex] 成功构建 keys-index.json，包含 ${Object.keys(vaultData.services || {}).length} 个服务凭据`);
    } catch (e) {
      console.warn('⚠ [BuildIndex] 构建 keys-index.json 失败:', e.message);
    }
  }

  if (!fs.existsSync(RULES_DIR)) {
    console.warn('rules/ 目录不存在，生成空索引');
    fs.writeFileSync(OUTPUT_INDEX, JSON.stringify({ version: '1.0.0', updatedAt: new Date().toISOString(), rules: [] }, null, 2));
    return;
  }

  for (const cat of fs.readdirSync(RULES_DIR, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const catPath = path.join(RULES_DIR, cat.name);

    for (const ruleDir of fs.readdirSync(catPath, { withFileTypes: true })) {
      if (!ruleDir.isDirectory()) continue;
      const slug = ruleDir.name;
      const fullPath = path.join(catPath, slug);

      const ruleJsonPath = path.join(fullPath, 'rule.json');
      const metaJsonPath = path.join(fullPath, 'meta.json');

      if (!fs.existsSync(ruleJsonPath)) continue;

      let ruleData = {};
      try {
        ruleData = JSON.parse(fs.readFileSync(ruleJsonPath, 'utf8'));
      } catch {
        continue;
      }

      let metaData = {};
      if (fs.existsSync(metaJsonPath)) {
        try {
          metaData = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'));
        } catch {}
      }

      const id = `${cat.name}:${slug}`;
      const title = ruleData.title || ruleData.name || slug;
      const author = ruleData.author || metaData.author || '社区贡献';
      const version = String(ruleData.version ?? metaData.version ?? '1.0.0');
      const description = metaData.description || ruleData.find_rule ? `海阔视界 ${title} 规则` : 'DeepCloud 社区规则';

      const ruleItem = {
        id,
        name: title,
        title,
        author,
        version,
        category: cat.name,
        description,
        icon: metaData.icon || undefined,
        sourceType: 'community',
        assetKind: cat.name === 'crawler' ? 'scraper_spec' : 'hiker_rule',
        ruleUrl: `${REPO_RAW_BASE}/rules/${cat.name}/${slug}/rule.json`,
        updatedAt: metaData.updatedAt || new Date().toISOString().split('T')[0],
        installStatus: 'available',
      };

      allRules.push(ruleItem);
    }
  }

  const manifest = {
    version: '1.0.0',
    total: allRules.length,
    updatedAt: new Date().toISOString(),
    rules: allRules,
  };

  fs.writeFileSync(OUTPUT_INDEX, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✔ [BuildIndex] 成功构建 rules-index.json，共收录 ${allRules.length} 个规则`);
}

buildIndex();
