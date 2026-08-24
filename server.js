const express = require('express');
const cors = require('cors');
const execa = require('execa');
const archiver = require('archiver');

// 脚手架核心逻辑收敛在 @buildloop/lint 包，server 只做调用、交互、展示
const { generateScaffoldToMemory } = require('./packages/lint/lib');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 合法取值（与 @buildloop/lint GenerateOpt 对齐）
const FRAMEWORKS = ['react', 'vue', 'vanilla'];
const LANGS = ['typescript', 'javascript'];

/**
 * 解析并校验脚手架参数
 * 支持 body 或 query 传入：framework、lang
 * 返回 { ok, framework?, lang?, missing? }
 */
const parseScaffoldParams = (input) => {
  const framework = (input.framework || '').toLowerCase();
  const lang = (input.lang || '').toLowerCase();
  const missing = [];
  if (!FRAMEWORKS.includes(framework)) missing.push('framework');
  if (!LANGS.includes(lang)) missing.push('lang');
  return {
    ok: missing.length === 0,
    framework: FRAMEWORKS.includes(framework) ? framework : undefined,
    lang: LANGS.includes(lang) ? lang : undefined,
    missing,
  };
};

// ============ 脚手架生成接口 ============

/**
 * 生成脚手架配置（内存模式，返回文件树）
 * POST /api/scaffold
 * body: { framework: 'react'|'vue'|'vanilla', lang: 'typescript'|'javascript' }
 * 返回: { ok, data: { files: {路径:内容}, tree: FileTreeNode[] } }
 *
 * 参数不全时返回 400 + missing 字段，前端可据此弹出选择卡片
 */
app.post('/api/scaffold', async (req, res) => {
  try {
    const parsed = parseScaffoldParams(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({
        ok: false,
        msg: '参数不完整或非法',
        missing: parsed.missing,
        valid: { framework: FRAMEWORKS, lang: LANGS },
      });
    }

    const { files, tree } = await generateScaffoldToMemory({
      framework: parsed.framework,
      lang: parsed.lang,
    });

    res.json({
      ok: true,
      data: { files, tree, count: Object.keys(files).length },
    });
  } catch (err) {
    console.error('scaffold 生成异常', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 批量下载脚手架 zip
 * GET /api/scaffold/download?framework=react&lang=typescript
 */
app.get('/api/scaffold/download', async (req, res) => {
  try {
    const parsed = parseScaffoldParams(req.query || {});
    if (!parsed.ok) {
      return res.status(400).json({
        ok: false,
        msg: '参数不完整或非法',
        missing: parsed.missing,
      });
    }

    const { files } = await generateScaffoldToMemory({
      framework: parsed.framework,
      lang: parsed.lang,
    });

    const zipName = `buildloop-lint-${parsed.framework}-${parsed.lang}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    // archiver 5.x 为 commonjs
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      throw err;
    });
    archive.pipe(res);

    // 批量追加文件
    Object.entries(files).forEach(([filePath, content]) => {
      archive.append(content, { name: filePath });
    });

    await archive.finalize();
  } catch (err) {
    console.error('scaffold download 异常', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// ============ 代码扫描/修复接口（与脚手架能力共存，互不干扰） ============

/**
 * 接收 Trae 传过来的代码文本，调用本地 CLI
 * 保留原有能力，与新增的 /api/scaffold 完全独立
 */
app.post('/api/lint-code', async (req, res) => {
  try {
    const { sourceCode } = req.body;
    if (!sourceCode) {
      return res.status(400).json({ ok: false, msg: '缺少待处理代码sourceCode' });
    }

    const { stdout } = await execa(
      'node',
      ['./packages/encode-hooks/bin/cli.js'],
      { input: sourceCode }
    );

    res.json({
      ok: true,
      data: {
        originCode: sourceCode,
        report: stdout
      }
    })
  } catch (err) {
    console.error("cli调用异常", err);
    res.json({ ok: false, error: err.message })
  }
})

const PORT = 8899;
app.listen(PORT, () => {
  console.log(`✅本地网关已启动，地址：http://127.0.0.1:${PORT}`);
  console.log(`  脚手架生成：POST http://127.0.0.1:${PORT}/api/scaffold`);
  console.log(`  批量下载：  GET  http://127.0.0.1:${PORT}/api/scaffold/download?framework=react&lang=typescript`);
})
