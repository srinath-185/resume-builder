import { BindingScope, injectable } from '@loopback/core';
import { Request, Response } from '@loopback/rest';
import multer, { MulterError } from 'multer';
import { AppValidationError, ERROR_CODES } from '../../common/errors';

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  fields: Record<string, string>;
}

export interface UploadRules {
  field: string;
  maxBytes: number;
  /** Detected type → accepted. Detection is by content, not by the client's Content-Type. */
  allowed: DetectedType[];
}

export type DetectedType = 'pdf' | 'docx' | 'txt';

export const MIME_BY_TYPE: Record<DetectedType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Identifies the file from its first bytes; the client-supplied mime type is ignored. */
export function detectType(buffer: Buffer, originalName: string): DetectedType | undefined {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (isZip && /\.docx$/i.test(originalName)) return 'docx';
  if (/\.(txt|md)$/i.test(originalName) && !buffer.subarray(0, 4096).includes(0)) return 'txt';
  return undefined;
}

/** Single-file multipart parsing held in memory (resumes are small). */
@injectable({ scope: BindingScope.SINGLETON })
export class FileUploadService {
  async single(request: Request, response: Response, rules: UploadRules): Promise<UploadedFile & { type: DetectedType }> {
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: rules.maxBytes, files: 1, fields: 10 } }).single(rules.field);

    // multer's typings target Express 5 while LoopBack ships Express 4 types; the runtime objects are the same.
    type MulterRequest = Parameters<typeof upload>[0];
    type MulterResponse = Parameters<typeof upload>[1];
    await new Promise<void>((resolve, reject) => {
      upload(request as unknown as MulterRequest, response as unknown as MulterResponse, (error: unknown) => {
        if (!error) return resolve();
        if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return reject(new AppValidationError(ERROR_CODES.FILE_TOO_LARGE, `File exceeds ${Math.round(rules.maxBytes / 1024 / 1024)} MB`));
        }
        return reject(new AppValidationError(ERROR_CODES.FILE_INVALID, (error as Error).message));
      });
    });

    const file = (request as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new AppValidationError(ERROR_CODES.FILE_INVALID, `Missing file field "${rules.field}"`);

    const type = detectType(file.buffer, file.originalname);
    if (!type || !rules.allowed.includes(type)) {
      throw new AppValidationError(ERROR_CODES.FILE_INVALID, `Unsupported file. Allowed: ${rules.allowed.join(', ')}`);
    }

    return {
      buffer: file.buffer,
      originalName: file.originalname.slice(0, 200),
      mimeType: MIME_BY_TYPE[type],
      size: file.size,
      fields: { ...(request.body as Record<string, string>) },
      type,
    };
  }
}
