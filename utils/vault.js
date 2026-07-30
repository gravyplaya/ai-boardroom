/**
 * vault.js — Obsidian Memory Vault Interface
 */

import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { env } from './env.js';
dotenv.config({ quiet: true });

const VAULT_PATH = path.resolve(env('OBSIDIAN_VAULT_PATH', './obsidian_vault'));

function safeJoin(relPath) {
  if (!relPath || typeof relPath !== 'string') throw new Error('Invalid vault path');
  if (relPath.includes('\0')) throw new Error('Invalid vault path');
  const full = path.resolve(VAULT_PATH, relPath);
  if (full !== VAULT_PATH && !full.startsWith(VAULT_PATH + path.sep)) {
    throw new Error('Path escapes vault');
  }
  return full;
}

export async function readVault(filePath) {
  const fullPath = safeJoin(filePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Vault file not found: ${filePath}`);
    }
    throw err;
  }
}

export async function writeVault(filePath, content) {
  const fullPath = safeJoin(filePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

export async function appendVault(filePath, content) {
  const fullPath = safeJoin(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.appendFile(fullPath, '\n' + content, 'utf-8');
}

export async function listVault(subDir = '') {
  const fullPath = subDir ? safeJoin(subDir) : VAULT_PATH;
  try {
    await fs.mkdir(fullPath, { recursive: true });
    const entries = await fs.readdir(fullPath, { withFileTypes: true, recursive: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => {
        const parent = e.parentPath || e.path || fullPath;
        return path.join(subDir, path.relative(fullPath, path.join(parent, e.name)));
      });
  } catch {
    return [];
  }
}

export async function logSystemEvent(agent, action, description) {
  try {
    const timestamp = new Date().toISOString();
    const entry = `\n[${timestamp}] [${String(agent).toUpperCase()}] [${action}] — ${description}`;
    await appendVault('00_system_logs.md', entry);
  } catch (err) {
    // Serverless / read-only FS: don't crash the request
    console.warn('[Vault] logSystemEvent failed:', err.message);
  }
}

export default { readVault, writeVault, appendVault, listVault, logSystemEvent };
