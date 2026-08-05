/**
 * textLint - 内存文本模式的代码检测与修复 API
 *
 * 对外暴露 scanText() 和 fixText()，复用 @buildloop/*-config 系列配置，
 * 所有 lint 逻辑在内存中完成，不写入磁盘。
 */

import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import markdownlint from 'markdownlint';
import markdownlintRuleHelpers from 'markdownlint-rule-helpers';
import prettier from 'prettier';
import path from 'path';

/** 支持的文件类型 */
export type FileType = 'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'css' | 'scss' | 'less' | 'md';

/** 单条 lint 消息 */
export interface LintMessage {
  line: number;
  column: number;
  rule: string;
  url: string;
  message: string;
  severity: 'error' | 'warning';
  fixable: boolean;
}

/** 单个文件的 lint 结果 */
export interface LintResult {
  errorCount: number;
  warningCount: number;
  messages: LintMessage[];
}

/** scanText / fixText 返回结构 */
export interface TextLintResponse {
  results: LintResult[];
  fixedCode?: string;
  runErrors: string[];
}

/** 可选参数 */
export interface TextLintOptions {
  /** 仅报告错误（忽略 warning） */
  quiet?: boolean;
}

// ============ fileType → ESLint config 路径映射 ============

/** 根据 fileType 选择 @buildloop/eslint-config 的子路径 */
function getESLintConfigPath(fileType: FileType): string {
  const map: Record<string, string> = {
    js: '@buildloop/eslint-config',
    jsx: '@buildloop/eslint-config/react',
    ts: '@buildloop/eslint-config/typescript/index',
    tsx: '@buildloop/eslint-config/typescript/react',
    vue: '@buildloop/eslint-config/vue',
  };
  return map[fileType] || '@buildloop/eslint-config';
}

/** 根据 fileType 获取文件扩展名 */
function getExtByType(fileType: FileType): string {
  const map: Record<FileType, string> = {
    js: '.js',
    jsx: '.jsx',
    ts: '.ts',
    tsx: '.tsx',
    vue: '.vue',
    css: '.css',
    scss: '.scss',
    less: '.less',
    md: '.md',
  };
  return map[fileType];
}

/** 判断语言分类 */
type LangCategory = 'eslint' | 'stylelint' | 'markdown';

function getLangCategory(fileType: FileType): LangCategory {
  if (['js', 'jsx', 'ts', 'tsx', 'vue'].includes(fileType)) return 'eslint';
  if (['css', 'scss', 'less'].includes(fileType)) return 'stylelint';
  if (fileType === 'md') return 'markdown';
  return 'eslint';
}

// ============ ESLint 内存模式 ============

async function runESLint(
  code: string,
  fileType: FileType,
  fix: boolean,
  quiet: boolean,
): Promise<{ results: LintResult[]; fixedCode?: string }> {
  const configPath = getESLintConfigPath(fileType);
  const eslintConfig = require(configPath);

  // 构造 ESLint 选项，复用 @buildloop/eslint-config 的完整规则集
  const eslintOptions: ESLint.Options = {
    useEslintrc: false,
    fix,
    errorOnUnmatchedPattern: false,
    cwd: process.cwd(),
    baseConfig: {
      ...eslintConfig,
      // 不设置 root，允许 extends 链正常解析
    },
  };

  const eslint = new ESLint(eslintOptions);

  const fakeFilePath = path.join(process.cwd(), `__buildloop_textlint__${getExtByType(fileType)}`);
  const reports = await eslint.lintText(code, { filePath: fakeFilePath });

  // 格式化消息
  const rulesMeta = eslint.getRulesMetaForResults(reports);
  const results: LintResult[] = [];
  let fixedCode: string | undefined;

  for (const report of reports) {
    const messages = report.messages
      .filter((m) => (quiet ? m.severity === 2 : true))
      .map((m) => ({
        line: m.line || 0,
        column: m.column || 0,
        rule: m.ruleId || 'unknown',
        url: rulesMeta[m.ruleId]?.docs?.url || '',
        message: m.message.replace(/([^ ])\.$/u, '$1'),
        severity: m.fatal || m.severity === 2 ? 'error' as const : 'warning' as const,
        fixable: !!m.fix,
      }));

    const errorCount = quiet ? 0 : report.errorCount;
    const warningCount = quiet ? 0 : report.warningCount;

    if (errorCount > 0 || warningCount > 0 || fix) {
      results.push({ errorCount, warningCount, messages });
    }
  }

  // 修复：ESLint fix:true 时结果自带 output
  if (fix) {
    const hasOutput = reports.some((r) => r.output !== undefined);
    if (hasOutput) {
      fixedCode = reports.map((r) => r.output ?? r.source).join('\n');
    } else {
      fixedCode = code;
    }
  }

  return { results, fixedCode };
}

