import { expect } from '@loopback/testlab';
import { Semaphore } from '../../../common/utils/semaphore.util';
import { ResumeRenderService } from '../../../services/render/resume-render.service';
import { RESUME_TEMPLATES } from '../../../services/render/resume-templates';
import { TextExtractionService } from '../../../services/resume/text-extraction.service';
import { SAMPLE_RESUME_DOCUMENT } from '../../helpers/fixtures';

describe('ResumeRenderService', () => {
  const renderer = new ResumeRenderService();
  const extractor = new TextExtractionService();

  for (const template of RESUME_TEMPLATES) {
    it(`renders the ${template.id} template to a text PDF containing every fact`, async () => {
      const pdf = await renderer.render(SAMPLE_RESUME_DOCUMENT, template.id);
      expect(pdf.subarray(0, 5).toString('latin1')).to.equal('%PDF-');
      const text = await extractor.extract(pdf, 'pdf');
      for (const fact of ['Priya Raman', 'Acme Payments', 'Brightlabs', 'Anna University', '2021-03', 'Kafka', 'cutting batch time by 40%']) {
        expect(text).to.containEql(fact);
      }
    });
  }

  it('does not mutate the document it renders', async () => {
    const before = JSON.stringify(SAMPLE_RESUME_DOCUMENT);
    await renderer.render(SAMPLE_RESUME_DOCUMENT, 'classic');
    expect(JSON.stringify(SAMPLE_RESUME_DOCUMENT)).to.equal(before);
  });

  it('defaults to the classic template', async () => {
    expect(renderer.resolveTemplate(undefined).id).to.equal('classic');
  });

  it('rejects an unknown template', () => {
    expect(() => renderer.resolveTemplate('fancy')).to.throw(/Unknown template/);
  });

  it('renders non-Latin-1 names', async () => {
    const pdf = await renderer.render({ ...SAMPLE_RESUME_DOCUMENT, contact: { ...SAMPLE_RESUME_DOCUMENT.contact, name: 'Zoë Ångström' } });
    expect(await extractor.extract(pdf, 'pdf')).to.containEql('Zoë Ångström');
  });

  it('lists templates without internal style details', () => {
    expect(Object.keys(renderer.templates()[0]).sort()).to.eql(['description', 'id', 'name']);
  });
});

describe('Semaphore', () => {
  it('never runs more than the limit at once', async () => {
    const gate = new Semaphore(2);
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () =>
      gate.run(async () => {
        peak = Math.max(peak, gate.inUse);
        await new Promise(resolve => setTimeout(resolve, 5));
      }),
    );
    await Promise.all(tasks);
    expect(peak).to.equal(2);
    expect(gate.inUse).to.equal(0);
  });

  it('releases the slot when a task throws', async () => {
    const gate = new Semaphore(1);
    await gate.run(async () => Promise.reject(new Error('boom'))).catch(() => undefined);
    expect(await gate.run(async () => 'ok')).to.equal('ok');
  });
});
