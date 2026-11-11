// The API can open terminals, run git and read Claude transcripts, so only the
// local machine may use it. Three checks:
// - the server binds to 127.0.0.1 (see index.js), so other hosts can't connect;
// - the Host header must name the loopback interface, which blocks DNS rebinding
//   (evil.example resolving to 127.0.0.1 still sends "Host: evil.example");
// - a browser request must come from a loopback page: Origin, when present, must
//   be loopback, and Sec-Fetch-Site must not be cross-site. That blocks other web
//   pages open in your browser from calling the API.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

export function localOnly(req, res, next) {
  if (!LOOPBACK.has(hostnameOf(req.headers.host ?? ''))) {
    return res.status(403).json({ error: 'Forbidden host' });
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let ok = false;
    try { ok = LOOPBACK.has(new URL(origin).hostname); } catch {}
    if (!ok) return res.status(403).json({ error: 'Forbidden origin' });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: 'Forbidden cross-site request' });
  }
  next();
}

// A directory name under LOCAL_REPO_BASE: no separators, no "." or ".."
export function assertRepoName(name) {
  if (typeof name !== 'string' || !/^[\w.-]+$/.test(name) || /^\.{1,2}$/.test(name)) {
    throw new Error('Invalid repo name');
  }
}

// A git branch name that can't be read as an option or escape the worktrees dir
export function assertBranchName(name) {
  if (typeof name !== 'string' || !/^[\w][\w./-]*$/.test(name) || name.includes('..') ||
      name.endsWith('/') || name.endsWith('.lock') || name.length > 200) {
    throw new Error('Invalid branch name');
  }
}

// Environment for programs the server starts on your behalf (terminals, editors):
// the server's own credentials stay behind.
export function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)) delete env[key];
  }
  return env;
}