// ============ Stylelint 内存模式 ============

async function runStylelint(
  code: string,
  fileType: FileType,
  fix: boolean,
  quiet: boolean,
): Promise<{ results: LintResult[]; fixedCode?: string }> {
  // 直接复用 @buildloop/stylelint-config 配置
  const stylelintConfig = require('@buildloop/stylelint-config');
  const ext = getExtByType(fileType);
  const customSyntax = fileType === 'scss' ? 'postcss-scss' : fileType === 'less' ? 'postcss-less' : undefined;

  const data = await stylelint.lint({
    code,
    codeFilename: `__buildloop_textlint__${ext}`,
    config: {
      ...stylelintConfig,
      // 允许通过 quiet 过滤 warning
      defaultSeverity: quiet ? 'error' : stylelintConfig.defaultSeverity,
    },
    fix,
    quiet,
    customSyntax,
  });

  const results: LintResult[] = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const r of data.results) {
    const messages = r.warnings.map((w) => {
      if (w.severity === 'error') errorCount++;
      else warningCount++;
      return {
        line: w.line,
        column: w.column,
        rule: w.rule,
        url: `https://stylelint.io/user-guide/rules/${w.rule}`,
        message: w.text.replace(/^\S+\s+/, '').replace(/\.$/, ''),
        severity: w.severity === 'error' ? 'error' as const : 'warning' as const,
        fixable: false,
      };
    });

    if (messages.length > 0 || fix) {
      results.push({
        errorCount: quiet ? 0 : errorCount,
        warningCount: quiet ? 0 : warningCount,
        messages,
      });
    }
  }

  return { results, fixedCode: fix ? data.output : undefined };
}

// ============ Markdownlint 内存模式 ============

async function runMarkdownlint(
  code: string,
  fileType: FileType,
  fix: boolean,
  quiet: boolean,
): Promise<{ results: LintResult[]; fixedCode?: string }> {
  // 复用 @buildloop/markdownlint-config 配置
  const mdConfig = require('@buildloop/markdownlint-config');
  const fileName = `__buildloop_textlint__${getExtByType(fileType)}`;

  const lintResults = markdownlint.sync({
    strings: { [fileName]: code },
    config: mdConfig,
  });

  const results: LintResult[] = [];
  let warningCount = 0;
  let fixableWarningCount = 0;

  for (const [, issues] of Object.entries(lintResults) as [string, Array<{ lineNumber: number; ruleNames: string[]; ruleDescription: string; ruleInformation?: string; fixInfo?: any }>][]) {
    const messages = issues.map((issue) => {
      if (issue.fixInfo) fixableWarningCount++;
      warningCount++;
      return {
        line: issue.lineNumber,
        column: 0,
        rule: issue.ruleNames[0],
        url: issue.ruleInformation || '',
        message: issue.ruleDescription,
        severity: 'warning' as const,
        fixable: !!issue.fixInfo,
      };
    });

    if (messages.length > 0 || fix) {
      results.push({
        errorCount: 0,
        warningCount: quiet ? 0 : warningCount,
        messages,
      });
    }
  }

  // 自动修复
  let fixedCode: string | undefined;
  if (fix) {
    fixedCode = code;
    for (const issues of Object.values(lintResults)) {
      const fixes = issues.filter((issue: any) => issue.fixInfo);
      if (fixes.length > 0) {
        fixedCode = markdownlintRuleHelpers.applyFixes(fixedCode!, fixes);
      }
    }
  }

  return { results, fixedCode };
}

