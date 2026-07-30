/**
 * Vercel serverless entry — re-exports the Express app.
 * All /api/* (and uploads when rewritten) hit this handler.
 */
export { default } from '../server.js';
