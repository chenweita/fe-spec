import path from 'path';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import spawn from 'cross-spawn';
import update from './update';
import npmType from '../utils/npm-type';
import log from '../utils/log';
import conflictResolve from '../utils/conflict-resolve';
import generateTemplate from '../utils/generate-template';
import { PROJECT_TYPES, PKG_NAME } from '../utils/constants';
import type { InitOptions, PKG } from '../types';

let step = 0;

/**
 * 将 framework + lang 组合映射为内部的 eslintType
 * 映射规则参考 PROJECT_TYPES：
 *   react   + javascript -> react
 *   react   + typescript -> typescript/react
 *   vue     + javascript -> vue
 *   vue     + typescript -> typescript/vue
 *   rax     + javascript -> rax
 *   rax     + typescript -> typescript/rax
 *   node    + javascript -> node
 *   node    + typescript -> typescript/node
 *   vanilla + javascript -> index
 *   vanilla + typescript -> typescript
 *   es5（不区分语言）     -> es5
 */
const mapEslintType = (
  framework?: 'react' | 'vue' | 'rax' | 'node' | 'vanilla' | 'es5',
  lang?: 'typescript' | 'javascript',
): string | undefined => {
  if (!framework) return undefined;
  // es5 不区分语言
  if (framework === 'es5') return 'es5';
  if (!lang) return undefined;
  const isTs = lang === 'typescript';
  switch (framework) {
    case 'react':
      return isTs ? 'typescript/react' : 'react';
    case 'vue':
      return isTs ? 'typescript/vue' : 'vue';
    case 'rax':
      return isTs ? 'typescript/rax' : 'rax';
    case 'node':
      return isTs ? 'typescript/node' : 'node';
    case 'vanilla':
    default:
      return isTs ? 'typescript' : 'index';
  }
};

/**
 * 选择项目语言和框架
 */
const chooseEslintType = async (): Promise<string> => {
  const { type } = await inquirer.prompt({
    type: 'list',
    name: 'type',
    message: `Step ${++step}. 请选择项目的语言（JS/TS）和框架（React/Vue）类型：`,
    choices: PROJECT_TYPES,
  });

  return type;
};

/**
 * 选择是否启用 stylelint
 * @param defaultValue
 */
const chooseEnableStylelint = async (defaultValue: boolean): Promise<boolean> => {
  const { enable } = await inquirer.prompt({
    type: 'confirm',
    name: 'enable',
    message: `Step ${++step}. 是否需要使用 stylelint（若没有样式文件则不需要）：`,
    default: defaultValue,
  });

  return enable;
};

/**
 * 选择是否启用 markdownlint
 */
const chooseEnableMarkdownLint = async (): Promise<boolean> => {
  const { enable } = await inquirer.prompt({
    type: 'confirm',
    name: 'enable',
    message: `Step ${++step}. 是否需要使用 markdownlint（若没有 Markdown 文件则不需要）：`,
    default: true,
  });

  return enable;
};

/**
 * 选择是否启用 prettier
 */
const chooseEnablePrettier = async (): Promise<boolean> => {
  const { enable } = await inquirer.prompt({
    type: 'confirm',
    name: 'enable',
    message: `Step ${++step}. 是否需要使用 Prettier 格式化代码：`,
    default: true,
  });

  return enable;
};

export default async (options: InitOptions) => {
  const cwd = options.cwd || process.cwd();
  const isTest = process.env.NODE_ENV === 'test';
  const checkVersionUpdate = options.checkVersionUpdate || false;
  const disableNpmInstall = options.disableNpmInstall || false;
  // --yes：跳过交互式提问，未显式传入的选项使用默认值
  const yes = options.yes === true;
  const config: Record<string, any> = {};
  const pkgPath = path.resolve(cwd, 'package.json');
  let pkg: PKG = fs.readJSONSync(pkgPath);

  // 版本检查
  if (!isTest && checkVersionUpdate) {
    await update(false);
  }

  // 优先把 framework + lang 映射成 eslintType（CLI 传参场景）
  if (!options.eslintType) {
    const mappedType = mapEslintType(options.framework, options.lang);
    if (mappedType) options.eslintType = mappedType;
  }

  // 初始化 `enableESLint`，默认为 true，无需让用户选择
  if (typeof options.enableESLint === 'boolean') {
    config.enableESLint = options.enableESLint;
  } else {
    config.enableESLint = true;
  }

  // 初始化 `eslintType`
  if (options.eslintType && PROJECT_TYPES.find((choice) => choice.value === options.eslintType)) {
    config.eslintType = options.eslintType;
  } else if (yes) {
    // 跳过交互，使用默认值
    config.eslintType = 'index';
  } else {
    config.eslintType = await chooseEslintType();
  }

  // 初始化 `enableStylelint`
  if (typeof options.enableStylelint === 'boolean') {
    config.enableStylelint = options.enableStylelint;
  } else if (yes) {
    config.enableStylelint = !/node/.test(config.eslintType);
  } else {
    config.enableStylelint = await chooseEnableStylelint(!/node/.test(config.eslintType));
  }

  // 初始化 `enableMarkdownlint`
  if (typeof options.enableMarkdownlint === 'boolean') {
    config.enableMarkdownlint = options.enableMarkdownlint;
  } else if (yes) {
    config.enableMarkdownlint = true;
  } else {
    config.enableMarkdownlint = await chooseEnableMarkdownLint();
  }

  // 初始化 `enablePrettier`
  if (typeof options.enablePrettier === 'boolean') {
    config.enablePrettier = options.enablePrettier;
  } else if (yes) {
    config.enablePrettier = true;
  } else {
    config.enablePrettier = await chooseEnablePrettier();
  }

  if (!isTest) {
    log.info(`Step ${++step}. 检查并处理项目中可能存在的依赖和配置冲突`);
    pkg = await conflictResolve(cwd, options.rewriteConfig);
    log.success(`Step ${step}. 已完成项目依赖和配置冲突检查处理 :D`);

    if (!disableNpmInstall) {
      log.info(`Step ${++step}. 安装依赖`);
      const npm = await npmType;
      spawn.sync(npm, ['i', '-D', PKG_NAME], { stdio: 'inherit', cwd });
      log.success(`Step ${step}. 安装依赖成功 :D`);
    }
  }

  // 更新 pkg.json
  pkg = fs.readJSONSync(pkgPath);
  // 在 `package.json` 中写入 `scripts`
  if (!pkg.scripts) {
    pkg.scripts = {};
  }
  if (!pkg.scripts[`${PKG_NAME}-scan`]) {
    pkg.scripts[`${PKG_NAME}-scan`] = `${PKG_NAME} scan`;
  }
  if (!pkg.scripts[`${PKG_NAME}-fix`]) {
    pkg.scripts[`${PKG_NAME}-fix`] = `${PKG_NAME} fix`;
  }

  // 配置 commit 卡点
  log.info(`Step ${++step}. 配置 git commit 卡点`);
  if (!pkg.husky) pkg.husky = {};
  if (!pkg.husky.hooks) pkg.husky.hooks = {};
  pkg.husky.hooks['pre-commit'] = `${PKG_NAME} commit-file-scan`;
  pkg.husky.hooks['commit-msg'] = `${PKG_NAME} commit-msg-scan`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  log.success(`Step ${step}. 配置 git commit 卡点成功 :D`);

  log.info(`Step ${++step}. 写入配置文件`);
  generateTemplate(cwd, config);
  log.success(`Step ${step}. 写入配置文件成功 :D`);

  // 完成信息
  const logs = [`${PKG_NAME} 初始化完成 :D`].join('\r\n');
  log.success(logs);
};
