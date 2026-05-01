import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Plus } from 'lucide-react'

import { BranchPicker } from '#/components/branch-picker'
import { IndexProgressDialog } from '#/components/index-progress-dialog'
import { OpenaiKeyDialog } from '#/components/openai-key-dialog'
import { RepoPicker } from '#/components/repo-picker'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Label } from '#/components/ui/label'
import {
  listGithubBranchesFn,
  listGithubReposFn,
} from '#/server/api/github'
import { checkEmbeddingsAccessFn } from '#/server/api/embeddings'
import { createExperimentForRefFn } from '#/server/api/experiments'
import { ensureIndexedFn } from '#/server/api/indexing'
import type { Branch, Repo } from '#/lib/types'

export function CreateExperimentDialog({
  trigger,
  disabled,
}: {
  trigger?: React.ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [repo, setRepo] = useState<Repo | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [indexJobId, setIndexJobId] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<{
    repo: Repo
    branch: Branch
  } | null>(null)
  const [openaiKeyOpen, setOpenaiKeyOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setError(null)
    setReposLoading(true)
    listGithubReposFn()
      .then((rs) => setRepos(rs))
      .catch((e: Error) => setError(e.message))
      .finally(() => setReposLoading(false))
  }, [open])

  useEffect(() => {
    if (!repo) {
      setBranches([])
      return
    }
    setBranchesLoading(true)
    setBranches([])
    listGithubBranchesFn({ data: { org: repo.org, name: repo.name } })
      .then((bs) => {
        setBranches(bs)
        setBranch(bs.find((b) => b.name === repo.defaultBranch) ?? bs[0] ?? null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBranchesLoading(false))
  }, [repo])

  const reset = () => {
    setRepo(null)
    setBranch(null)
    setError(null)
    setCreating(false)
  }

  const [pendingIndexId, setPendingIndexId] = useState<string | null>(null)

  const goToExperiment = async (
    target: { repo: Repo; branch: Branch },
    indexId: string,
  ) => {
    // Always insert a fresh experiment row — clicking *Create* twice on the
    // same branch starts a new conversation. To resume an existing one,
    // use the home table.
    const { experimentId } = await createExperimentForRefFn({
      data: {
        org: target.repo.org,
        name: target.repo.name,
        ref: target.branch.name,
        indexId,
      },
    })
    setOpen(false)
    navigate({
      to: '/experiments/$experimentId',
      params: { experimentId },
    })
    reset()
  }

  const startIndexing = async (target: { repo: Repo; branch: Branch }) => {
    const result = await ensureIndexedFn({
      data: {
        org: target.repo.org,
        name: target.repo.name,
        ref: target.branch.name,
      },
    })
    if (result.status === 'ready') {
      await goToExperiment(target, result.indexId)
      return
    }
    setPendingTarget(target)
    setPendingIndexId(result.indexId)
    setIndexJobId(result.jobId)
    setOpen(false)
  }

  const onCreate = async () => {
    if (!repo || !branch) return
    setError(null)
    setCreating(true)
    try {
      // Gate: Codex JWT first; ask for OpenAI key only if it doesn't grant access.
      const access = await checkEmbeddingsAccessFn()
      if (!access.ready) {
        setPendingTarget({ repo, branch })
        setOpen(false)
        setOpenaiKeyOpen(true)
        return
      }
      await startIndexing({ repo, branch })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogTrigger asChild>
          {trigger ?? (
            <Button disabled={disabled}>
              <Plus className="size-4" />
              Create experiment
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New experiment</DialogTitle>
            <DialogDescription>
              Pick a repository and a branch. We'll clone it and build a
              semantic index (re-used across experiments at the same commit)
              before opening the goal-design chat.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                Repository
                {reposLoading && (
                  <Loader2 className="text-muted-foreground size-3 animate-spin" />
                )}
              </Label>
              <RepoPicker repos={repos} value={repo} onChange={setRepo} />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                Branch
                {branchesLoading && (
                  <Loader2 className="text-muted-foreground size-3 animate-spin" />
                )}
              </Label>
              <BranchPicker
                branches={branches}
                value={branch}
                onChange={setBranch}
                disabled={!repo}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't continue</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={!repo || !branch || creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create experiment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OpenaiKeyDialog
        open={openaiKeyOpen}
        onOpenChange={(o) => {
          setOpenaiKeyOpen(o)
          if (!o && !indexJobId) {
            setPendingTarget(null)
          }
        }}
        onReady={async () => {
          setOpenaiKeyOpen(false)
          if (pendingTarget) await startIndexing(pendingTarget)
        }}
      />

      <IndexProgressDialog
        open={Boolean(indexJobId)}
        jobId={indexJobId}
        repoLabel={
          pendingTarget
            ? {
                org: pendingTarget.repo.org,
                name: pendingTarget.repo.name,
                ref: pendingTarget.branch.name,
              }
            : { org: '', name: '', ref: '' }
        }
        onDone={() => {
          if (pendingTarget && pendingIndexId)
            void goToExperiment(pendingTarget, pendingIndexId)
          setIndexJobId(null)
          setPendingTarget(null)
          setPendingIndexId(null)
        }}
        onCancel={() => {
          setIndexJobId(null)
          setPendingTarget(null)
          setPendingIndexId(null)
        }}
      />
    </>
  )
}
