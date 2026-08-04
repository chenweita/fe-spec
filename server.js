const express = require('express');
const cors = require('cors');
const execa = require('execa');

const app = express();
app.use(cors());
app.use(express.json());

// 接口：接收Trae传过来的代码文本，调用本地CLI
app.post("/api/lint-code", async (req, res) => {
  try {
    const { sourceCode } = req.body;
    if (!sourceCode) {
      return res.status(400).json({ ok: false, msg: "缺少待处理代码sourceCode" });
    }

    // 调用你项目内部的cli脚本，用stdin把代码传给cli
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
})