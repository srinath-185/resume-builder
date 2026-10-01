// Minimal OpenAI-compatible chat-completions server for the end-to-end smoke test.
const http = require('http');
const { SAMPLE_PARSE_REPLY } = require(require('path').resolve(__dirname, '../../backend/dist/__tests__/helpers/fixtures'));
const { faithfulTailoring, JD_KEYWORDS_REPLY } = require(require('path').resolve(__dirname, '../../backend/dist/__tests__/helpers/tailoring.helper'));

function reply(system, user) {
  if (system.startsWith('You convert the plain text of a resume')) return SAMPLE_PARSE_REPLY;
  if (system.startsWith('You extract what a job description asks for')) return JD_KEYWORDS_REPLY;
  if (system.startsWith('You rate how well a candidate')) {
    const ids = [...user.matchAll(/### Job (\d+)/g)].map(m => m[1]);
    return JSON.stringify({ results: ids.map(id => ({ id, score: 90, reason: 'fit', matchedSkills: [], missingSkills: [] })) });
  }
  if (system.startsWith("You tailor a candidate's resume")) return JSON.stringify(faithfulTailoring());
  return '{}';
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions') || req.headers.authorization !== 'Bearer smoke-key') {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
        return;
      }
      const request = JSON.parse(body);
      const system = request.messages.find(m => m.role === 'system')?.content ?? '';
      const user = request.messages.find(m => m.role === 'user')?.content ?? '';
      const content = reply(system, user);
      process.stdout.write(`llm: ${request.model} ${system.slice(0, 40)}…\n`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: Math.ceil(content.length / 4) } }),
      );
    });
  })
  .listen(3999, '127.0.0.1', () => console.log('fake llm on 3999'));
