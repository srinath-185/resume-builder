/**
 * Loaded by mocha before any spec (see .mocharc.json). Gives every test a
 * deterministic environment: in-process queue, no crons, quiet logs, fixed keys.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.QUEUE_DRIVER = 'inline';
process.env.RUN_SCHEDULED_JOBS = 'false';
process.env.JWT_SECRET = 'test-jwt-secret-with-enough-length-for-hs256';
process.env.ENCRYPTION_KEY = '0f'.repeat(32);
process.env.CORS_ORIGIN = 'http://localhost:5300';
process.env.REGISTRATION_MODE = 'open';
// Specs register many users from one address; the rate-limit spec lowers this itself.
process.env.REGISTER_MAX_PER_IP = '100000';
// Cheap hashes keep the suite fast; production defaults to 12 rounds.
process.env.BCRYPT_ROUNDS = '4';
// eslint-disable-next-line @typescript-eslint/no-var-requires
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), `rb-test-storage-${process.pid}`);
for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENCODE_ZEN_API_KEY', 'ANTHROPIC_API_KEY', 'REDIS_URL', 'LLM_PROVIDER_CHAIN']) {
  delete process.env[key];
}
