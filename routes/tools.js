/**
 * tools.js — Sandboxed tool bridge for voice / agent actions.
 * Hardened: path jail + command allowlist (no open shell).
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execFileAsync = promisify(execFile);
const BASE_WORKSPACE = path.resolve(process.cwd());
const WRITE_ROOTS = [
  path.resolve(BASE_WORKSPACE, 'uploads'),
  path.resolve(BASE_WORKSPACE, 'obsidian_vault'),
  path.resolve(BASE_WORKSPACE, 'workspace_out'),
];


const ALLOWED_BINARIES = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'date',
  'node', 'npm', 'python3', 'python', 'git',
]);

function ensureInsideWorkspace(targetPath) {
  const resolvedBase = path.resolve(BASE_WORKSPACE);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Security Exception: Path escapes workspace');
  }
  const filename = path.basename(resolvedTarget);
  if (filename.startsWith('.env') || filename === '.git') {
    throw new Error(`Security Exception: Access to sensitive path blocked: ${filename}`);
  }
  return resolvedTarget;
}

function parseSafeCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command is required');
  }
  if (/[;&|`$<>\\\n\r]/.test(command)) {
    throw new Error('Security Exception: Shell metacharacters are not allowed');
  }
  const parts = command.trim().split(/\s+/);
  const bin = parts[0];
  if (!ALLOWED_BINARIES.has(bin)) {
    throw new Error(`Security Exception: Binary not allowlisted: ${bin}`);
  }
  // Keep args relative / non-absolute for file tools
  for (const arg of parts.slice(1)) {
    if (arg.startsWith('/') && !arg.startsWith(BASE_WORKSPACE)) {
      // allow absolute only if inside workspace
      if (!arg.startsWith(BASE_WORKSPACE)) {
        // still allow common safe flags like -la
        if (arg.startsWith('-')) continue;
        throw new Error('Security Exception: Absolute paths outside workspace blocked');
      }
    }
    if (arg.includes('..')) {
      throw new Error('Security Exception: Path traversal blocked');
    }
  }
  return parts;
}

router.post('/execute', async (req, res) => {
  const { name, args, callId } = req.body || {};

  if (!name || !args) {
    return res.status(400).json({ error: 'Missing name or args for tool execution' });
  }

  console.log(`[Tool Bridge] Executing tool: ${name}`);

  try {
    let result = null;

    if (name === 'execute_cli_command') {
      const parts = parseSafeCommand(args.command);
      const [bin, ...argv] = parts;
      const { stdout, stderr } = await execFileAsync(bin, argv, {
        cwd: BASE_WORKSPACE,
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
      });
      result = { stdout, stderr };
    } else if (name === 'read_file') {
      const { filePath } = args;
      const targetPath = ensureInsideWorkspace(path.resolve(BASE_WORKSPACE, filePath));
      const content = await fs.readFile(targetPath, 'utf-8');
      result = { content };
    } else if (name === 'write_file') {
      const { filePath, content } = args;
      if (!filePath || typeof filePath !== 'string') throw new Error('filePath must be a string');
      if (typeof content !== 'string') throw new Error('content must be a string');
      const targetPath = ensureInsideWorkspace(path.resolve(BASE_WORKSPACE, filePath));
      const allowedWrite = WRITE_ROOTS.some(
        (root) => targetPath === root || targetPath.startsWith(root + path.sep)
      );
      if (!allowedWrite) {
        throw new Error('Security Exception: Writes limited to uploads/, obsidian_vault/, workspace_out/');
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf-8');
      result = { success: true, message: `File written successfully at ${filePath}` };
    } else {
      throw new Error(`Unknown tool specified: ${name}`);
    }

    res.json({ name, id: callId, result });
  } catch (error) {
    console.error(`[Tool Bridge] Execution failed:`, error.message);
    res.status(500).json({ name, id: callId, error: error.message || 'Unknown execution error' });
  }
});

export default router;
