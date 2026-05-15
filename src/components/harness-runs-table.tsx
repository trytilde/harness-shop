import { useNavigate } from '@tanstack/react-router'

import { RefCell } from '#/components/ref-cell'
import { RepoCell } from '#/components/repo-cell'
import { StatusBadge } from '#/components/status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { HarnessId } from '#/lib/harness-definitions'
import type { Experiment } from '#/lib/types'

export function HarnessRunsTable({
  data,
  harnessId,
}: {
  data: Experiment[]
  harnessId: HarnessId
}) {
  const navigate = useNavigate()
  const isFactory = harnessId === 'factory-cli-provider'

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
        No runs yet.
      </div>
    )
  }

  const open = (exp: Experiment) => {
    navigate({
      to: '/experiments/$experimentId',
      params: { experimentId: exp.id },
    })
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[24%]">Repository</TableHead>
            <TableHead className="w-[20%]">Reference</TableHead>
            {isFactory ? (
              <>
                <TableHead>Provider</TableHead>
                <TableHead>Tools</TableHead>
              </>
            ) : (
              <TableHead>Experiment</TableHead>
            )}
            <TableHead className="w-[160px] text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((exp) => (
            <TableRow
              key={exp.id}
              className="hover:bg-muted/50 cursor-pointer"
              onClick={() => open(exp)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  open(exp)
                }
              }}
              tabIndex={0}
              role="link"
              aria-label={`Open ${exp.title || `${exp.repoOrg}/${exp.repoName}`}`}
            >
              <TableCell className="align-top">
                <RepoCell org={exp.repoOrg} name={exp.repoName} />
              </TableCell>
              <TableCell className="align-top">
                <RefCell refData={exp.ref} />
              </TableCell>
              {isFactory ? (
                <>
                  <TableCell className="align-top">
                    <div className="font-medium">
                      {exp.providerName ?? exp.title}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top text-sm">
                    {(exp.tools ?? []).join(', ') || 'Pending discovery'}
                  </TableCell>
                </>
              ) : (
                <TableCell className="align-top">
                  <div className="font-medium">{exp.title}</div>
                </TableCell>
              )}
              <TableCell className="text-right align-top">
                <StatusBadge status={exp.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

