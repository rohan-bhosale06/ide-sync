import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { Logger } from './logger.js';

export class PeriodicScheduler {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly cronExpression: string,
    private readonly onTick: () => void,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (!cron.validate(this.cronExpression)) {
      this.logger.warn({ cronExpression: this.cronExpression }, 'invalid cron expression — periodic pull disabled');
      return;
    }
    this.task = cron.schedule(this.cronExpression, () => {
      this.logger.debug({ cronExpression: this.cronExpression }, 'periodic pull tick');
      this.onTick();
    });
    this.logger.info({ cronExpression: this.cronExpression }, 'periodic scheduler started');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}
