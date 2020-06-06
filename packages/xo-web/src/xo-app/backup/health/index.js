import _ from 'intl'
import Component from 'base-component'
import constructQueryString from 'construct-query-string'
import Copiable from 'copiable'
import Icon from 'icon'
import Link from 'link'
import NoObjects from 'no-objects'
import React from 'react'
import renderXoItem, { Vm } from 'render-xo-item'
import SortedTable from 'sorted-table'
import { addSubscriptions, connectStore } from 'utils'
import { Card, CardHeader, CardBlock } from 'card'
import { Container, Row, Col } from 'grid'
import { createPredicate } from 'value-matcher'
import {
  createGetLoneSnapshots,
  createGetObjectsOfType,
  createSelector,
} from 'selectors'
import {
  deleteBackupJobs,
  deleteBackups,
  deleteSnapshot,
  deleteSnapshots,
  listVmBackups,
  subscribeBackupNgJobs,
  subscribeRemotes,
  subscribeSchedules,
} from 'xo'
import {
  filter,
  flatMap,
  forEach,
  keyBy,
  groupBy,
  map,
  omit,
  toArray,
} from 'lodash'
import { FormattedRelative, FormattedTime } from 'react-intl'

const DETACHED_BACKUP_COLUMNS = [
  {
    name: _('jobId'),
    itemRenderer: ({ jobId }) => (
      <Copiable data={jobId} tagName='p'>
        {jobId.slice(4, 8)}
      </Copiable>
    ),
  },
  {
    name: _('vm'),
    itemRenderer: ({ vmId }) => <Vm id={vmId} />,
  },
  {
    name: _('reason'),
    itemRenderer: backup => backup.reason,
  },
]

const SNAPSHOT_COLUMNS = [
  {
    name: _('snapshotDate'),
    itemRenderer: snapshot => (
      <span>
        <FormattedTime
          day='numeric'
          hour='numeric'
          minute='numeric'
          month='long'
          value={snapshot.snapshot_time * 1000}
          year='numeric'
        />{' '}
        (<FormattedRelative value={snapshot.snapshot_time * 1000} />)
      </span>
    ),
    sortCriteria: 'snapshot_time',
    sortOrder: 'desc',
  },
  {
    name: _('vmNameLabel'),
    itemRenderer: renderXoItem,
    sortCriteria: 'name_label',
  },
  {
    name: _('vmNameDescription'),
    itemRenderer: snapshot => snapshot.name_description,
    sortCriteria: 'name_description',
  },
  {
    name: _('snapshotOf'),
    itemRenderer: (snapshot, { vms }) => {
      const vm = vms[snapshot.$snapshot_of]
      return vm && <Link to={`/vms/${vm.id}`}>{renderXoItem(vm)}</Link>
    },
    sortCriteria: (snapshot, { vms }) => {
      const vm = vms[snapshot.$snapshot_of]
      return vm && vm.name_label
    },
  },
]

const ACTIONS = [
  {
    label: _('deleteSnapshots'),
    individualLabel: _('deleteSnapshot'),
    icon: 'delete',
    level: 'danger',
    handler: deleteSnapshots,
    individualHandler: deleteSnapshot,
  },
]

const _deleteBackupJobs = items => {
  const { backup: backupIds, metadataBackup: metadataBackupIds } = groupBy(
    items,
    'type'
  )
  return deleteBackupJobs({ backupIds, metadataBackupIds })
}

const DETACHED_BACKUP_ACTIONS = [
  {
    handler: backups => deleteBackups(flatMap(backups, 'backups')),
    icon: 'delete',
    label: _('deleteVmBackups'),
    level: 'danger',
  },
]

const INDIVIDUAL_ACTIONS = [
  {
    handler: (job, { goTo }) =>
      goTo({
        pathname: '/home',
        query: { t: 'VM', s: constructQueryString(job.vms) },
      }),
    label: _('redirectToMatchingVms'),
    icon: 'preview',
  },
  {
    handler: (job, { goToNewTab }) => goToNewTab(`/backup/${job.id}/edit`),
    label: _('formEdit'),
    icon: 'edit',
    level: 'primary',
  },
]

