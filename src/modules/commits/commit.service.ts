import { createLogger } from "@shared/logger/logger";

import type { CommitData, CommitRepository } from "./commit.repository";

const logger = createLogger("commit-service");

interface GitHubCommit {
  id: string;
  message: string;
  author: { name: string };
  url: string;
  timestamp: string;
}

interface GitHubPushPayload {
  ref: string;
  repository: { full_name: string };
  commits: GitHubCommit[];
}

export class CommitService {
  constructor(private commitRepository: CommitRepository) {}

  async processGitHubPush(payload: GitHubPushPayload): Promise<number> {
    const branch = payload.ref.replace("refs/heads/", "");
    const repository = payload.repository.full_name;

    const commits: CommitData[] = payload.commits.map((c) => ({
      sha: c.id,
      message: c.message,
      author: c.author.name,
      url: c.url,
      repository,
      branch,
      timestamp: new Date(c.timestamp)
    }));

    if (commits.length === 0) return 0;

    const result = await this.commitRepository.createMany(commits);
    logger.info(`Saved ${result.count} commits from ${repository}@${branch}`);
    return result.count;
  }
}
