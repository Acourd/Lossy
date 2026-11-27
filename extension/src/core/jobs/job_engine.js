/**
 * Liner Context Portability — Motor de Trabajos Determinista (Job Engine v1.3)
 * Controla colas asíncronas con concurrencia acotada, pausa/cancelación,
 * backoff ante HTTP 429, persistencia en LinerDB y tolerancia a fallos parciales.
 * Dual Browser/Node.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    const linerDb = require('../storage/liner_db.js');
    const jobModule = factory(linerDb);
    jobModule.Lossy = {
      JobEngine: jobModule.JobEngine,
      JOB_STATUS: jobModule.JOB_STATUS,
      ITEM_STATUS: jobModule.ITEM_STATUS
    };
    if (typeof globalThis !== 'undefined') {
      globalThis.Lossy = globalThis.Lossy || {};
      globalThis.Lossy.JobEngine = jobModule.JobEngine;
    }
    module.exports = jobModule;
  } else {
    root.Liner = root.Liner || {};
    root.Lossy = root.Lossy || {};
    const linerDb = (root.Lossy.LossyDB || root.Liner.LinerDB) ? { defaultDB: (root.Lossy.defaultDB || root.Liner.defaultDB) } : {};
    const jobModule = factory(linerDb);
    root.Liner.JobEngine = jobModule.JobEngine;
    root.Liner.JOB_STATUS = jobModule.JOB_STATUS;
    root.Liner.ITEM_STATUS = jobModule.ITEM_STATUS;
    root.Lossy.JobEngine = jobModule.JobEngine;
    root.Lossy.JOB_STATUS = jobModule.JOB_STATUS;
    root.Lossy.ITEM_STATUS = jobModule.ITEM_STATUS;
    root.JobEngine = jobModule.JobEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (linerDb) {
  'use strict';

  const defaultDB = (linerDb && linerDb.defaultDB) || null;

  const JOB_STATUS = Object.freeze({
    QUEUED: 'queued',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    COMPLETED_WITH_WARNINGS: 'completed_with_warnings',
    CANCELLED: 'cancelled',
    FAILED: 'failed'
  });

  const ITEM_STATUS = Object.freeze({
    PENDING: 'pending',
    ACQUIRING: 'acquiring',
    NORMALIZING: 'normalizing',
    STORED: 'stored',
    WARNING: 'warning',
    FAILED: 'failed'
  });

  function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  class JobEngine {
    constructor(options = {}) {
      this.db = options.db || defaultDB;
      this.concurrency = typeof options.concurrency === 'number' ? options.concurrency : 2;
      this.itemPacingMs = typeof options.itemPacingMs === 'number' ? options.itemPacingMs : 250;
      this.maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 3;
      this.activeJob = null;
      this.listeners = new Set();
      this._abortSignal = false;
      this._pauseSignal = false;
      this._runningLoop = false;
      this._runPromise = null;
    }

    _syncJobCounters(job) {
      if (!job || !Array.isArray(job.items)) return;
      let completed = 0;
      let failed = 0;
      let warning = 0;
      for (const it of job.items) {
        if (!it) continue;
        if (it.status === ITEM_STATUS.STORED) completed++;
        else if (it.status === ITEM_STATUS.WARNING) { completed++; warning++; }
        else if (it.status === ITEM_STATUS.FAILED) failed++;
      }
      job.totalItems = job.items.length;
      job.completedItems = completed;
      job.warningItems = warning;
      job.failedItems = failed;
    }

    onProgress(callback) {
      if (typeof callback === 'function') {
        this.listeners.add(callback);
      }
      return () => this.listeners.delete(callback);
    }

    notify(job) {
      for (const listener of this.listeners) {
        try {
          listener(JSON.parse(JSON.stringify(job)));
        } catch (_) {}
      }
    }

    createJob(type, items = [], metadata = {}) {
      if (this._runningLoop || this._runPromise) {
        throw new Error('Ya existe un trabajo en ejecución concurrente');
      }
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const formattedItems = items.map((it, idx) => {
        const isStr = typeof it === 'string';
        const canonicalId = isStr ? it : (it?.canonicalId || it?.id || null);
        const convId = isStr ? null : (it?.conversationId || it?.source?.conversationId || null);
        return {
          index: idx,
          id: canonicalId || convId || `item_${idx}`,
          canonicalId: canonicalId || undefined,
          conversationId: convId || undefined,
          url: isStr ? undefined : (it?.url || it?.source?.url || undefined),
          platform: isStr ? undefined : (it?.platform || it?.source?.platform || undefined),
          title: (!isStr && it?.title) ? it.title : 'Elemento',
          status: ITEM_STATUS.PENDING,
          retries: 0,
          error: null,
          result: null
        };
      });

      const job = {
        jobId,
        type: type || 'BULK_ACQUISITION',
        status: JOB_STATUS.QUEUED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        totalItems: formattedItems.length,
        completedItems: 0,
        failedItems: 0,
        warningItems: 0,
        items: formattedItems,
        metadata
      };

      this.activeJob = job;
      if (this.db && typeof this.db.saveJob === 'function') {
        this.db.saveJob(job).catch(() => {});
      }
      return job;
    }

    start(job, workerFn) {
      if (this._runningLoop || this._runPromise) {
        return Promise.reject(new Error('Ya existe un trabajo en ejecución concurrente'));
      }
      if (job) {
        this.activeJob = Object.assign({
          status: JOB_STATUS.QUEUED,
          totalItems: (job.items && job.items.length) || 0,
          completedItems: 0,
          failedItems: 0,
          warningItems: 0
        }, job);
        this._syncJobCounters(this.activeJob);
      }
      return this.run(workerFn);
    }

    pause() {
      if (this.activeJob && this.activeJob.status === JOB_STATUS.RUNNING) {
        this._pauseSignal = true;
        this.activeJob.status = JOB_STATUS.PAUSED;
        this.activeJob.updatedAt = new Date().toISOString();
        if (this.db && typeof this.db.saveJob === 'function') {
          this.db.saveJob(this.activeJob).catch(() => {});
        }
        this.notify(this.activeJob);
      }
    }

    resume(workerFn) {
      if (this._runningLoop || this._runPromise) {
        return Promise.reject(new Error('Ya existe un trabajo en ejecución concurrente'));
      }
      if (this.activeJob && this.activeJob.status === JOB_STATUS.PAUSED) {
        this._pauseSignal = false;
        return this.run(workerFn);
      }
    }

    cancel() {
      if (this.activeJob && (this.activeJob.status === JOB_STATUS.RUNNING || this.activeJob.status === JOB_STATUS.PAUSED || this.activeJob.status === JOB_STATUS.QUEUED)) {
        this._abortSignal = true;
        this.activeJob.status = JOB_STATUS.CANCELLED;
        this.activeJob.updatedAt = new Date().toISOString();
        if (this.db && typeof this.db.saveJob === 'function') {
          this.db.saveJob(this.activeJob).catch(() => {});
        }
        this.notify(this.activeJob);
      }
    }

    retryFailed(workerFn) {
      if (!this.activeJob) throw new Error('No hay trabajo activo');
      if (this._runningLoop || this._runPromise) {
        return Promise.reject(new Error('Ya existe un trabajo en ejecución concurrente'));
      }
      const failedItems = this.activeJob.items.filter(it => it.status === ITEM_STATUS.FAILED);
      if (failedItems.length === 0) return Promise.resolve(this.activeJob);

      failedItems.forEach(it => {
        it.status = ITEM_STATUS.PENDING;
        it.retries = 0;
        it.error = null;
      });
      this._syncJobCounters(this.activeJob);
      this.activeJob.status = JOB_STATUS.QUEUED;
      this.activeJob.updatedAt = new Date().toISOString();
      return this.run(workerFn);
    }

    async run(workerFn) {
      if (!this.activeJob) throw new Error('No hay trabajo activo para ejecutar');
      if (this._runningLoop || this._runPromise) {
        throw new Error('Ya existe un trabajo en ejecución concurrente');
      }
      this._runningLoop = true;
      const runJob = this.activeJob;
      const startWipeEpoch = (this.db && typeof this.db.getWipeEpoch === 'function') ? this.db.getWipeEpoch() : null;
      this._syncJobCounters(runJob);
      runJob.status = JOB_STATUS.RUNNING;
      this._abortSignal = false;
      this._pauseSignal = false;
      this.notify(runJob);

      const pendingItems = runJob.items.filter(
        it => it.status === ITEM_STATUS.PENDING || it.status === ITEM_STATUS.ACQUIRING
      );

      let currentIndex = 0;

      const processItem = async (item) => {
        if (this._abortSignal || this._pauseSignal || runJob !== this.activeJob) return;
        if (startWipeEpoch !== null && this.db && typeof this.db.getWipeEpoch === 'function' && this.db.getWipeEpoch() !== startWipeEpoch) {
          this._abortSignal = true;
          return;
        }

        item.status = ITEM_STATUS.ACQUIRING;
        this.notify(runJob);

        let success = false;
        let delay = this.itemPacingMs;

        while (!success && item.retries <= this.maxRetries) {
          if (this._abortSignal || this._pauseSignal || runJob !== this.activeJob) return;

          try {
            if (item.retries > 0) {
              const backoff = Math.min(1000 * Math.pow(2, item.retries) + Math.random() * 500, 30000);
              await waitMs(backoff);
            }

            const result = await workerFn(item);
            item.status = (result && result.warnings && result.warnings.length > 0)
              ? ITEM_STATUS.WARNING
              : ITEM_STATUS.STORED;
            item.result = result ? (result.canonicalId || result.id || 'ok') : 'ok';
            success = true;
            this._syncJobCounters(runJob);
          } catch (err) {
            item.retries++;
            if (err.message === 'WRITE_ABORTED_BY_CLEAR_ALL') {
              this._abortSignal = true;
              return;
            }
            if (err.nonRetryable || err.code === 'SOURCE_IDENTITY_MISMATCH') {
              item.status = ITEM_STATUS.FAILED;
              item.error = err.message || 'Error fatal no reintentable';
              this._syncJobCounters(runJob);
              break;
            }
            if (err.message === 'HTTP_429_RATE_LIMITED' && err.retryAfterSeconds) {
              await waitMs((err.retryAfterSeconds + 1) * 1000);
            }

            if (item.retries > this.maxRetries) {
              item.status = ITEM_STATUS.FAILED;
              item.error = err.message || 'Error desconocido';
              this._syncJobCounters(runJob);
            }
          }
        }

        runJob.updatedAt = new Date().toISOString();
        this._syncJobCounters(runJob);
        if (this.db && typeof this.db.saveJob === 'function') {
          await this.db.saveJob(runJob, startWipeEpoch !== null ? { expectedWipeEpoch: startWipeEpoch } : undefined).catch(() => {});
        }
        this.notify(runJob);
        await waitMs(delay);
      };

      const workers = [];
      for (let c = 0; c < this.concurrency; c++) {
        workers.push((async () => {
          while (currentIndex < pendingItems.length) {
            if (this._abortSignal || this._pauseSignal || runJob !== this.activeJob) break;
            const item = pendingItems[currentIndex++];
            await processItem(item);
          }
        })());
      }

      const loopPromise = Promise.all(workers);
      this._runPromise = loopPromise;
      try {
        await loopPromise;

        this._syncJobCounters(runJob);
        const hasIncompleteItems = runJob.items.some(
          it => it && (it.status === ITEM_STATUS.PENDING || it.status === ITEM_STATUS.ACQUIRING)
        );
        if (this._abortSignal || (!this._pauseSignal && hasIncompleteItems)) {
          runJob.status = JOB_STATUS.CANCELLED;
        } else if (this._pauseSignal) {
          runJob.status = JOB_STATUS.PAUSED;
        } else {
          if (runJob.failedItems > 0 && runJob.completedItems === 0) {
            runJob.status = JOB_STATUS.FAILED;
          } else if (runJob.warningItems > 0 || (runJob.failedItems > 0 && runJob.completedItems > 0)) {
            runJob.status = JOB_STATUS.COMPLETED_WITH_WARNINGS;
          } else {
            runJob.status = JOB_STATUS.COMPLETED;
          }
          runJob.completedAt = new Date().toISOString();
        }

        runJob.updatedAt = new Date().toISOString();
        if (this.db && typeof this.db.saveJob === 'function') {
          await this.db.saveJob(runJob, startWipeEpoch !== null ? { expectedWipeEpoch: startWipeEpoch } : undefined).catch(() => {});
        }
        this.notify(runJob);
        return runJob;
      } finally {
        this._runningLoop = false;
        this._runPromise = null;
      }
    }
  }

  return {
    JOB_STATUS,
    ITEM_STATUS,
    JobEngine
  };
});
