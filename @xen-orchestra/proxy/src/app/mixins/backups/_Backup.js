import asyncMap from '@xen-orchestra/async-map'
import limitConcurrency from 'limit-concurrency-decorator'
import { compileTemplate } from '@xen-orchestra/template'
import { createLogger } from '@xen-orchestra/log'
import { extractIdsFromSimplePattern } from '@xen-orchestra/backups/extractIdsFromSimplePattern'
import { getHandler } from '@xen-orchestra/fs'

import { VmBackup } from './_VmBackup'
import { TaskLogger } from './_TaskLogger'

const { warn } = createLogger('xo:proxy:backups:Backup')

const noop = Function.prototype

export class Backup {
  constructor({
    config,
    getConnectedXapi,
    job,
    taskLogger,
    recordToXapi,
    remotes,
    schedule,
  }) {
    this._config = config
    this._getConnectedXapi = getConnectedXapi
    this._job = job
    this._task = taskLogger
    this._recordToXapi = recordToXapi
    this._remotes = remotes
    this._schedule = schedule

    this._getSnapshotNameLabel = compileTemplate(config.snapshotNameLabelTpl, {
      '{job.name}': job.name,
      '{vm.name_label}': vm => vm.name_label,
    })
  }

  async run() {
    const job = this._job

    const task = this._task
    await task.start('backup run')
    try {
      // FIXME: proper SimpleIdPattern handling
      const getSnapshotNameLabel = this._getSnapshotNameLabel
      const schedule = this._schedule

      const { settings } = job
      const scheduleSettings = {
        ...this._config.defaultSettings,
        ...settings[''],
        ...settings[schedule.id],
      }

      const srs = await Promise.all(
        extractIdsFromSimplePattern(job.srs).map(_ => this._getRecord('SR', _))
      )

      const remoteIds = extractIdsFromSimplePattern(job.remotes)
      const remoteHandlers = {}
      try {
        await asyncMap(remoteIds, async id => {
          const handler = getHandler(this._remotes[id])
          await handler.sync()
          remoteHandlers[id] = handler
        })
        const handleVm = async vmUuid => {
          const subtask = await task.fork()
          try {
            const vm = await this._getRecord('VM', vmUuid)
            return await new VmBackup({
              getSnapshotNameLabel,
              job,
              // remotes,
              remoteHandlers,
              schedule,
              settings: { ...scheduleSettings, ...settings[vmUuid] },
              srs,
              taskLogger: subtask,
              vm,
            }).run()
          } catch (error) {
            warn('VM backup failure', {
              error,
              vmUuid,
            })
          }
        }
        const { concurrency } = scheduleSettings
        return await asyncMap(
          extractIdsFromSimplePattern(job.vms),
          concurrency === 0 ? handleVm : limitConcurrency(concurrency)(handleVm)
        )
      } finally {
        await Promise.all(
          Object.keys(remoteHandlers).map(id =>
            remoteHandlers[id].forget().then(noop)
          )
        )
      }
    } catch (error) {
      await task.failure(error)
    }
  }

  async _getRecord(type, uuid) {
    const xapiId = this._recordToXapi[uuid]
    if (xapiId === undefined) {
      throw new Error('no XAPI associated to ' + uuid)
    }

    const xapi = await this._getConnectedXapi(xapiId)
    return xapi.getRecordByUuid(type, uuid)
  }
}
