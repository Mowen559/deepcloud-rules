/* eslint-disable no-console */
/**
 * DeepCloud 社区规则统一测试沙箱底座 (Zero-Dependency Hiker Rule Test Harness)
 *
 * 提供：
 * 1. 轻量级 DOM/CSS 选择器引擎：完整兼容海阔 `pdfa` / `pdfh` / `pd` 语法（含 `&&Text`、`&&Html`、`&&attr`）
 * 2. Node `vm` 隔离沙箱执行器：注入 `request`、`post`、`MY_URL`、`MY_PAGE`、`MY_CATE`、`setResult`、`@lazyRule=` 等运行时
 * 3. 静态同构与安全审计器：编译校验、防踩坑铁律检测、高危模式拦截
 */

'use strict';

const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const DANGEROUS_PATTERNS = [
  /(?:127\.0\.0\.1|localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /process\.exit/i,
  /\bexec\s*\(/i,
];

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parseAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = decodeHtmlEntities(val);
  }
  return attrs;
}

function parseHtml(html) {
  const root = {
    type: 'root',
    tag: '#root',
    attrs: {},
    children: [],
    parent: null,
    rawStart: 0,
    rawEnd: 0,
    innerStart: 0,
    innerEnd: 0,
  };
  const src = String(html || '');
  root.rawEnd = src.length;
  root.innerEnd = src.length;

  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9:-]+)\s*>|<([a-zA-Z0-9:-]+)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRe.exec(src)) !== null) {
    const current = stack[stack.length - 1];
    if (match.index > lastIndex) {
      current.children.push({
        type: 'text',
        text: src.slice(lastIndex, match.index),
        parent: current,
      });
    }

    if (match[0].startsWith('<!--')) {
      lastIndex = tokenRe.lastIndex;
      continue;
    }

    if (match[1]) {
      // Closing tag
      const closeTag = match[1].toLowerCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === closeTag) {
          while (stack.length - 1 >= i) {
            const popped = stack.pop();
            popped.innerEnd = match.index;
            popped.rawEnd = tokenRe.lastIndex;
          }
          break;
        }
      }
    } else if (match[2]) {
      const tag = match[2].toLowerCase();
      const attrStr = match[3] || '';
      const selfClosing = Boolean(match[4]) || VOID_TAGS.has(tag);
      const node = {
        type: 'element',
        tag,
        attrs: parseAttributes(attrStr),
        children: [],
        parent: current,
        rawStart: match.index,
        innerStart: tokenRe.lastIndex,
        innerEnd: tokenRe.lastIndex,
        rawEnd: tokenRe.lastIndex,
      };
      current.children.push(node);

      if (!selfClosing) {
        if (tag === 'script' || tag === 'style') {
          const endRe = new RegExp(`</${tag}\\s*>`, 'i');
          const rest = src.slice(tokenRe.lastIndex);
          const endMatch = endRe.exec(rest);
          if (endMatch) {
            const textEnd = tokenRe.lastIndex + endMatch.index;
            if (endMatch.index > 0) {
              node.children.push({
                type: 'text',
                text: src.slice(tokenRe.lastIndex, textEnd),
                parent: node,
              });
            }
            node.innerEnd = textEnd;
            node.rawEnd = textEnd + endMatch[0].length;
            tokenRe.lastIndex = node.rawEnd;
          }
        } else {
          stack.push(node);
        }
      }
    }

    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < src.length) {
    stack[stack.length - 1].children.push({
      type: 'text',
      text: src.slice(lastIndex),
      parent: stack[stack.length - 1],
    });
  }

  return { root, src };
}

function getNodeText(node) {
  if (!node) return '';
  if (node.type === 'text') return decodeHtmlEntities(node.text);
  return (node.children || []).map(getNodeText).join('');
}

function getNodeOuterHtml(node, src) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.tag === '#root') return src;
  return src.slice(node.rawStart, node.rawEnd);
}

function getNodeInnerHtml(node, src) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.tag === '#root') return src;
  return src.slice(node.innerStart, node.innerEnd);
}

