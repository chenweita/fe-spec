import path from 'node:path';
import ejs from 'ejs';
import _ from 'lodash';
import type * as fsPromises from 'node:fs/promises';
import {
  ESLINT_IGNORE_PATTERN,
  STYLELINT_FILE_EXT,
  STYLELINT_IGNORE_PATTERN,
  MARKDOWN_LINT_IGNORE_PATTERN,
} from './utils/constants';

export interface GenerateOpt {
  framework: 'react' | 'vue' | 'vanilla';
  lang: 'typescript' | 'javascript';
}

type FsLike = typeof fsPromises;

/**
 * framework + lang -> 内部 eslintType
 *   react   + javascript -> react
 *   react   + typescript -> typescript/react
 *   vue     + javascript -> vue
 *   vue     + typescript -> typescript/vue
 *   vanilla + javascript -> index
 *   vanilla + typescript -> typescript
 */
const mapEslintType = (framework: GenerateOpt['framework'], lang: GenerateOpt['lang']): string => {
  const isTs = lang === 'typescript';
  switch (framework) {
    case 'react':
      return isTs ? 'typescript/react' : 'react';
    case 'vue':
      return isTs ? 'typescript/vue' : 'vue';
    case 'vanilla':
    default:
      return isTs ? 'typescript' : 'index';
  }
};

/**
 * 递归读取模板目录下所有 .ejs 文件
 * 返回 [{ name: 相对路径, content: 文件内容 }]
 */
const readTemplateFiles = async (
  fs: FsLike,
  dir: string,
  base = '',
): Promise<Array<{ name: string; content: string }>> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: Array<{ name: string; content: string }> = [];
  for (const entry of entries) {
    // 兼容 node:fs/promises 的 Dirent（withFileTypes）
    const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (isDir) {
      result.push(...(await readTemplateFiles(fs, fullPath, relativePath)));
    } else if (entry.name.endsWith('.ejs')) {
      const content = await fs.readFile(fullPath, 'utf8');
      result.push({ name: relativePath, content });
    }
  }
  return result;
};

/**
 * 合并 vscode 配置（已存在则深合并，数组去重）
 */
const mergeVSCodeConfig = async (fs: FsLike, filepath: string, content: string): Promise<string> => {
  let existing: string;
  try {
    existing = await fs.readFile(filepath, 'utf8');
  } catch {
    // 文件不存在，直接用渲染内容
    return content;
  }
  try {
    const targetData = JSON.parse(existing);
    const sourceData = JSON.parse(content);
    return JSON.stringify(
      _.mergeWith(targetData, sourceData, (target, source) => {
        if (Array.isArray(target) && Array.isArray(source)) {
          return [...new Set(source.concat(target))];
        }
        return undefined;
      }),
      null,
      2,
    );
  } catch {
    return '';
  }
};

/**
 * 核心生成逻辑
 * customFs：可选，传入 memfs 等虚拟 fs；不传使用系统真实磁盘 fs（node:fs/promises）
 * 注意：本文件内禁止直接 import node:fs，所有文件操作均通过入参 fs 实例
 */
export async function generateScaffold(opt: GenerateOpt, customFs?: FsLike): Promise<void> {
  const fs = customFs ?? (await import('node:fs/promises'));
  const eslintType = mapEslintType(opt.framework, opt.lang);

  // ejs 渲染数据
  const data = {
    eslintType,
    eslintIgnores: ESLINT_IGNORE_PATTERN,
    stylelintExt: STYLELINT_FILE_EXT,
    stylelintIgnores: STYLELINT_IGNORE_PATTERN,
    markdownLintIgnores: MARKDOWN_LINT_IGNORE_PATTERN,
    enableESLint: true,
    enableStylelint: true,
    enableMarkdownlint: true,
    enablePrettier: true,
  };

  // 模板目录（打包后位于 lib/config，源码位于 src/config）
  const templatePath = path.resolve(__dirname, './config');
  const templates = await readTemplateFiles(fs, templatePath);

  for (const { name, content: templateContent } of templates) {
    // 转换输出路径：a/b/c.ejs -> a/b/c，开头 _ -> .
    const outputPath = name.replace(/\.ejs$/, '').replace(/^_/, '.');

    let content = ejs.render(templateContent, data);

    // vscode 配置走合并逻辑
    if (name.startsWith('_vscode/') || name.startsWith('_vscode\\')) {
      content = await mergeVSCodeConfig(fs, outputPath, content);
    }

    // 跳过空文件
    if (!content.trim()) continue;

    // 确保父目录存在
    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(outputPath, content, 'utf8');
  }
}

