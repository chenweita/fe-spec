# CI/CD 流程说明

本文档描述 `fe-spec` 项目的 CI/CD 体系，覆盖本地开发校验、GitHub Actions 自动化构建部署、npm 包发布全流程。

## 目录

- [1. 整体架构](#1-整体架构)
- [2. 本地开发校验体系](#2-本地开发校验体系)
- [3. GitHub Actions 自动化 CI/CD](#3-github-actions-自动化-cicd)
- [4. npm 包发布流程](#4-npm-包发布流程)
- [5. 配置文件速查](#5-配置文件速查)
- [6. 踩坑记录与最佳实践](#6-踩坑记录与最佳实践)
- [7. 未来优化建议](#7-未来优化建议)

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         本地开发流程                              │
│                                                                 │
│  git commit ──► commit-msg hook (commitlint 校验)               │
│       │                                                         │
│       ▼                                                         │
│  husky 拦截不规范提交，保证提交信息符合 Conventional Commits     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ push to main
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Actions (CI/CD)                      │
│                                                                 │
│  .github/workflows/deploy.yml                                   │
│                                                                 │
│  build job:                                                     │
│    checkout ──► setup pnpm@8 ──► setup node@18 ──►              │
│    pnpm install ──► docs:build ──► upload artifact              │
│                                                                 │
│  deploy job:                                                    │
│    deploy-pages ──► https://chenweita.github.io/fe-spec/        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      npm 包发布（手动触发）                       │
│                                                                 │
│  lerna publish ──► 交互式选择版本 ──► 自动打 tag ──► npm publish│
└─────────────────────────────────────────────────────────────────┘
```

## 2. 本地开发校验体系

### 2.1 包管理器约束

项目强制使用 `pnpm`，根目录 `package.json` 中配置了：

```json
{
  "scripts": {
    "preinstall": "npx only-allow pnpm"
  }
}
```

如果使用 `npm install` 或 `yarn install`，会立即报错阻止安装，保证团队依赖一致性。

### 2.2 Git Hooks（Husky）

使用 [Husky](https://typicode.github.io/husky/) 在 git 生命周期中插入校验逻辑。

| Hook | 触发时机 | 作用 |
|------|---------|------|
| `pre-commit` | `git commit` 执行前 | 预留位置（可扩展：ESLint、stylelint 等） |
| `commit-msg` | 编写 commit message 后 | 通过 commitlint 校验提交信息格式 |

### 2.3 Commitlint 提交信息校验

使用 [commitlint](https://commitlint.js.org/) 校验提交信息，规则继承自项目内的 `packages/commitlint-config`。

提交信息格式遵循 **Conventional Commits** 规范：

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

支持的 type：

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式调整 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建系统或依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 其他杂项 |
| `revert` | 回滚 |

示例：

```bash
# 正确
git commit -m "fix: correct VuePress config link for lint doc"
git commit -m "ci: upgrade deploy workflow actions versions"

# 错误（会被 commit-msg hook 拦截）
git commit -m "update stuff"
```

### 2.4 常用本地命令

```bash
# 安装依赖
pnpm install

# 启动文档本地开发服务器
pnpm run docs:dev

# 构建文档静态文件
pnpm run docs:build

# 构建所有 packages
pnpm run build

# 运行所有 packages 测试
pnpm run test

# 生成 CHANGELOG
pnpm run changelog

# 清理 node_modules
pnpm run clean
```

## 3. GitHub Actions 自动化 CI/CD

### 3.1 Workflow 总览

文件位置：`.github/workflows/deploy.yml`

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 触发分支 | `main` | 推送到 main 分支时自动触发 |
| 手动触发 | `workflow_dispatch` | 支持在 Actions 页面手动重跑 |
| Runner | `ubuntu-latest` | Ubuntu 最新版 |
| Node 版本 | `18` | VuePress 1.x 兼容版本 |
| pnpm 版本 | `8` | 锁定版本保证一致性 |
| 部署目标 | GitHub Pages | 原生 Actions 部署 |
| 站点地址 | `https://chenweita.github.io/fe-spec/` | 与 `base: '/fe-spec/'` 匹配 |

### 3.2 并发控制

```yaml
concurrency:
  group: pages-deploy
  cancel-in-progress: false
```

同一时间只允许一个部署任务运行，避免并发推送导致冲突。已有任务运行时，新任务会排队等待，**不会取消正在运行的任务**。

### 3.3 权限配置

```yaml
permissions:
  contents: read    # 读取仓库代码
  pages: write      # 部署到 GitHub Pages
  id-token: write   # OIDC 令牌（deploy-pages 需要）
```

采用 GitHub 推荐的最小权限原则，不使用 `GITHUB_TOKEN` 的默认全权限。

### 3.4 Job 流程

#### build job

```
checkout ──► setup pnpm@8 ──► setup node@18 + pnpm cache ──►
pnpm run init (安装依赖) ──► pnpm run docs:build (构建 VuePress) ──►
configure-pages ──► upload-pages-artifact
```

关键环境变量：

```yaml
env:
  NODE_OPTIONS: '--max_old_space_size=4096'
```

为 Node 进程分配 4GB 堆内存，防止 VuePress 构建大型文档时 OOM。

#### deploy job

```
needs: build ──► deploy-pages
```

依赖 build job 成功后才执行，使用 `actions/deploy-pages@v4` 上传构建产物到 GitHub Pages。

### 3.5 依赖缓存

```yaml
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: 18
    cache: pnpm    # 自动缓存 pnpm store
```

`setup-node@v4` 的 `cache: pnpm` 会自动缓存 `~/.local/share/pnpm/store`，加速后续构建的依赖安装。

### 3.6 手动触发

在 GitHub 仓库页面操作：

```
Actions → Build and Deploy → Run workflow
```

可以选择分支（main）手动触发一次构建部署，用于调试或应急更新。

## 4. npm 包发布流程

### 4.1 Monorepo 结构

使用 [Lerna 6](https://lerna.js.org/) + pnpm Workspace 管理 6 个 npm 包：

```
packages/
├── commitlint-config/    # @buildloop/commitlint-config
├── eslint-config/         # @buildloop/eslint-config
├── eslint-plugin/         # @buildloop/eslint-plugin
├── lint/                  # @buildloop/lint (CLI 工具)
├── markdownlint-config/   # @buildloop/markdownlint-config
└── stylelint-config/      # @buildloop/stylelint-config
```

### 4.2 发布配置

`lerna.json` 中的关键配置：

```json
{
  "version": "2.0.7",
  "npmClient": "pnpm",
  "useWorkspaces": true,
  "command": {
    "publish": {
      "npmClient": "npm",
      "message": "chore(release): publish %s",
      "registry": "https://registry.npmjs.org"
    }
  }
}
```

| 配置 | 说明 |
|------|------|
| `npmClient: pnpm` | 日常安装依赖用 pnpm |
| `command.publish.npmClient: npm` | 发布时强制用 npm，避免 pnpm publish 的兼容性问题 |
| `useWorkspaces: true` | 与 pnpm-workspace.yaml 联动 |
| `publishConfig.access: public` | scoped 包默认公开访问（在 package.json 中配置） |

### 4.3 发布步骤

```bash
# 1. 确保 working tree 干净（Lerna 6 的硬约束）
git status

# 2. 确保已登录 npm
npm whoami
# 如果未登录：npm login

# 3. 确认当前版本，不能覆盖已发布版本
# 4. 执行交互式发布
pnpm run publish

# Lerna 会引导你：
#   - 选择版本号（patch/minor/major）
#   - 自动更新所有相关包的版本
#   - 自动生成 changelog
#   - 自动 commit "chore(release): publish vX.X.X"
#   - 自动打 tag vX.X.X
#   - 自动 npm publish
#   - 自动 push 到远端
```

### 4.4 发布注意事项

1. **Working tree 必须干净**：Lerna 6 要求发布前无未提交变更，否则报错
2. **版本不可覆盖**：已发布的版本（如 2.0.7）不能再次发布，必须递增版本号
3. **scoped 包公开**：`@buildloop/*` 包必须设置 `"access": "public"`，否则发布失败
4. **发布失败清理**：如果发布中途失败，可能残留 `packages/lint/` 等临时目录，需要手动清理

## 5. 配置文件速查

| 文件 | 作用 |
|------|------|
| `.github/workflows/deploy.yml` | GitHub Actions CI/CD 主配置 |
| `package.json` | 脚本入口、依赖、pnpm overrides |
| `lerna.json` | Monorepo 管理 + 发布配置 |
| `pnpm-workspace.yaml` | pnpm Workspace 包路径定义 |
| `.npmrc` | npm registry 源 |
| `.husky/commit-msg` | commitlint Git Hook |
| `commitlint.config.js` | commitlint 规则入口 |
| `deploy.sh` | 旧版手动部署脚本（已弃用） |
| `docs/.vuepress/config.ts` | VuePress 文档站点配置 |

## 6. 踩坑记录与最佳实践

### 6.1 VuePress 1.x 与 Node 版本

**问题**：VuePress 1.9.9 在 Node 20 上构建时报 `ERR_OSSL_EVP_UNSUPPORTED`（OpenSSL 3 不兼容）或 vue-router SSR 异常。

**解决**：CI 环境使用 **Node 18**，这是 VuePress 1.x 官方支持的最后一个 LTS 版本。

### 6.2 vue-router 版本锁定

**问题**：vue-router 3.6.5 在 SSR 渲染时报 `Cannot read properties of undefined (reading '_normalized')`。

**解决**：在 `package.json` 中使用 pnpm overrides 强制锁定 vue-router 到 3.5.4：

```json
{
  "pnpm": {
    "overrides": {
      "vue-router": "3.5.4"
    }
  }
}
```

### 6.3 YAML Frontmatter 特殊字符

**问题**：Markdown 文件 frontmatter 中 `title: @buildloop/lint` 会导致 YAML 解析失败，因为 `@` 是 YAML 锚点标记。

**解决**：所有包含特殊字符的 title 必须加引号：

```yaml
title: "@buildloop/lint"
```

### 6.4 相对链接有效性

**问题**：Markdown 中的相对链接 `./1.git.md` 指向不存在的文件，导致 VuePress 路由表损坏，后续页面 SSR 渲染崩溃。

**解决**：定期检查所有相对链接是否指向真实存在的文件，文件名变更时同步更新引用。

### 6.5 GitHub Pages Source 配置

**问题**：仓库 Pages 设置中 Source 选错（选了 `Deploy from a branch` 而 workflow 用的是原生 Actions 部署）。

**解决**：在仓库 Settings → Pages → Source 选择 **GitHub Actions**（不是 Deploy from a branch），否则 workflow 的 `deploy-pages` 无法生效。

### 6.6 GitHub Token

**问题**：早期 workflow 使用 `secrets.ACCESS_TOKEN`（需手动配置 PAT）。

**解决**：切换到 GitHub 原生的 `secrets.GITHUB_TOKEN`，由 Actions 自动注入，无需手动配置，权限范围最小化。

## 7. 未来优化建议

1. **增加 PR 阶段 CI**：在 Pull Request 到 main 时自动跑 `pnpm install` + `pnpm build` + `pnpm test`，提前发现构建问题
2. **增加 npm 包自动发布**：基于 conventional commits，实现打 tag 时自动触发 `lerna publish`，减少手动操作
3. **增加包大小检查**：对 eslint-plugin 等包的体积进行监控
4. **增加 changelog 自动生成**：CI 中基于 commit 自动更新 CHANGELOG.md
5. **升级 VuePress 2.x**：长期看应迁移到 VuePress 2 + Vite，获得更好的构建性能和 Node 版本兼容性

