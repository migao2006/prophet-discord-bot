export class KeyedTaskQueue {
  constructor() {
    this.queues = new Map();
  }

  enqueue(key, task) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.queues.set(key, current);
    current.finally(() => {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }).catch(() => {});
    return current;
  }
}