// ============ memfs 内存生成模式 ============

/**
 * 文件树节点（供工作台前端渲染文件树）
 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileTreeNode[];
}

/**
 * 从扁平 { 相对路径: 内容 } 构建文件树
 */
const buildFileTree = (files: Record<string, string>): FileTreeNode[] => {
  const root: FileTreeNode = { name: '', path: '', type: 'dir', children: [] };
  const sortedPaths = Object.keys(files).sort();
  for (const filePath of sortedPaths) {
    const parts = filePath.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');
      let child = current.children!.find((c) => c.name === part);
      if (!child) {
        child = isLast
          ? {
              name: part,
              path: fullPath,
              type: 'file',
              size: Buffer.byteLength(files[filePath] ?? '', 'utf8'),
            }
          : { name: part, path: fullPath, type: 'dir', children: [] };
        current.children!.push(child);
      }
      current = child;
    }
  }
  return root.children!;
};

/**
 * 内存生成模式（工程化推荐）
 *
 * 使用 memfs 虚拟文件系统，不触碰真实磁盘：
 *   1. 用真实 fs 读取 lint 包自带的 ejs 模板（动态 import，非静态依赖）
 *   2. 挂载到 memfs，调用核心 generateScaffold 写入 memfs
 *   3. 从 memfs 提取生成的文件，构建文件树返回
 *
 * 适合：工作台后端调用 → 返回文件树给前端预览 / 打包 zip 下载
 * 与 scanText/fixText 完全独立，互不干扰
 */
export async function generateScaffoldToMemory(
  opt: GenerateOpt,
): Promise<{ files: Record<string, string>; tree: FileTreeNode[] }> {
  // 动态引入，避免在模块顶层静态依赖 node:fs
  const { vol } = await import('memfs');
  const realFs = await import('node:fs/promises');

  const templatePath = path.resolve(__dirname, './config');
  // 读取真实模板（lint 包自带）
  const templates = await readTemplateFiles(realFs, templatePath);

  // 挂载模板到 memfs 的绝对路径，使 generateScaffold 内部能按 __dirname 解析到
  const json: Record<string, string> = {};
  for (const { name, content } of templates) {
    json[path.join(templatePath, name)] = content;
  }
  vol.fromJSON(json, '/');

  try {
    // 核心生成逻辑统一走 generateScaffold，写入 memfs
    await generateScaffold(opt, vol.promises as unknown as FsLike);

    // 提取生成的文件（排除模板源文件）
    // 注意：memfs 会把相对路径按 process.cwd() 解析，需去掉该前缀
    const allFiles = vol.toJSON() as Record<string, string | null>;
    const files: Record<string, string> = {};
    const normalize = (p: string) => p.replace(/^\/+/, '');
    const templatePrefix = normalize(templatePath);
    const cwdPrefix = normalize(process.cwd());
    for (const [p, content] of Object.entries(allFiles)) {
      if (content == null) continue;
      let rel = normalize(p);
      // 跳过模板目录
      if (rel.startsWith(templatePrefix)) continue;
      // 去掉 process.cwd() 前缀（memfs 相对路径解析行为）
      if (cwdPrefix && rel.startsWith(cwdPrefix)) {
        rel = rel.slice(cwdPrefix.length).replace(/^\/+/, '');
      }
      if (!rel) continue;
      files[rel] = content;
    }

    const tree = buildFileTree(files);
    return { files, tree };
  } finally {
    // 清理 memfs，避免实例污染
    vol.reset();
  }
}
