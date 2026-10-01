import { BindingScope, inject, injectable } from '@loopback/core';
import { spawn } from 'child_process';
import mammoth from 'mammoth';
import { envInt, envString } from '../../common/config/env.util';
import { AppValidationError, ERROR_CODES } from '../../common/errors';
import { DetectedType } from '../common/file-upload.service';
import { LoggerService } from '../common/logger.service';
import { pdfjsText } from './pdfjs-text.util';

export const MAX_RESUME_TEXT_CHARS = 40_000;

/** Collapses the whitespace noise PDF extraction produces without merging paragraphs. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Runs poppler's pdftotext on stdin → stdout. Resolves undefined when the binary is not installed. */
export function runPdfToText(buffer: Buffer, binary: string, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-enc', 'UTF-8', '-', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => (stderr += chunk.toString()));
    child.on('error', error => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve(undefined);
      else reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`pdftotext exited ${code}: ${stderr.slice(0, 200)}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(buffer);
  });
}

/**
 * Deterministic text extraction. The model sees text, not the file, which
 * keeps a resume to a few thousand tokens and lets the fact-checker compare
 * tailored output against exactly what the user uploaded.
 *
 * PDFs go through poppler's `pdftotext` when installed and fall back to
 * pdf.js (pdfjs-dist legacy build) otherwise. pdf-parse is deliberately not
 * used: its 2017 pdf.js breaks ("bad XRef entry") once Node's global fetch
 * has been initialised, which every LLM call does.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class TextExtractionService {
  constructor(@inject('services.LoggerService', { optional: true }) private logger?: LoggerService) {}

  async extract(buffer: Buffer, type: DetectedType): Promise<string> {
    let raw: string;
    try {
      raw = await this.raw(buffer, type);
    } catch (error) {
      this.logger?.warn('Text extraction failed', { type, error: (error as Error).message });
      throw new AppValidationError(ERROR_CODES.FILE_INVALID, 'The file could not be read. Try exporting it again as PDF or DOCX.');
    }
    const text = normaliseText(raw);
    if (text.length < 50) {
      throw new AppValidationError(ERROR_CODES.RESUME_TEXT_EMPTY, 'No readable text found. Scanned PDFs are not supported yet; upload a text PDF or DOCX.');
    }
    if (text.length > MAX_RESUME_TEXT_CHARS) {
      throw new AppValidationError(ERROR_CODES.RESUME_TOO_LONG, `Resume text is longer than ${MAX_RESUME_TEXT_CHARS} characters`);
    }
    return text;
  }

  private async raw(buffer: Buffer, type: DetectedType): Promise<string> {
    switch (type) {
      case 'pdf': {
        const viaPoppler = await runPdfToText(buffer, envString('PDFTOTEXT_PATH', 'pdftotext')!, envInt('PDFTOTEXT_TIMEOUT_MS', 15_000));
        return viaPoppler ?? (await pdfjsText(buffer));
      }
      case 'docx':
        return (await mammoth.extractRawText({ buffer })).value;
      case 'txt':
        return buffer.toString('utf8');
    }
  }
}
