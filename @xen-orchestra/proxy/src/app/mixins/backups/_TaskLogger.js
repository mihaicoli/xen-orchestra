const logAfterEnd = () => {
  throw new Error('task has already ended')
}

export class TaskLogger {
  constructor(logFn, parentId) {
    this._log = logFn
    this._parentId = parentId
    this._taskId = undefined
  }

  get taskId() {
    const taskId = this._taskId
    if (taskId === undefined) {
      throw new Error('start the task first')
    }
    return taskId
  }

  failure(error) {
    const log = this._log
    this._log = logAfterEnd
    return log({
      event: 'end',
      result: error,
      status: 'failure',
      taskId: this.taskId,
    })
  }

  // create a subtask
  fork() {
    return new TaskLogger(this._log, this.taskId)
  }

  info(message, data) {
    return this._log({
      data,
      event: 'info',
      message,
      taskId: this.taskId,
    })
  }

  start(message, data) {
    if (this._taskId !== undefined) {
      throw new Error('task has already started')
    }

    this._taskId = Math.random()
      .toString(36)
      .slice(2)

    return this._log({
      data,
      event: 'start',
      message,
      parentId: this._parentId,
      taskId: this.taskId,
    })
  }

  success(result) {
    const log = this._log
    this._log = logAfterEnd
    return log({
      event: 'end',
      result,
      status: 'success',
      taskId: this.taskId,
    })
  }

  warning(message, data) {
    return this._log({
      data,
      event: 'warning',
      message,
      taskId: this.taskId,
    })
  }

  wrap(fn, message, data) {
    const logger = this
    return function() {
      logger.start(message, data)
      try {
        const result = fn.apply(this, arguments)
        return result != null && typeof result.then === 'function'
          ? result.then(error => logger.failure(error))
          : result
      } catch (error) {
        logger.failure(error)
      }
    }
  }
}
