import { z } from "zod";
import type { GithubRepoInfo } from "@bb/server-contract";
import { ApiError } from "../../errors.js";

const GITHUB_REPOS_PER_PAGE = 100;
const GITHUB_OWNER_REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

const githubHeaders = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: "application/vnd.github+json",
});

const githubRepoResponseItemSchema = z.object({
  full_name: z.string(),
  html_url: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
});

function mapGithubRepos(
  items: z.infer<typeof githubRepoResponseItemSchema>[],
): GithubRepoInfo[] {
  return items.map((r) => ({
    fullName: r.full_name,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch,
    private: r.private,
  }));
}

function parseGithubResponse(data: unknown): GithubRepoInfo[] {
  try {
    return mapGithubRepos(z.array(githubRepoResponseItemSchema).parse(data));
  } catch {
    throw new ApiError(
      502,
      "upstream_error",
      "Unexpected response from GitHub API",
    );
  }
}

/**
 * Extract "owner/repo" from a GitHub URL or owner/repo string.
 * Only allows characters valid in GitHub owner/repo names.
 */
export function parseRepoRef(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch =
    /^https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+?)(?:\.git)?(?:\/.*)?$/.exec(
      trimmed,
    );
  if (urlMatch) return urlMatch[1];
  if (GITHUB_OWNER_REPO_PATTERN.test(trimmed)) return trimmed;
  return null;
}

async function fetchGithubRepoByRef(
  pat: string,
  ownerRepo: string,
): Promise<GithubRepoInfo[]> {
  const res = await fetch(`https://api.github.com/repos/${ownerRepo}`, {
    headers: githubHeaders(pat),
  });
  if (res.status === 404 || res.status === 403) return [];
  if (!res.ok) {
    throw new ApiError(
      502,
      "upstream_error",
      `GitHub API returned ${res.status}`,
    );
  }
  try {
    const item = githubRepoResponseItemSchema.parse(await res.json());
    return mapGithubRepos([item]);
  } catch {
    throw new ApiError(
      502,
      "upstream_error",
      "Unexpected response from GitHub API",
    );
  }
}

async function fetchGithubUserRepos(pat: string): Promise<GithubRepoInfo[]> {
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=${GITHUB_REPOS_PER_PAGE}&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: githubHeaders(pat) },
  );
  if (!res.ok) {
    throw new ApiError(
      502,
      "upstream_error",
      `GitHub API returned ${res.status}`,
    );
  }
  return parseGithubResponse(await res.json());
}

export async function fetchGithubRepos(
  pat: string,
  query: string | undefined,
): Promise<GithubRepoInfo[]> {
  // Direct lookup for URLs or owner/repo references.
  if (query) {
    const repoRef = parseRepoRef(query);
    if (repoRef) {
      return fetchGithubRepoByRef(pat, repoRef);
    }
  }

  // Fetch the user's repos and filter server-side if a query is provided.
  const repos = await fetchGithubUserRepos(pat);
  if (!query) return repos;
  const q = query.toLowerCase();
  return repos.filter((r) => r.fullName.toLowerCase().includes(q));
}
