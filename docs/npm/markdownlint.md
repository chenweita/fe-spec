---
title: @buildloop/markdownlint-config
categories:
  - 工程规范
tags:
  - 工程规范
author:
  name: 花花
  link: https://github.com/encode-studio-fe/fe-spec
---

# @buildloop/markdownlint-config

:::tip
前端 文档 规范
:::

支持配套的 [markdownlint 可共享配置](https://www.npmjs.com/package/markdownlint#optionsconfig)。

## 安装

需要先行安装 [markdownlint](https://www.npmjs.com/package/markdownlint)：

```bash
npm install @buildloop/markdownlint-config markdownlint --save-dev
```

## 使用

在 `.markdownlint.json` 中继承本包:

```json
{
  "extends": "@buildloop/markdownlint-config"
}
```
