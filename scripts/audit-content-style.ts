import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { auditContentStyle, type ContentAuditMode, type ContentStyleDraft } from '../src/lib/content-style.ts';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const siteRoot = join(scriptDir, '..');
const defaultContentDir = join(siteRoot, 'src', 'content', 'drugs');

interface FileAudit {
  file: string;
  slug?: string;
  ok: boolean;
  issueCount: number;
  issues: ReturnType<typeof auditContentStyle>['issues'];
  parseError?: string;
}

function listMarkdown(path: string): string[] {
  if (!existsSync(path)) return [];
  const stats = statSync(path);
  if (stats.isFile()) return path.toLowerCase().endsWith('.md') ? [path] : [];
  if (!stats.isDirectory()) return [];

  return readdirSync(path)
    .flatMap((name) => listMarkdown(join(path, name)))
    .sort();
}

function displayPath(path: string): string {
  return relative(siteRoot, path).split(sep).join('/');
}

function auditFile(file: string, mode: ContentAuditMode): FileAudit {
  try {
    const parsed = matter(readFileSync(file, 'utf8'));
    const data = parsed.data as Record<string, unknown>;
    const mechanism = data.mechanism && typeof data.mechanism === 'object'
      ? data.mechanism as Record<string, unknown>
      : {};
    const draft: ContentStyleDraft = {
      summary: data.summary,
      target: data.target,
      analogy: mechanism.analogy,
      simple: mechanism.simple,
    };
    const audit = auditContentStyle(draft, { mode });
    return {
      file: displayPath(file),
      ...(typeof data.slug === 'string' ? { slug: data.slug } : {}),
      ok: audit.ok,
      issueCount: audit.issues.length,
      issues: audit.issues,
    };
  } catch (error) {
    return {
      file: displayPath(file),
      ok: false,
      issueCount: 1,
      issues: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

const args = process.argv.slice(2);
const mode: ContentAuditMode = args.includes('--strict') ? 'strict' : 'legacy';
const requested = args.filter((arg) => !arg.startsWith('--'));
const roots = requested.length > 0
  ? requested.map((path) => isAbsolute(path) ? path : resolve(siteRoot, path))
  : [defaultContentDir];
const missing = roots.filter((path) => !existsSync(path));
const files = [...new Set(roots.flatMap(listMarkdown))];
const audits = files.map((file) => auditFile(file, mode));
const issueCount = audits.reduce((sum, audit) => sum + audit.issueCount, 0);
const blockingIssueCount = audits.reduce(
  (sum, audit) => sum + audit.issues.filter((issue) => issue.blocking).length + (audit.parseError ? 1 : 0),
  0,
);

const output = {
  schemaVersion: 1,
  mode,
  policy: mode === 'legacy' ? 'report-only' : 'strict-blocking',
  scannedFiles: files.length,
  issueCount,
  blockingIssueCount,
  ok: missing.length === 0 && blockingIssueCount === 0,
  missingPaths: missing.map((path) => isAbsolute(path) ? path : displayPath(path)),
  files: audits,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (mode === 'strict' && !output.ok) process.exitCode = 1;
if (missing.length > 0) process.exitCode = 2;