function matchesSimpleSelector(node, simpleSel) {
  if (!node || node.type !== 'element') return false;
  let rest = simpleSel.trim();
  if (!rest || rest === '*') return true;

  // Attribute selectors [k="v"] or [k]
  const attrChecks = [];
  rest = rest.replace(/\[([^\]]+)\]/g, (_, expr) => {
    const eqIdx = expr.indexOf('=');
    if (eqIdx === -1) {
      attrChecks.push({ key: expr.trim().toLowerCase(), val: null });
    } else {
      const k = expr.slice(0, eqIdx).trim().toLowerCase();
      const v = expr.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      attrChecks.push({ key: k, val: v });
    }
    return '';
  });

  // Tag name (must come first if present)
  let tagMatch = null;
  const tagRe = /^([a-zA-Z0-9:-]+)/;
  const tm = tagRe.exec(rest);
  if (tm) {
    tagMatch = tm[1].toLowerCase();
    rest = rest.slice(tm[0].length);
  }
  if (tagMatch && node.tag !== tagMatch) return false;

  // #id and .class
  const ids = [];
  const classes = [];
  const tokenRe = /([#.])([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = tokenRe.exec(rest)) !== null) {
    if (m[1] === '#') ids.push(m[2]);
    else classes.push(m[2]);
  }

  for (const id of ids) {
    if ((node.attrs.id || '') !== id) return false;
  }
  if (classes.length > 0) {
    const nodeClasses = new Set((node.attrs.class || '').split(/\s+/).filter(Boolean));
    for (const cls of classes) {
      if (!nodeClasses.has(cls)) return false;
    }
  }
  for (const chk of attrChecks) {
    if (!(chk.key in node.attrs)) return false;
    if (chk.val !== null && node.attrs[chk.key] !== chk.val) return false;
  }

  return true;
}

function collectDescendants(node, out = []) {
  for (const child of node.children || []) {
    if (child.type === 'element') {
      out.push(child);
      collectDescendants(child, out);
    }
  }
  return out;
}

function querySelectorAll(rootNode, selector) {
  const trimmed = String(selector || '').trim();
  if (!trimmed) return [];

  // Tokenize descendant (' ') and direct child ('>') combinators
  const tokens = trimmed.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  let currentSet = [rootNode];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '>') {
      const nextSel = tokens[++i];
      if (!nextSel) return [];
      const nextSet = [];
      const seen = new Set();
      for (const parent of currentSet) {
        for (const child of parent.children || []) {
          if (child.type === 'element' && matchesSimpleSelector(child, nextSel) && !seen.has(child)) {
            seen.add(child);
            nextSet.push(child);
          }
        }
      }
      currentSet = nextSet;
    } else {
      const nextSet = [];
      const seen = new Set();
      for (const base of currentSet) {
        // Also check base itself when it's an element root of a fragment
        const candidates = base.type === 'element' ? [base, ...collectDescendants(base)] : collectDescendants(base);
        for (const cand of candidates) {
          if (matchesSimpleSelector(cand, tok) && !seen.has(cand)) {
            seen.add(cand);
            nextSet.push(cand);
          }
        }
      }
      currentSet = nextSet;
    }
  }

  return currentSet;
}

function createDomHelpers() {
  function pdfa(html, selector) {
    if (!html || !selector) return [];
    const { root, src } = parseHtml(html);
    // 海阔支持 '&&' 分隔的多级选择器
    const segments = String(selector).split('&&').map(s => s.trim()).filter(Boolean);
    let nodes = [root];
    for (const seg of segments) {
      const next = [];
      for (const n of nodes) {
        next.push(...querySelectorAll(n, seg));
      }
      nodes = next;
    }
    return nodes.map(n => getNodeOuterHtml(n, src));
  }

  function pdfh(html, selector) {
    if (!html || !selector) return '';
    const raw = String(selector);
    const parts = raw.split('&&');
    const attrOrMode = parts.length > 1 ? parts[parts.length - 1].trim() : 'Text';
    const cssParts = parts.length > 1 ? parts.slice(0, -1).map(s => s.trim()).filter(Boolean) : [raw.trim()];

    const { root, src } = parseHtml(html);
    let targetNode = null;

    if (cssParts.length === 0) {
      // 形如 '&&title' 直接读取片段根元素属性
      targetNode = (root.children || []).find(c => c.type === 'element') || root;
    } else {
      let nodes = [root];
      for (const seg of cssParts) {
        const next = [];
        for (const n of nodes) {
          next.push(...querySelectorAll(n, seg));
        }
        nodes = next;
      }
      targetNode = nodes[0] || null;
    }

    if (!targetNode) return '';

    if (attrOrMode === 'Text') {
      return getNodeText(targetNode).replace(/\s+/g, ' ').trim();
    }
    if (attrOrMode === 'Html') {
      return getNodeInnerHtml(targetNode, src);
    }
    return targetNode.attrs?.[attrOrMode.toLowerCase()] || '';
  }

  function pd(html, selector, baseUrl) {
    const val = pdfh(html, selector);
    if (!val) return '';
    if (/^(?:https?:|hiker:|magnet:|ed2k:|thunder:)/i.test(val)) return val;
    if (!baseUrl) return val;
    try {
      return new URL(val, baseUrl).toString();
    } catch {
      return val;
    }
  }

  return { pdfa, pdfh, pd };
}