// ============ Prettier 格式化 ============

function runPrettier(code: string, fileType: FileType): string | undefined {
  const prettierParserMap: Record<FileType, string> = {
    js: 'babel',
    jsx: 'babel',
    ts: 'typescript',
    tsx: 'typescript',
    vue: 'vue',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
  };

  const parser = prettierParserMap[fileType];
  if (!parser) return undefined;

  try {
    // 复用项目中的 prettier 配置（如果存在），否则使用默认配置
    const filePath = path.join(process.cwd(), `__buildloop_textlint__${getExtByType(fileType)}`);
    const options = prettier.resolveConfig.sync(filePath) || {};
    return prettier.format(code, { ...options, parser, filepath });
  } catch {
    // prettier 格式化失败不影响主流程
    return undefined;
  }
}

// ============ 公共入口 ============

/**
 * 扫描代码文本（只检测，不修改）
 * @param code 源代码文本
 * @param fileType 文件类型：'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'css' | 'scss' | 'less' | 'md'
 * @param options 可选配置
 */
export async function scanText(
  code: string,
  fileType: FileType,
  options: TextLintOptions = {},
): Promise<TextLintResponse> {
  const { quiet = false } = options;
  const runErrors: string[] = [];
  const langCategory = getLangCategory(fileType);

  try {
    if (langCategory === 'eslint') {
      const { results } = await runESLint(code, fileType, false, quiet);
      return { results, runErrors };
    }

    if (langCategory === 'stylelint') {
      const { results } = await runStylelint(code, fileType, false, quiet);
      return { results, runErrors };
    }

    if (langCategory === 'markdown') {
      const { results } = await runMarkdownlint(code, fileType, false, quiet);
      return { results, runErrors };
    }
  } catch (e) {
    runErrors.push(e instanceof Error ? e.message : String(e));
  }

  return { results: [], runErrors };
}

/**
 * 扫描并修复代码文本
 * @param code 源代码文本
 * @param fileType 文件类型：'js' | 'jsx' | 'ts' | 'tsx' | 'vue' | 'css' | 'scss' | 'less' | 'md'
 * @param options 可选配置
 */
export async function fixText(
  code: string,
  fileType: FileType,
  options: TextLintOptions = {},
): Promise<TextLintResponse> {
  const { quiet = false } = options;
  const runErrors: string[] = [];
  const langCategory = getLangCategory(fileType);
  let lintResults: LintResult[] = [];
  let fixedCode: string | undefined;

  try {
    if (langCategory === 'eslint') {
      const r = await runESLint(code, fileType, true, quiet);
      lintResults = r.results;
      fixedCode = r.fixedCode;
    } else if (langCategory === 'stylelint') {
      const r = await runStylelint(code, fileType, true, quiet);
      lintResults = r.results;
      fixedCode = r.fixedCode;
    } else if (langCategory === 'markdown') {
      const r = await runMarkdownlint(code, fileType, true, quiet);
      lintResults = r.results;
      fixedCode = r.fixedCode;
    }
  } catch (e) {
    runErrors.push(e instanceof Error ? e.message : String(e));
  }

  // Prettier 格式化（所有类型均尝试）
  const prettierFormatted = runPrettier(fixedCode ?? code, fileType);
  if (prettierFormatted !== undefined) {
    fixedCode = prettierFormatted;
    if (lintResults.length === 0) {
      lintResults.push({ errorCount: 0, warningCount: 0, messages: [] });
    }
  }

  return { results: lintResults, fixedCode, runErrors };
}