@addSubscriptions({
  // used by createGetLoneSnapshots
  schedules: subscribeSchedules,
  jobs: cb =>
    subscribeBackupNgJobs(jobs => {
      cb(keyBy(jobs, 'id'))
    }),
  remotes: subscribeRemotes,
})
@connectStore({
  loneSnapshots: createGetLoneSnapshots,
  legacySnapshots: createGetObjectsOfType('VM-snapshot').filter([
    (() => {
      const RE = /^(?:XO_DELTA_EXPORT:|XO_DELTA_BASE_VM_SNAPSHOT_|rollingSnapshot_)/
      return (
        { name_label } // eslint-disable-line camelcase
      ) => RE.test(name_label)
    })(),
  ]),
  vms: createGetObjectsOfType('VM'),
})
export default class Health extends Component {
  _getDetachedBackups = createSelector(
    () => this.props.jobs,
    () => this.props.vms,
    () => this.props.remotes,
    createSelector(
      () => this.props.schedules,
      schedules => groupBy(schedules, 'jobId')
    ),
    async (jobs, vms, remotes, schedulesByJob) => {
      const backupsByRemote = await listVmBackups(toArray(remotes))
      const detachedBackups = []
      forEach(backupsByRemote, backups => {
        detachedBackups.push(
          ...flatMap(backups, (vmBackups, vmId) => {
            if (vms[vmId] === undefined) {
              return map(vmBackups, backup => ({
                ...backup,
                reason: 'Missing VM',
              }))
            }

            forEach(vmBackups, backup => {
              const job = jobs[backup.jobId]
              if (job === undefined) {
                return {
                  ...backup,
                  reason: 'Missing job',
                }
              }
              const filtredVmIds = filter(
                vms,
                createPredicate(omit(job.vms, 'power_state'))
              ).map(_ => _.id)
              if (filtredVmIds.length === 0) {
                return {
                  ...backup,
                  reason: 'No VMs match to this job',
                }
              } else if (!filtredVmIds.includes(vmId)) {
                return {
                  ...backup,
                  vmId,
                  reason: 'VM is not part of this job',
                }
              }
            })
          })
        )
      })
      return detachedBackups
    }
  )

  _goTo = path => {
    this.context.router.push(path)
  }

  _goToNewTab = path => {
    window.open(this.context.router.createHref(path))
  }

  render() {
    return (
      <Container>
        <Row className='detached-backups'>
          <Col>
            <Card>
              <CardHeader>
                <Icon icon='backup' /> {_('detachedBackups')}
              </CardHeader>
              <CardBlock>
                <NoObjects
                  actions={DETACHED_BACKUP_ACTIONS}
                  collection={this._getDetachedBackups()}
                  columns={DETACHED_BACKUP_COLUMNS}
                  component={SortedTable}
                  data-goTo={this._goTo}
                  data-goToNewTab={this._goToNewTab}
                  emptyMessage={_('noDetachedBackups')}
                  shortcutsTarget='.detached-backups'
                  stateUrlParam='s_detached_backups'
                />
              </CardBlock>
            </Card>
          </Col>
        </Row>
        <Row className='lone-snapshots'>
          <Col>
            <Card>
              <CardHeader>
                <Icon icon='vm' /> {_('vmSnapshotsRelatedToNonExistentBackups')}
              </CardHeader>
              <CardBlock>
                <NoObjects
                  actions={ACTIONS}
                  collection={this.props.loneSnapshots}
                  columns={SNAPSHOT_COLUMNS}
                  component={SortedTable}
                  data-vms={this.props.vms}
                  emptyMessage={_('noSnapshots')}
                  shortcutsTarget='.lone-snapshots'
                  stateUrlParam='s_vm_snapshots'
                />
              </CardBlock>
            </Card>
          </Col>
        </Row>
        <Row className='legacy-snapshots'>
          <Col>
            <Card>
              <CardHeader>
                <Icon icon='vm' /> {_('legacySnapshots')}
              </CardHeader>
              <CardBlock>
                <NoObjects
                  actions={ACTIONS}
                  collection={this.props.legacySnapshots}
                  columns={SNAPSHOT_COLUMNS}
                  component={SortedTable}
                  data-vms={this.props.vms}
                  emptyMessage={_('noSnapshots')}
                  shortcutsTarget='.legacy-snapshots'
                  stateUrlParam='s_legacy_vm_snapshots'
                />
              </CardBlock>
            </Card>
          </Col>
        </Row>
      </Container>
    )
  }
}
