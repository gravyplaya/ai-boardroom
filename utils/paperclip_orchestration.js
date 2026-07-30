/**
 * Agent activity store — real in-process task tracking for the monitor UI.
 * Not an external Paperclip SaaS dependency; local boardroom orchestration log.
 */

const BOARD_AGENTS = {
  jarvis: { id: 'agent-jarvis', name: 'JARVIS', role: 'chief-of-staff', description: 'Chief of Staff' },
  architect: { id: 'agent-architect', name: 'Architect', role: 'ceo', description: 'CEO / Strategy' },
  coder: { id: 'agent-coder', name: 'Coder', role: 'cto', description: 'CTO / Engineering' },
  creative: { id: 'agent-creative', name: 'Creative', role: 'cmo', description: 'CMO / Design' },
  analyst: { id: 'agent-analyst', name: 'Analyst', role: 'cfo', description: 'CFO / Research' },
  product: { id: 'agent-product', name: 'Product', role: 'cpo', description: 'CPO / Roadmap' },
  devops: { id: 'agent-devops', name: 'DevOps', role: 'sre', description: 'SRE / Infrastructure' },
  security: { id: 'agent-security', name: 'Security', role: 'ciso', description: 'CISO / Hardening' },
  qa: { id: 'agent-qa', name: 'QA Lead', role: 'cqo', description: 'CQO / Testing' },
};

const tasks = new Map();
const MAX_TASKS = 200;

export function getAgent(role) {
  return BOARD_AGENTS[role] || BOARD_AGENTS.jarvis;
}

export function getAllAgents() {
  return Object.values(BOARD_AGENTS).map((a) => ({
    ...a,
    status: 'idle',
    activeTasks: [...tasks.values()].filter((t) => t.agentId === a.id && t.status === 'in_progress').length,
  }));
}

export function createTask(agentId, title, description) {
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    agentId,
    title,
    description,
    status: 'assigned',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    executionLog: [],
  };
  tasks.set(task.id, task);
  while (tasks.size > MAX_TASKS) {
    const oldest = tasks.keys().next().value;
    tasks.delete(oldest);
  }
  return task;
}

export function updateTaskStatus(taskOrId, status, message) {
  const task = typeof taskOrId === 'string' ? tasks.get(taskOrId) : taskOrId;
  if (!task) return null;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  task.executionLog.push({
    timestamp: new Date().toISOString(),
    status,
    message,
  });
  tasks.set(task.id, task);
  return task;
}

export async function orchestrateMessage({ message, sessionId = 'default', role = 'jarvis' }) {
  const agent = getAgent(role);
  const task = createTask(agent.id, `Chat: "${String(message).slice(0, 48)}…"`, message);
  updateTaskStatus(task, 'in_progress', `${agent.name} received directive`);
  return { task, agent, sessionId, timestamp: new Date().toISOString() };
}

export async function completeTask(taskId, summary = 'Completed') {
  return updateTaskStatus(taskId, 'done', summary);
}

export async function failTask(taskId, err = 'Failed') {
  return updateTaskStatus(taskId, 'failed', err);
}

export async function getTaskStatus(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return { taskId, status: 'unknown', message: 'Task not found' };
  }
  return {
    taskId: task.id,
    status: task.status,
    message: task.executionLog.at(-1)?.message || task.status,
    task,
  };
}

export function listTasks(limit = 50) {
  return [...tasks.values()]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit);
}

export default {
  getAgent,
  getAllAgents,
  createTask,
  updateTaskStatus,
  orchestrateMessage,
  getTaskStatus,
  completeTask,
  failTask,
  listTasks,
};
