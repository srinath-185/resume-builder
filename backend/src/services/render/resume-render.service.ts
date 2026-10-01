import { BindingScope, injectable } from '@loopback/core';
import PdfPrinter from 'pdfmake';
import { TFontDictionary } from 'pdfmake/interfaces';
import { envInt } from '../../common/config/env.util';
import { AppNotFoundError, ERROR_CODES } from '../../common/errors';
import { Semaphore } from '../../common/utils/semaphore.util';
import { ResumeDocument } from '../../domain/resume-document';
import { buildDocDefinition, findTemplate, RESUME_TEMPLATES, ResumeTemplate } from './resume-templates';

function robotoFonts(): TFontDictionary {
  // pdfmake ships Roboto as base64 in its virtual file system; Roboto covers Latin, Greek and Cyrillic.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vfs = require('pdfmake/build/vfs_fonts') as Record<string, string>;
  const font = (file: string) => Buffer.from(vfs[file], 'base64') as unknown as string;
  return {
    Roboto: {
      normal: font('Roboto-Regular.ttf'),
      bold: font('Roboto-Medium.ttf'),
      italics: font('Roboto-Italic.ttf'),
      bolditalics: font('Roboto-MediumItalic.ttf'),
    },
  };
}

/** ResumeDocument + template → PDF bytes. Rendering is CPU-bound, so it is concurrency-capped. */
@injectable({ scope: BindingScope.SINGLETON })
export class ResumeRenderService {
  private printer?: PdfPrinter;
  private readonly gate = new Semaphore(Math.max(1, envInt('RESUME_RENDER_CONCURRENCY', 2)));

  templates(): Array<Omit<ResumeTemplate, 'style'>> {
    return RESUME_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
  }

  resolveTemplate(templateId?: string): ResumeTemplate {
    const template = findTemplate(templateId);
    if (!template) throw new AppNotFoundError(ERROR_CODES.TEMPLATE_NOT_FOUND, `Unknown template "${templateId}"`);
    return template;
  }

  render(document: ResumeDocument, templateId?: string): Promise<Buffer> {
    const template = this.resolveTemplate(templateId);
    // pdfmake rewrites list items in place (strings become objects); never hand it the caller's document.
    const copy = structuredClone(document);
    return this.gate.run(() => this.toBuffer(copy, template));
  }

  private toBuffer(document: ResumeDocument, template: ResumeTemplate): Promise<Buffer> {
    this.printer ??= new PdfPrinter(robotoFonts());
    const pdf = this.printer.createPdfKitDocument(buildDocDefinition(document, template));
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });
  }
}
