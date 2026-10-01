import { Response } from '@loopback/rest';

/**
 * Writes a file download directly. LoopBack forces application/octet-stream on
 * Buffer results, so controllers return the written response instead.
 */
export function sendFile(response: Response, data: Buffer, mimeType: string, fileName: string, inline = false): Response {
  const safeName = fileName.replace(/["\r\n]/g, '');
  response.status(200);
  response.setHeader('Content-Type', mimeType);
  response.setHeader('Content-Length', String(data.length));
  response.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(data);
  return response;
}