function syncHttpRequest(url, options = {}) {
  const payload = JSON.stringify({
    url,
    method: (options.method || 'GET').toUpperCase(),
    headers: options.headers || {},
    body: options.body || undefined,
    timeoutMs: options.timeout || 15000,
  });

  const script = `
    const req = JSON.parse(process.argv[1]);
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });
        const text = await res.text();
        process.stdout.write(text);
      } finally {
        clearTimeout(timer);
      }
    })().catch((err) => {
      console.error(err.message || String(err));
      process.exit(2);
    });
  `;

  const proc = spawnSync(process.execPath, ['-e', script, payload], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    throw new Error(`HTTP 请求失败 (${url}): ${proc.stderr || proc.status}`);
  }
  return proc.stdout || '';
}

function stripJsPrefix(code) {
  const s = String(code || '').trim();
  return s.startsWith('js:') ? s.slice(3).trim() : s;
}

function runHikerScript(code, opts = {}) {
  const jsCode = stripJsPrefix(code);
  const { pdfa, pdfh, pd } = createDomHelpers();
  const requestsLog = [];
  const storage = new Map(Object.entries(opts.initialStorage || {}));
  const myVars = new Map(Object.entries(opts.initialVars || {}));
  const globalVars = new Map(Object.entries(opts.initialGlobalVars || {}));
  const virtualFiles = new Map(Object.entries(opts.initialFiles || {}));
  let resultItems = null;

  function doRequest(url, reqOpts = {}) {
    requestsLog.push({ url, options: reqOpts });
    if (typeof opts.mockRequest === 'function') {
      const mocked = opts.mockRequest(url, reqOpts);
      return mocked == null ? '' : String(mocked);
    }
    if (opts.liveNetwork) {
      return syncHttpRequest(url, reqOpts);
    }
    return opts.defaultHtml || '<html><body></body></html>';
  }

  const sandbox = {
    MY_URL: opts.MY_URL ?? '',
    MY_PAGE: opts.MY_PAGE ?? 1,
    MY_CATE: opts.MY_CATE ?? '',
    MY_KEYWORD: opts.MY_KEYWORD ?? '',
    KEYWORD: opts.KEYWORD ?? opts.MY_KEYWORD ?? '',
    MY_RULE: opts.MY_RULE ?? {},
    MY_PARAMS: opts.MY_PARAMS ?? {},
    MY_HOME: opts.MY_HOME ?? '',
    input: opts.input ?? '',
    request: doRequest,
    fetch: doRequest,
    post: (url, reqOpts = {}) => doRequest(url, { ...reqOpts, method: 'POST' }),
    requestAsync: doRequest,
    fetchAsync: doRequest,
    getResCode: () => '{}',
    getCookie: () => '',
    pdfa,
    pdfh,
    pd,
    parseDomForArray: pdfa,
    parseDomForHtml: pdfh,
    parseDom: pd,
    setResult(items) {
      resultItems = Array.isArray(items) ? items : [];
    },
    getItem(k, defVal = '') {
      return storage.has(k) ? storage.get(k) : defVal;
    },
    setItem(k, v) {
      storage.set(k, String(v));
    },
    clearItem(k) {
      storage.delete(k);
    },
    getMyVar(k, defVal = '') {
      return myVars.has(k) ? myVars.get(k) : defVal;
    },
    putMyVar(k, v) {
      myVars.set(k, v);
    },
    clearMyVar(k) {
      myVars.delete(k);
    },
    getVar(k, defVal = '') {
      return globalVars.has(k) ? globalVars.get(k) : defVal;
    },
    putVar(k, v) {
      globalVars.set(k, v);
    },
    clearVar(k) {
      globalVars.delete(k);
    },
    fileExist: (p) => virtualFiles.has(p),
    readFile: (p) => (virtualFiles.has(p) ? virtualFiles.get(p) : ''),
    saveFile: (p, content) => { virtualFiles.set(p, String(content ?? '')); },
    deleteFile: (p) => { virtualFiles.delete(p); },
    toast() {},
    log: (...a) => console.log(...a),
    showLoading() {},
    hideLoading() {},
    refreshPage() {},
    back() {},
    setPageTitle() {},
    setError() {},
    $: {
      toString: (fn) => (typeof fn === 'function' ? `js:${fn.toString()}` : String(fn)),
      require: () => ({}),
      dateFormat: () => '',
    },
    base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
    base64Decode: (s) => Buffer.from(String(s), 'base64').toString('utf8'),
    md5: (s) => crypto.createHash('md5').update(String(s)).digest('hex'),
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    parseInt,
    parseFloat,
    isNaN,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };

  const wrapped = `(function() {\n${jsCode}\n})()`;
  const script = new vm.Script(wrapped, { filename: opts.filename || 'hiker-rule.js' });
  const rawReturn = script.runInNewContext(sandbox, { timeout: opts.timeoutMs || 5000 });

  // 将 vm 沙箱跨 realm 对象归一化为宿主原型，避免 node:assert/strict 的 deepEqual 报原型不一致
  const normalizeRealm = (val) => (val === undefined ? undefined : JSON.parse(JSON.stringify(val)));

  return {
    results: resultItems === null ? null : normalizeRealm(resultItems),
    returnValue: typeof rawReturn === 'object' && rawReturn !== null ? normalizeRealm(rawReturn) : rawReturn,
    requestsLog,
    storage: Object.fromEntries(storage),
    myVars: Object.fromEntries(myVars),
  };
}

