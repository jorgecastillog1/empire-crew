import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

const BASE_DIR = process.env.FILES_BASE_DIR || path.join(process.cwd(), 'empire-files');

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

function safePath(relativePath: string): string {
  const resolved = path.resolve(BASE_DIR, relativePath);
  if (!resolved.startsWith(BASE_DIR)) throw new Error('Ruta no permitida fuera del directorio base');
  return resolved;
}

export async function writeFile(relativePath: string, content: string | Buffer): Promise<void> {
  const fullPath = safePath(relativePath);
  ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
}

export async function readFile(relativePath: string): Promise<string> {
  const fullPath = safePath(relativePath);
  return await fs.readFile(fullPath, 'utf-8');
}

export async function readFileBinary(relativePath: string): Promise<Buffer> {
  const fullPath = safePath(relativePath);
  return await fs.readFile(fullPath);
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = safePath(relativePath);
  await fs.unlink(fullPath);
}

export async function fileExists(relativePath: string): Promise<boolean> {
  const fullPath = safePath(relativePath);
  try { await fs.access(fullPath); return true; } catch { return false; }
}

export async function listFiles(relativePath: string = ''): Promise<string[]> {
  const fullPath = safePath(relativePath);
  ensureDir(fullPath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name));
}

export async function moveFile(fromPath: string, toPath: string): Promise<void> {
  const from = safePath(fromPath);
  const to = safePath(toPath);
  ensureDir(path.dirname(to));
  await fs.rename(from, to);
}

export async function copyFile(fromPath: string, toPath: string): Promise<void> {
  const from = safePath(fromPath);
  const to = safePath(toPath);
  ensureDir(path.dirname(to));
  await fs.copyFile(from, to);
}

export async function writeJSON(relativePath: string, data: any): Promise<void> {
  await writeFile(relativePath, JSON.stringify(data, null, 2));
}

export async function readJSON<T = any>(relativePath: string): Promise<T> {
  const content = await readFile(relativePath);
  return JSON.parse(content) as T;
}

export async function appendFile(relativePath: string, content: string): Promise<void> {
  const fullPath = safePath(relativePath);
  ensureDir(path.dirname(fullPath));
  await fs.appendFile(fullPath, content, 'utf-8');
}

export async function getFileStats(relativePath: string): Promise<{
  size: number; created: Date; modified: Date; isDirectory: boolean;
}> {
  const fullPath = safePath(relativePath);
  const stats = await fs.stat(fullPath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    isDirectory: stats.isDirectory(),
  };
}

export async function createDirectory(relativePath: string): Promise<void> {
  const fullPath = safePath(relativePath);
  await fs.mkdir(fullPath, { recursive: true });
}

export async function cleanDirectory(relativePath: string): Promise<void> {
  const fullPath = safePath(relativePath);
  if (existsSync(fullPath)) {
    await fs.rm(fullPath, { recursive: true, force: true });
    await fs.mkdir(fullPath, { recursive: true });
  }
}

export async function saveAgentOutput(agentId: string, companyId: string, filename: string, content: string): Promise<string> {
  const relativePath = `companies/${companyId}/agents/${agentId}/${filename}`;
  await writeFile(relativePath, content);
  return relativePath;
}

export async function saveVideoMetadata(companyId: string, videoId: string, metadata: any): Promise<void> {
  await writeJSON(`companies/${companyId}/videos/${videoId}/metadata.json`, metadata);
}

export async function saveReport(companyId: string, reportName: string, content: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relativePath = `companies/${companyId}/reports/${timestamp}-${reportName}.txt`;
  await writeFile(relativePath, content);
  return relativePath;
}

export async function listAgentOutputs(agentId: string, companyId: string): Promise<string[]> {
  return await listFiles(`companies/${companyId}/agents/${agentId}`);
}

export { BASE_DIR };
