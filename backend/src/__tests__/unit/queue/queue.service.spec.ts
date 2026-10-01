import { expect } from '@loopback/testlab';
import { QueueService } from '../../../queue/queue.service';
import { JobMeta, QueueProcessor } from '../../../queue/queue.types';
import { LoggerService } from '../../../services/common/logger.service';

class RecordingProcessor implements QueueProcessor<{ n: number }> {
  readonly queueName = 'recording';
  readonly attempts = 3;
  readonly seen: Array<{ n: number; attempt: number }> = [];
  failUntilAttempt = 0;

  async handle(data: { n: number }, meta: JobMeta): Promise<void> {
    this.seen.push({ n: data.n, attempt: meta.attempt });
    if (meta.attempt < this.failUntilAttempt) throw new Error('transient');
  }
}

describe('QueueService (inline driver)', () => {
  let queue: QueueService;
  let processor: RecordingProcessor;

  beforeEach(() => {
    queue = new QueueService(new LoggerService());
    processor = new RecordingProcessor();
    queue.register(processor);
  });

  it('runs a job after enqueue and drain', async () => {
    const jobId = await queue.enqueue('recording', { n: 1 });
    await queue.drain();
    expect(jobId).to.be.a.String();
    expect(processor.seen).to.eql([{ n: 1, attempt: 1 }]);
  });

  it('retries a failing job up to its attempt limit', async () => {
    processor.failUntilAttempt = 3;
    await queue.enqueue('recording', { n: 2 });
    await queue.drain();
    expect(processor.seen.map(s => s.attempt)).to.eql([1, 2, 3]);
  });

  it('rejects an unknown queue', async () => {
    await expect(queue.enqueue('nope', {})).to.be.rejectedWith(/No processor registered/);
  });

  it('drains jobs enqueued by other jobs', async () => {
    const chained: QueueProcessor<{ depth: number }> = {
      queueName: 'chain',
      handle: async data => {
        if (data.depth < 2) await queue.enqueue('chain', { depth: data.depth + 1 });
        processor.seen.push({ n: data.depth, attempt: 1 });
      },
    };
    queue.register(chained);
    await queue.enqueue('chain', { depth: 0 });
    await queue.drain();
    expect(processor.seen.map(s => s.n).sort()).to.eql([0, 1, 2]);
  });
});
