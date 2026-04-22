// ─────────────────────────────────────────────────────────────────
// GitHub Deploy — commit files via the GitHub REST API.
//
// This is the server-side half of "Claude deploys to main without
// touching Jonathan's laptop." Given a set of {path, content}
// files and a commit message, it:
//
//   1. Reads the current tip of the target branch
//   2. Creates a blob per file
//   3. Builds a tree that merges those blobs into the existing tree
//   4. Creates a commit with that tree + the current tip as parent
//   5. Fast-forwards the branch ref to the new commit
//
// If the ref moved between steps 1 and 5 (a concurrent commit),
// GitHub rejects the PATCH with 422/409. We retry up to RETRY_MAX
// times, refreshing the parent SHA each time.
//
// Never logs the token. Never returns it in responses.
// ─────────────────────────────────────────────────────────────────

const RETRY_MAX = 3;

function authHeader(token) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agent-hq-deploy/1.0',
  };
}

/**
 * Fetch the SHA of a branch tip.
 */
async function getRefSha({ token, owner, repo, branch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const resp = await fetch(url, { headers: authHeader(token) });
  if (!resp.ok) throw new Error(`getRef(${branch}) → ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = await resp.json();
  return data.object.sha;
}

/**
 * Fetch the tree SHA for a commit.
 */
async function getCommitTreeSha({ token, owner, repo, commitSha }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const resp = await fetch(url, { headers: authHeader(token) });
  if (!resp.ok) throw new Error(`getCommit(${commitSha}) → ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = await resp.json();
  return data.tree.sha;
}

/**
 * Create a blob and return its SHA. Content is base64-encoded so we
 * can safely send binary or UTF-8 files through the API.
 */
async function createBlob({ token, owner, repo, content }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: Buffer.from(content, 'utf8').toString('base64'),
      encoding: 'base64',
    }),
  });
  if (!resp.ok) throw new Error(`createBlob → ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = await resp.json();
  return data.sha;
}

/**
 * Create a tree that layers the given file blobs on top of a base tree.
 * The tree only needs to list changed files — unchanged paths are
 * inherited from the base.
 */
async function createTree({ token, owner, repo, baseTreeSha, files }) {
  const tree = files.map(f => ({
    path: f.path,
    mode: f.mode || '100644',    // regular file
    type: 'blob',
    sha: f.sha,
  }));
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });
  if (!resp.ok) throw new Error(`createTree → ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = await resp.json();
  return data.sha;
}

/**
 * Create a commit object.
 */
async function createCommit({ token, owner, repo, message, treeSha, parentSha, author }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/commits`;
  const body = {
    message,
    tree: treeSha,
    parents: [parentSha],
  };
  if (author) {
    body.author = { name: author.name, email: author.email, date: new Date().toISOString() };
    body.committer = body.author;
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`createCommit → ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = await resp.json();
  return data.sha;
}

/**
 * Fast-forward a branch ref. Throws if force=false and the branch
 * moved since we last read it (concurrent commit race).
 */
async function updateRef({ token, owner, repo, branch, sha, force = false }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha, force }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const e = new Error(`updateRef → ${resp.status}: ${text}`);
    e.status = resp.status;
    e.body = text;
    throw e;
  }
  return await resp.json();
}

/**
 * Commit a set of files to a branch. Returns the new commit SHA.
 *
 * @param {object} opts
 * @param {string} opts.token  GitHub PAT with `repo` scope
 * @param {string} opts.owner  e.g. "jonathanwallacerealestate-sys"
 * @param {string} opts.repo   e.g. "jonathanwallace.ca"
 * @param {string} opts.branch e.g. "main"
 * @param {string} opts.message  commit message
 * @param {Array<{path:string, content:string, mode?:string}>} opts.files
 * @param {{name:string, email:string}} [opts.author]
 */
export async function commitFiles({
  token,
  owner,
  repo,
  branch = 'main',
  message,
  files,
  author,
}) {
  if (!token) throw new Error('commitFiles: token is required');
  if (!owner || !repo) throw new Error('commitFiles: owner and repo are required');
  if (!message) throw new Error('commitFiles: message is required');
  if (!Array.isArray(files) || files.length === 0) throw new Error('commitFiles: files is required and non-empty');

  // Step 1: create all blobs upfront (these don't race)
  const blobs = await Promise.all(
    files.map(f => createBlob({ token, owner, repo, content: f.content })
      .then(sha => ({ path: f.path, mode: f.mode, sha }))),
  );

  // Steps 2-5 race against concurrent commits. Retry with fresh parent on conflict.
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      const parentSha = await getRefSha({ token, owner, repo, branch });
      const baseTreeSha = await getCommitTreeSha({ token, owner, repo, commitSha: parentSha });
      const treeSha = await createTree({ token, owner, repo, baseTreeSha, files: blobs });
      const commitSha = await createCommit({ token, owner, repo, message, treeSha, parentSha, author });
      await updateRef({ token, owner, repo, branch, sha: commitSha, force: false });
      return { commitSha, attempts: attempt };
    } catch (err) {
      lastError = err;
      // Only retry on the ref-update conflict class of errors
      if (err.status !== 422 && err.status !== 409) break;
      // Small jittered backoff so we don't hammer on a persistent race
      await new Promise(r => setTimeout(r, 100 + Math.random() * 300));
    }
  }
  throw lastError;
}
