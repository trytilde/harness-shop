import { createServerFn } from '@tanstack/react-start'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'

import { getGithubAccessToken } from '#/server/oauth/github'
import type { Branch, Repo } from '#/lib/types'

async function octokit(): Promise<Octokit> {
  const token = await getGithubAccessToken()
  if (!token) throw new Error('GitHub is not connected.')
  return new Octokit({
    auth: token,
    userAgent: 'harness-experiment-runner',
  })
}

export const listGithubReposFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Repo[]> => {
    const oc = await octokit()
    const repos = await oc.paginate(oc.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: 'pushed',
      affiliation: 'owner,collaborator,organization_member',
    })
    return repos.map((r) => ({
      org: r.owner?.login ?? '',
      name: r.name,
      defaultBranch: r.default_branch ?? 'main',
      private: r.private,
      description: r.description ?? undefined,
    }))
  },
)

const repoArgs = z.object({
  org: z.string().min(1),
  name: z.string().min(1),
})

export const listGithubBranchesFn = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => repoArgs.parse(d))
  .handler(async ({ data }): Promise<Branch[]> => {
    const oc = await octokit()
    const branches = await oc.paginate(oc.repos.listBranches, {
      owner: data.org,
      repo: data.name,
      per_page: 100,
    })
    return branches.map((b) => ({
      name: b.name,
      commit: b.commit.sha,
      protected: b.protected ?? false,
    }))
  })
