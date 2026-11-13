/**
 * 社区规则专项回归测试：《动漫共和国》(video/dmghk)
 *
 * 覆盖：
 *   1. 元数据与规则契约校验（meta.json / rule.json / 分类对齐 / 静态铁律）
 *   2. 一级首页渲染（21:9 banner_carousel 轮播、热门模块上限 9 张、空模块过滤、防盗链封面清洗）
 *   3. 分类与榜单多维映射（日漫 / 国漫 / 特摄 / 排行榜 / 猜你想看 / 分页 URL 构造）
 *   4. 全局搜索链路（search_url 模板替换 + search_find / search_rule 双入口解析）
 *   5. 二级详情页与画质置顶铁律（剧名首卡保护、TX/YK/BL/优酷等广告线过滤、稳定原画置顶排序、全屏蔽兜底）
 *   6. 选集 @lazyRule=.js: 惰性直链提取（player_aaaa JSON 解析与反斜杠清洗）
 *   7. 可选真网冒烟验证（设置环境变量 DEEPCLOUD_LIVE_TEST=1 触发）
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  runHikerScript,
  evalLazyRule,
  auditRuleStatic,
} = require('../../lib/hiker-test-harness.cjs');

const RULE_DIR = path.resolve(__dirname, '../../../rules/video/dmghk');
const rule = JSON.parse(fs.readFileSync(path.join(RULE_DIR, 'rule.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(RULE_DIR, 'meta.json'), 'utf8'));

const HOME_HTML_FIXTURE = `
<!DOCTYPE html>
<html>
<body>
  <div class="swiper-wrapper">
    <div class="swiper-slide">
      <a class="banner" href="/index.php/vod/detail/id/1001.html" style="background-image: url('/upload/vod/banner1.jpg')"></a>
      <div class="v-title"><span>葬送的芙莉莲</span></div>
      <div class="v-ins"><p>奇幻冒险治愈神作</p></div>
    </div>
    <div class="swiper-slide">
      <a class="banner" href="/index.php/vod/detail/id/1002.html" style="background-image: url('https://cdn.example.com/banner2.jpg')"></a>
      <div class="v-title"><span>迷宫饭</span></div>
      <div class="v-ins"><p>地下城美食冒险</p></div>
    </div>
  </div>

  <div class="module">
    <div class="module-heading"><h2 class="module-title">空悬无卡片模块</h2></div>
  </div>

  <div class="module">
    <div class="module-heading"><h2 class="module-title">本季热播新番</h2></div>
    ${Array.from({ length: 12 }, (_, idx) => {
      const id = 2000 + idx;
      const src = idx === 0
        ? `https://www.jcy23.com/img.php?url=${encodeURIComponent('https://img.cdn.test/cover0.jpg')}`
        : `//img.cdn.test/cover${idx}.jpg`;
      return `
        <div class="module-poster-item">
          <a href="/index.php/vod/detail/id/${id}.html" title="新番-${idx + 1}">
            <img data-original="${src}" alt="新番-${idx + 1}" />
          </a>
          <div class="module-poster-item-title">新番-${idx + 1}</div>
          <div class="module-item-note">更新至第${idx + 1}集</div>
        </div>
      `;
    }).join('\n')}
  </div>
</body>
</html>
`;

const CATEGORY_CARDS_FIXTURE = `
<div class="module-items">
  <div class="module-card-item">
    <a class="module-card-item-poster" href="/index.php/vod/detail/id/3001.html">
      <img data-original="/upload/3001.jpg" alt="假面骑士极狐" />
    </a>
    <div class="module-card-item-title"><a href="/index.php/vod/detail/id/3001.html">假面骑士极狐</a></div>
    <div class="module-item-note">完结</div>
  </div>
</div>
`;

const CATEGORY_POSTERS_FIXTURE = `
<div class="module-items">
  <div class="module-poster-item">
    <a href="/index.php/vod/detail/id/4001.html" title="凡人修仙传">
      <img data-original="/upload/4001.jpg" alt="凡人修仙传" />
    </a>
    <div class="module-poster-item-title">凡人修仙传</div>
    <div class="module-item-note">更新至120集</div>
  </div>
</div>
`;

const DETAIL_HTML_FIXTURE = `
<!DOCTYPE html>
<html>
<body>
  <div class="module-info-heading"><h1>灵笼 第一季</h1></div>
  <div class="module-item-pic"><img data-original="/upload/linglong.jpg" /></div>
  <div class="module-info-introduction-content">末日科幻国漫巅峰之作，人类在空中灯塔求生。</div>

  <div class="module-tab-items-box">
    <div class="module-tab-item"><span>TX视频</span></div>
    <div class="module-tab-item"><span>备用线路</span></div>
    <div class="module-tab-item"><span>优质极速</span></div>
    <div class="module-tab-item"><span>B站外链</span></div>
    <div class="module-tab-item"><span>4K专线</span></div>
    <div class="module-tab-item"><span>稳定原画</span></div>
  </div>

  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/tx-1.html" title="第01集"><span>第01集</span></a></div>
  </div>
  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/backup-1.html" title="第01集"><span>第01集</span></a></div>
  </div>
  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/fast-1.html" title="第01集"><span>第01集</span></a></div>
  </div>
  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/bl-1.html" title="第01集"><span>第01集</span></a></div>
  </div>
  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/4k-1.html" title="第01集"><span>第01集</span></a></div>
  </div>
  <div class="module-play-list-content">
    <div class="module-play-list-link"><a href="/play/raw-1.html" title="第01集"><span>第01集</span></a></div>
    <div class="module-play-list-link"><a href="/play/raw-2.html" title="第02集"><span>第02集</span></a></div>
  </div>
</body>
</html>
`;

test('1. 契约、分类对齐与静态同构铁律校验', () => {
  assert.equal(rule.title, '动漫共和国');
  assert.equal(rule.author, 'DeepCloud');
  assert.equal(Number.isInteger(rule.version), true);
  assert.ok(rule.version >= 1);
  assert.equal(meta.category, 'video');

  const classNames = rule.class_name.split('&');
  const classUrls = rule.class_url.split('&');
  assert.equal(classNames.length, 10);
  assert.equal(classUrls.length, 10);

  const audit = auditRuleStatic(rule, meta);
  assert.deepEqual(audit.errors, []);
  assert.deepEqual(audit.warnings, []);
});

test('2. 首页解析：21:9 轮播、空模块剔除、单模块最多 9 卡与封面防盗链清洗', () => {
  const res = runHikerScript(rule.find_rule, {
    MY_URL: 'hiker://empty#home#1',
    MY_PAGE: 1,
    MY_CATE: 'home',
    MY_RULE: rule,
    mockRequest: (url) => {
      assert.equal(url, 'https://www.jcy23.com/');
      return HOME_HTML_FIXTURE;
    },
  });

  assert.ok(Array.isArray(res.results));
  assert.equal(res.results[0].col_type, 'banner_carousel');
  assert.equal(res.results[0].extra.slides.length, 2);
  assert.equal(res.results[0].extra.slides[0].title, '葬送的芙莉莲');
  assert.equal(
    res.results[0].extra.slides[0].img,
    'https://www.jcy23.com/upload/vod/banner1.jpg@Referer=https://www.jcy23.com/'
  );

  const headers = res.results.filter(i => i.col_type === 'text_1');
  assert.equal(headers.length, 1, '空模块不应渲染标题');
  assert.equal(headers[0].title, '🔥 本季热播新番');

  const posters = res.results.filter(i => i.col_type === 'movie_3');
  assert.equal(posters.length, 9, '首页每个热门模块最多截取 9 张海报卡片');
  assert.equal(
    posters[0].pic_url,
    'https://img.cdn.test/cover0.jpg@Referer=https://www.jcy23.com/',
    '应脱壳 img.php?url= 参数并附加 Referer'
  );
  assert.equal(
    posters[1].pic_url,
    'https://img.cdn.test/cover1.jpg@Referer=https://www.jcy23.com/'
  );
});

test('3. 分类与排行榜多维路由 URL 构造及卡片解析', () => {
  const cases = [
    {
      cate: 'riman',
      page: 2,
      expectedUrl: 'https://www.jcy23.com/index.php/vod/show/area/%E6%97%A5%E6%9C%AC/id/1/page/2.html',
      fixture: CATEGORY_POSTERS_FIXTURE,
      expectHeader: false,
    },
    {
      cate: 'teshe',
      page: 1,
      expectedUrl: 'https://www.jcy23.com/index.php/vod/search/page/1/wd/%E7%89%B9%E6%91%84.html',
      fixture: CATEGORY_CARDS_FIXTURE,
      expectHeader: false,
    },
    {
      cate: 'ranking',
      page: 1,
      expectedUrl: 'https://www.jcy23.com/index.php/label/hot.html',
      fixture: CATEGORY_CARDS_FIXTURE,
      expectHeader: true,
    },
    {
      cate: 'guess',
      page: 3,
      expectedUrl: 'https://www.jcy23.com/index.php/vod/show/by/score/id/1/page/3.html',
      fixture: CATEGORY_POSTERS_FIXTURE,
      expectHeader: false,
    },
  ];

  for (const c of cases) {
    const res = runHikerScript(rule.find_rule, {
      MY_URL: `hiker://empty#${c.cate}#${c.page}`,
      MY_PAGE: c.page,
      MY_CATE: c.cate,
      mockRequest: (url) => {
        assert.equal(url, c.expectedUrl);
        return c.fixture;
      },
    });
    assert.ok(res.results.length >= 1, `分类 ${c.cate} 应产出卡片`);
    const hasHeader = res.results.some(i => i.col_type === 'text_1');
    assert.equal(hasHeader, c.expectHeader);
    assert.ok(res.results.some(i => i.col_type === 'movie_3'));
  }
});

test('4. 全局搜索：search_url 模板替换及 search_find / search_rule 同步验证', () => {
  const searchUrl = rule.search_url.replace('fypage', '1').replace('**', encodeURIComponent('极狐'));
  assert.equal(searchUrl, 'https://www.jcy23.com/index.php/vod/search/page/1/wd/%E6%9E%81%E7%8B%90.html');

  for (const field of ['search_find', 'search_rule']) {
    const res = runHikerScript(rule[field], {
      MY_URL: searchUrl,
      input: searchUrl,
      MY_PAGE: 1,
      MY_KEYWORD: '极狐',
      mockRequest: (url) => {
        assert.equal(url, searchUrl);
        return CATEGORY_CARDS_FIXTURE;
      },
    });
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].title, '假面骑士极狐');
    assert.equal(res.results[0].url, 'https://www.jcy23.com/index.php/vod/detail/id/3001.html');
    assert.equal(res.results[0].pic_url, 'https://www.jcy23.com/upload/3001.jpg@Referer=https://www.jcy23.com/');
  }
});

test('5. 二级详情页：剧名保护、广告线过滤、稳定原画置顶排序与全屏蔽兜底', () => {
  const detailUrl = 'https://www.jcy23.com/index.php/vod/detail/id/5001.html';
  const res = runHikerScript(rule.detail_find_rule, {
    MY_URL: detailUrl,
    input: detailUrl,
    mockRequest: (url) => {
      assert.equal(url, detailUrl);
      return DETAIL_HTML_FIXTURE;
    },
  });

  // 首卡必须是 pic_1_card 且含 "剧名：" 前缀
  assert.equal(res.results[0].col_type, 'pic_1_card');
  assert.equal(res.results[0].title, '剧名：灵笼 第一季');

  // 线路标题顺序应为：稳定原画(100) > 4K(90) > 优质(80) > 备用(60)，且 TX/B站 被过滤
  const lineHeaders = res.results.filter(i => i.col_type === 'text_1').map(i => i.title);
  assert.equal(lineHeaders.length, 4);
  assert.match(lineHeaders[0], /稳定原画线/);
  assert.match(lineHeaders[1], /4K专线/);
  assert.match(lineHeaders[2], /优质极速/);
  assert.match(lineHeaders[3], /备用专线/);
  assert.equal(lineHeaders.some(t => /TX|B站/.test(t)), false);

  // 第 1 条选集应属于稳定原画线，且包含 @lazyRule=.js:
  const episodes = res.results.filter(i => i.col_type === 'text_3');
  assert.equal(episodes.length, 5);
  assert.ok(episodes[0].url.startsWith('https://www.jcy23.com/play/raw-1.html@lazyRule=.js:'));

  // 全部线路被屏蔽时保底输出 "🎬 播放专线"
  const onlyBlockedHtml = `
    <h1>测试剧集</h1>
    <div class="module-tab-items-box"><div class="module-tab-item"><span>腾讯视频</span></div></div>
    <div class="module-play-list-content">
      <div class="module-play-list-link"><a href="/play/fallback.html"><span>第01集</span></a></div>
    </div>
  `;
  const fallbackRes = runHikerScript(rule.detail_find_rule, {
    MY_URL: detailUrl,
    input: detailUrl,
    mockRequest: () => onlyBlockedHtml,
  });
  const fallbackHeaders = fallbackRes.results.filter(i => i.col_type === 'text_1').map(i => i.title);
  assert.deepEqual(fallbackHeaders, ['🎬 播放专线']);
});

test('6. 选集 @lazyRule 惰性解析：提取 player_aaaa 直链与异常回退', () => {
  const detailUrl = 'https://www.jcy23.com/index.php/vod/detail/id/5001.html';
  const detailRes = runHikerScript(rule.detail_find_rule, {
    MY_URL: detailUrl,
    input: detailUrl,
    mockRequest: () => DETAIL_HTML_FIXTURE,
  });
  const firstEpisode = detailRes.results.find(i => i.col_type === 'text_3');

  const playHtml = `
    <html><script>var player_aaaa={"flag":"play","encrypt":0,"url":"https:\\/\\/stream.example.com\\/hls\\/raw-1.m3u8"}</script></html>
  `;
  const lazyOut = evalLazyRule(firstEpisode.url, {
    mockRequest: (url) => {
      assert.equal(url, 'https://www.jcy23.com/play/raw-1.html');
      return playHtml;
    },
  });
  assert.equal(lazyOut.playUrl, 'https://stream.example.com/hls/raw-1.m3u8');

  const fallbackOut = evalLazyRule(firstEpisode.url, {
    mockRequest: () => '<html><body>no player config</body></html>',
  });
  assert.equal(fallbackOut.playUrl, 'https://www.jcy23.com/play/raw-1.html');
});

test('7. [可选真网实测] 访问动漫共和国首页验证线上连通性', {
  skip: process.env.DEEPCLOUD_LIVE_TEST !== '1' && '未开启 DEEPCLOUD_LIVE_TEST=1，跳过外网实测',
}, () => {
  const res = runHikerScript(rule.find_rule, {
    MY_URL: 'hiker://empty#home#1',
    MY_PAGE: 1,
    MY_CATE: 'home',
    MY_RULE: rule,
    liveNetwork: true,
  });
  assert.ok(Array.isArray(res.results) && res.results.length > 0, '线上首页应返回非空卡片数组');
});
