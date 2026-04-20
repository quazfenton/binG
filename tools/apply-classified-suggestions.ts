#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import simpleGit from "simple-git";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import Fuse from "fuse.js";
import levenshtein from "fast-levenshtein";

dotenv.config();

const DOCS_ROOT = process.argv[2] || "docs";
const SUGGESTED = path.join(DOCS_ROOT, "suggested-links.json");
const MANIFEST = path.join(DOCS_ROOT, "manifest.jsonl");
const THRESHOLD = Number(process.env.LINK_CONF_THRESHOLD || 0.7);
const DRY = process.env.DRY_RUN === "1" || process.argv.includes("--dry");
const BRANCH_PREFIX = process.env.BRANCH_PREFIX || "docs-suggested-links";
const COMMIT_MSG = process.env.COMMIT_MSG || "chore(docs): apply classified suggested links";
const PR_TITLE = process.env.PR_TITLE || "chore(docs): suggested doc relation updates (classified)";
const PR_BODY = process.env.PR_BODY || "Automated classification of suggested doc relations. Please review.";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.warn("GITHUB_TOKEN or GITHUB_REPOSITORY not set, running in local-only mode");
}

type Suggestion = { from: string; to: string; title: string; path: string; confidence: number };
type SuggestionGroup = { source: string; suggestions: Suggestion[] };

async function loadManifest() {
  const map: Record<string, any> = {};
  if (!await fs.pathExists(MANIFEST)) return map;
  const lines = (await fs.readFile(MANIFEST, "utf8")).trim().split("\n");
  for (const l of lines) {
    const j = JSON.parse(l);
    map[j.id] = j;
  }
  return map;
}

function heuristicsClassify(src: any, tgt: any, suggestion: Suggestion) {
  const srcPath = src.path || "";
  const tgtPath = tgt.path || "";
  const srcTitle = (src.title || "").toLowerCase();
  const tgtTitle = (tgt.title || "").toLowerCase();
  const conf = suggestion.confidence;

  const exampleKeywords = ["example", "sample", "demo", "guide", "howto", "tutorial", "playground"];
  const implKeywords = ["implement", "implementation", "api", "sdk", "client", "server", "adapter", "integration", "usage", "setup"];
  const dependsKeywords = ["depends", "dependency", "requires", "prereq", "prerequisite", "auth", "oauth", "db", "backend"];
  const referenceKeywords = ["reference", "glossary", "schema", "spec", "specification"];

  const containsAny = (s: string, arr: string[]) => Array.isArray(arr) && arr.some(k => s.includes(k));
  const pathContains = (s: string, substr: string) => s.includes(substr);
  const sameDir = path.dirname(srcPath) === path.dirname(tgtPath);
  const lev = levenshtein.get(srcTitle, tgtTitle);
  const levNorm = Math.max(0, 1 - lev / Math.max(srcTitle.length, tgtTitle.length, 1));

  if (containsAny(tgtTitle, exampleKeywords) || pathContains(tgtPath, "/examples/") || pathContains(tgtPath, "/demo/")) {
    return { type: "example-of", score: Math.min(1, conf * 0.95 + (sameDir ? 0.05 : 0) + levNorm * 0.1) };
  }
  if (containsAny(tgtTitle, implKeywords) || pathContains(tgtPath, "/modules/") || pathContains(tgtPath, "/api/") || pathContains(tgtPath, "/sdk/")) {
    return { type: "implements", score: Math.min(1, conf * 0.9 + levNorm * 0.05 + (sameDir ? 0.02 : 0)) };
  }
  if (containsAny(tgtTitle, dependsKeywords) || pathContains(tgtPath, "/prereq/") || pathContains(tgtPath, "/deps/")) {
    return { type: "depends-on", score: Math.min(1, conf * 0.9 + levNorm * 0.03) };
  }
  if (containsAny(tgtTitle, referenceKeywords) || pathContains(tgtPath, "/references/") || pathContains(tgtPath, "/ref/") || pathContains(tgtPath, "/glossary")) {
    return { type: "reference", score: Math.min(1, conf * 0.9 + levNorm * 0.02) };
  }

  if (levNorm > 0.85 || srcTitle.includes(tgtTitle) || tgtTitle.includes(srcTitle)) {
    return { type: "duplicate", score: Math.min(1, conf * 0.9 + levNorm * 0.15) };
  }

  return { type: "related", score: Math.min(1, conf * 0.8 + levNorm * 0.02) };
}

