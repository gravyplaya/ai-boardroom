/**
 * execution.js — Code Execution API (protected by requireAuth when key set)
 */

import { Router } from 'express';
import { executeJavaScript, executePython, executeShell, ExecutionContext } from '../utils/code_executor.js';
import { logSystemEvent } from '../utils/vault.js';

const router = Router();
const contexts = new Map();

const SHELL_ALLOW = [
  /^node\s+--version$/,
  /^npm\s+--version$/,
  /^python3?\s+--version$/,
  /^ls(\s+-[alA]+)?(\s+\.[\w./-]*)?$/,
  /^pwd$/,
  /^date$/,
  /^echo\s+[\w\s./_-]+$/,
  /^git\s+(status|log|branch|diff)(\s+.*)?$/,
];

function getContext(sessionId = 'default') {
  if (!contexts.has(sessionId)) {
    contexts.set(sessionId, new ExecutionContext(sessionId));
  }
  return contexts.get(sessionId);
}

function isShellAllowed(command) {
  const c = command.trim();
  if (/[;&|`$<>\\\n\r]/.test(c)) return false;
  return SHELL_ALLOW.some((re) => re.test(c));
}

router.post('/javascript', async (req, res) => {
  try {
    const { code, sessionId = 'default', timeout = 5000 } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code is required' });
    }
    if (code.length > 50_000) {
      return res.status(400).json({ error: 'Code too large' });
    }

    const context = getContext(sessionId);
    const result = await executeJavaScript(code, { timeout });
    context.recordExecution('javascript', code, result);
    try {
      await logSystemEvent('coder', 'CODE_EXECUTED', `JavaScript: ${result.success ? 'ok' : 'fail'} ${result.duration}ms`);
    } catch { /* ignore */ }

    res.json({
      success: result.success,
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      duration: result.duration,
      language: 'javascript',
    });
  } catch (err) {
    console.error('[EXECUTION ERROR]', err.message);
    res.status(500).json({ error: 'Execution failed', details: err.message });
  }
});

router.post('/python', async (req, res) => {
  try {
    const { code, sessionId = 'default', timeout = 5000 } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code is required' });
    }
    if (code.length > 50_000) {
      return res.status(400).json({ error: 'Code too large' });
    }

    const context = getContext(sessionId);
    const result = await executePython(code, { timeout });
    context.recordExecution('python', code, result);
    try {
      await logSystemEvent('coder', 'CODE_EXECUTED', `Python: ${result.success ? 'ok' : 'fail'} ${result.duration}ms`);
    } catch { /* ignore */ }

    res.json({
      success: result.success,
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      duration: result.duration,
      language: 'python',
    });
  } catch (err) {
    console.error('[EXECUTION ERROR]', err.message);
    res.status(500).json({ error: 'Execution failed', details: err.message });
  }
});

router.post('/shell', async (req, res) => {
  try {
    const { command, sessionId = 'default', timeout = 5000 } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'Command is required' });
    }

    if (!isShellAllowed(command)) {
      try {
        await logSystemEvent('security', 'COMMAND_BLOCKED', `Blocked shell: ${command.slice(0, 120)}`);
      } catch { /* ignore */ }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Command not on the allowlist. Only safe read-only diagnostics are permitted.',
      });
    }

    const context = getContext(sessionId);
    const result = await executeShell(command, { timeout });
    context.recordExecution('shell', command, result);
    try {
      await logSystemEvent('devops', 'COMMAND_EXECUTED', `Shell: ${result.success ? 'ok' : 'fail'} ${result.duration}ms`);
    } catch { /* ignore */ }

    res.json({
      success: result.success,
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      duration: result.duration,
      language: 'shell',
    });
  } catch (err) {
    console.error('[EXECUTION ERROR]', err.message);
    res.status(500).json({ error: 'Execution failed', details: err.message });
  }
});

router.get('/status', (req, res) => {
  const { sessionId = 'default' } = req.query;
  const context = getContext(sessionId);
  res.json({
    summary: context.getSummary(),
    recentExecutions: context.executions.slice(-10),
  });
});

export default router;