function evalLazyRule(fullUrl, opts = {}) {
  const str = String(fullUrl || '');
  const marker = '@lazyRule=.js:';
  const idx = str.indexOf(marker);
  if (idx === -1) {
    throw new Error(`URL 未包含标准 @lazyRule=.js: 协议: ${str}`);
  }
  const targetUrl = str.slice(0, idx);
  const lazyCode = str.slice(idx + marker.length);
  const execRes = runHikerScript(`return (${lazyCode});`, {
    ...opts,
    input: targetUrl,
    MY_URL: targetUrl,
    filename: 'lazy-rule.js',
  });
  return {
    targetUrl,
    playUrl: execRes.returnValue,
    requestsLog: execRes.requestsLog,
  };
}

function auditRuleStatic(rule, meta = null) {
  const errors = [];
  const warnings = [];

  if (!rule || typeof rule !== 'object') {
    return { errors: ['rule.json 必须是 JSON 对象'], warnings };
  }

  const title = rule.title || rule.name;
  if (!title) errors.push('缺少必填字段 title/name');

  if (meta) {
    const metaTitle = meta.name || meta.title;
    if (metaTitle && title && metaTitle !== title) {
      errors.push(`meta.json 名称 (${metaTitle}) 与 rule.json title (${title}) 不一致`);
    }
    if (meta.version !== undefined && rule.version !== undefined && String(meta.version) !== String(rule.version)) {
      errors.push(`meta.json version (${meta.version}) 与 rule.json version (${rule.version}) 不一致`);
    }
  }

  if (rule.class_name && rule.class_url) {
    const names = String(rule.class_name).split('&');
    const urls = String(rule.class_url).split('&');
    if (names.length !== urls.length) {
      errors.push(`class_name (${names.length} 项) 与 class_url (${urls.length} 项) 数量不匹配`);
    }
  }

  const rawJson = JSON.stringify(rule);
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(rawJson)) {
      errors.push(`触发安全拦截规则: ${pattern}`);
    }
  }

  // 逐字段检查 js: 代码可编译性与铁律
  const jsFields = ['find_rule', 'search_find', 'search_rule', 'detail_find_rule', 'preRule', 'sdetail_find_rule'];
  for (const field of jsFields) {
    const val = rule[field];
    if (typeof val !== 'string' || !val.trim().startsWith('js:')) continue;
    const code = stripJsPrefix(val);

    try {
      new vm.Script(`(function(){\n${code}\n})()`, { filename: `${field}.js` });
    } catch (err) {
      errors.push(`${field} JS 语法编译失败: ${err.message}`);
    }

    if (/\b(?:window|document)\s*\./.test(code)) {
      warnings.push(`${field} 存在 window/document 访问，请确认仅在兼容判断或 WebView 中使用`);
    }
    if (/(?:pdfa|pdfh|pd)\s*\([^)]*,\s*['"][^'"]*,[^'"]*['"]/.test(code)) {
      warnings.push(`${field} 的 pdfa/pdfh/pd 选择器包含英文逗号 ','，移动端可能报错`);
    }
    if (/['"]lazy:/.test(code)) {
      warnings.push(`${field} 建议使用标准 '@lazyRule=.js:' 协议替代 'lazy:'`);
    }
  }

  if (typeof rule.detail_find_rule === 'string' && rule.detail_find_rule.trim().startsWith('js:')) {
    if (!rule.detail_find_rule.includes('剧名：') && !rule.detail_find_rule.includes('pic_1_card')) {
      warnings.push('detail_find_rule 建议首项使用 pic_1_card 并注入 "剧名：" 前缀以保护播放历史');
    }
  }

  return { errors, warnings };
}

module.exports = {
  parseHtml,
  createDomHelpers,
  runHikerScript,
  evalLazyRule,
  auditRuleStatic,
  stripJsPrefix,
};