async function main() {
  if (!await fs.pathExists(SUGGESTED)) {
    console.error("Missing suggested-links.json at", SUGGESTED);
    process.exit(1);
  }
  const suggested: SuggestionGroup[] = await fs.readJSON(SUGGESTED);
  const manifest = await loadManifest();

  const changes: { file: string; orig: string; new: string; }[] = [];

  for (const group of suggested) {
    const srcId = group.source;
    const srcMeta = manifest[srcId];
    if (!srcMeta) continue;
    const srcPath = path.join(DOCS_ROOT, srcMeta.path);
    if (!await fs.pathExists(srcPath)) continue;
    const raw = await fs.readFile(srcPath, "utf8");
    const parsed = matter(raw);
    const fm = parsed.data || {};
    fm.relations = fm.relations || [];

    let modified = false;

    for (const s of group.suggestions.filter(x => x.confidence >= 0.25)) {
      const tgtMeta = manifest[s.to] || { id: s.to, path: s.path, title: s.title, summary: "" };
      const classification = heuristicsClassify(srcMeta, tgtMeta, s);
      if (classification.score < THRESHOLD) continue;

      const exists = (fm.relations as any[]).some((r: any) => r.id === s.to && r.type === classification.type);
      if (exists) continue;

      const relEntry = {
        type: classification.type,
        id: s.to,
        title: tgtMeta.title || s.title,
        path: tgtMeta.path || s.path,
        confidence: Number(s.confidence.toFixed(3)),
        classified_score: Number(classification.score.toFixed(3)),
        auto_generated: true,
        generator: "apply-classified-suggestions"
      };
      fm.relations.push(relEntry);
      modified = true;
    }

    if (!modified) continue;

    const newContent = matter.stringify(parsed.content, fm);
    changes.push({ file: srcPath, orig: raw, new: newContent });
  }

  if (changes.length === 0) {
    console.log("No changes passed threshold. Exiting.");
    process.exit(0);
  }

  if (!GITHUB_TOKEN || DRY) {
    for (const c of changes) {
      await fs.writeFile(c.file, c.new, "utf8");
      console.log("Updated:", path.relative(DOCS_ROOT, c.file));
    }
    console.log(`\nUpdated ${changes.length} files in dry-run/local mode`);
    return;
  }

  const git = simpleGit();
  const authorName = process.env.GIT_USER_NAME || "docs-bot";
  const authorEmail = process.env.GIT_USER_EMAIL || "docs-bot@users.noreply.github.com";
  await git.addConfig("user.name", authorName);
  await git.addConfig("user.email", authorEmail);

  const [owner, repo] = (GITHUB_REPOSITORY || "").split("/");
  const branch = `${BRANCH_PREFIX}-${Date.now()}`;

  await git.checkoutLocalBranch(branch);
  for (const c of changes) {
    await fs.writeFile(c.file, c.new, "utf8");
    await git.add(c.file);
  }
  await git.commit(COMMIT_MSG);

  const remote = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`;
  await git.addRemote("auto-apply", remote).catch(() => { });
  await git.push(["-u", "auto-apply", branch]);

  const oct = new Octokit({ auth: GITHUB_TOKEN });
  const pr = await oct.pulls.create({
    owner, repo,
    head: branch,
    base: process.env.BASE_BRANCH || "main",
    title: PR_TITLE,
    body: PR_BODY
  });
  console.log("PR created:", pr.data.html_url);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});