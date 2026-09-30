export type ModelLinkParseResult = { source: { url: string } | { repo: string; revision?: string } } | { error: string };

const BAD_LINK = "That does not look like a Hugging Face model link.";

export function parseModelLink(text: string): ModelLinkParseResult {
  const value = text.trim();
  if (!value) return { error: "Paste a Hugging Face link first." };

  const fileMatch = value.match(/^https:\/\/huggingface\.co\/([^/?#]+)\/([^/?#]+)\/(?:resolve|blob)\/([^/?#]+)\/(.+\.gguf)(?:\?[^#]*)?(?:#.*)?$/i);
  if (fileMatch) {
    const [, owner, repo, revision, path] = fileMatch;
    return { source: { url: `https://huggingface.co/${owner}/${repo}/resolve/${revision}/${path}` } };
  }

  const webRepo = value.match(/^https:\/\/huggingface\.co\/([^/?#]+)\/([^/?#]+)(?:\/tree\/([^/?#]+))?\/?(?:\?[^#]*)?(?:#.*)?$/);
  const bareRepo = value.match(/^([^/\s?#]+)\/([^/\s?#]+)$/);
  const match = webRepo ?? bareRepo;
  if (match) {
    const [, owner, repo, revision] = match;
    return { source: { repo: `${owner}/${repo}`, ...(revision ? { revision } : {}) } };
  }
  return { error: BAD_LINK };
}

export function modelLinkName(parsed: Extract<ModelLinkParseResult, { source: unknown }>): string {
  if ("repo" in parsed.source) return parsed.source.repo;
  const pathname = new URL(parsed.source.url).pathname;
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  return filename.replace(/\.gguf$/i, "");
}
