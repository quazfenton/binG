#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import slugify from "slugify";

type DocRecord = {
  id: string;
  path: string;
  title: string;
  summary: string;
  tags: string[];
  layer: string;
  anchors: { id: string; heading: string }[];
  aliases?: string[];
};

const DOCS_ROOT = process.argv[2] || "docs";
const OUT_MANIFEST = path.join(DOCS_ROOT, "manifest.jsonl");

async function readMd(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  return { raw, parsed };
}

function makeSlug(title: string, relDir: string) {
  const base = slugify(title, { lower: true, strict: true });
  return path.join(relDir, base).replace(/\\/g, "/");
}

function extractHeadings(raw: string) {
  const headings: { id: string; heading: string }[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    const m = line.match(/^#{2,4}\s+(.*)/);
    if (m) {
      const heading = m[1].trim();
      const id = slugify(heading, { lower: true, strict: true });
      headings.push({ id, heading });
    }
  }
  return headings;
}

function inferLayer(relPath: string) {
  if (relPath.includes("/onboarding/")) return "onboarding";
  if (relPath.includes("/examples/")) return "example";
  if (relPath.includes("/references/")) return "reference";
  if (relPath.includes("/guides/")) return "guide";
  return "core";
}

function inferTags(relPath: string, title: string): string[] {
  const tags: string[] = [];
  const lowerTitle = title.toLowerCase();
  const lowerPath = relPath.toLowerCase();

  if (lowerPath.includes("/spawn/") || lowerTitle.includes("agent")) tags.push("agent", "spawn");
  if (lowerPath.includes("/skills/") || lowerTitle.includes("skill")) tags.push("skills");
  if (lowerPath.includes("/sdk/") || lowerTitle.includes("sdk")) tags.push("sdk");
  if (lowerTitle.includes("streaming")) tags.push("streaming");
  if (lowerTitle.includes("terminal") || lowerTitle.includes("pipe")) tags.push("terminal");
  if (lowerTitle.includes("websocket")) tags.push("websocket");
  if (lowerTitle.includes("oauth") || lowerTitle.includes("auth")) tags.push("auth");
  if (lowerTitle.includes("v2") || lowerTitle.includes("version 2")) tags.push("v2");
  if (lowerTitle.includes("implementation") || lowerTitle.includes("summary")) tags.push("implementation");
  if (lowerTitle.includes("guide") || lowerTitle.includes("how-to")) tags.push("guide");
  if (lowerTitle.includes("review") || lowerTitle.includes("fix")) tags.push("review");
  if (lowerTitle.includes("architecture")) tags.push("architecture");

  return [...new Set(tags)];
}

function generateLLMFriendlyTitle(title: string, relPath: string): string {
  const parts: string[] = [];
  
  const dirMatch = relPath.match(/docs\/([^\/]+)/);
  if (dirMatch) {
    parts.push(dirMatch[1]);
  }

  const cleanTitle = title
    .replace(/^[-_]*/, "")
    .replace(/[-_]*$/, "")
    .replace(/[_\.]/g, " ");
  
  const words = cleanTitle.split(/\s+/).filter(w => w.length > 0);
  
  if (words.length > 0 && !words[0].toLowerCase().includes(parts[0]?.toLowerCase() || "")) {
    parts.push(...words.slice(0, 4));
  } else {
    parts.push(...words);
  }

  return parts.join(" ").substring(0, 80);
}

async function processFile(absPath: string, relPath: string): Promise<DocRecord | null> {
  if (!relPath.endsWith(".md")) return null;
  if (relPath.includes("node_modules") || relPath.includes(".git")) return null;
  
  const { raw, parsed } = await readMd(absPath);
  const front = parsed.data || {};
  let title = front.title || "";
  
  if (!title) {
    const m = raw.match(/^#\s+(.+)/m);
    title = m ? m[1].trim() : path.basename(relPath, ".md");
  }

  const originalFilename = path.basename(relPath, ".md");
  const llmFriendlyTitle = generateLLMFriendlyTitle(title, relPath);
  const slug = makeSlug(llmFriendlyTitle, path.dirname(relPath));
  const newFilename = slug + ".md";
  const newAbs = path.join(DOCS_ROOT, newFilename);

  front.id = front.id || slug.replace(/\//g, "-");
  front.title = title;
  front.aliases = Array.from(new Set([...(front.aliases || []), originalFilename, path.basename(relPath)]));
  front.tags = front.tags || inferTags(relPath, title);
  front.layer = front.layer || inferLayer(relPath);

  const body = parsed.content || "";
  const firstPara = body.split("\n\n").find(p => p.trim().length > 20) || "";
  front.summary = front.summary || firstPara.slice(0, 300).trim();

  const anchors = extractHeadings(body);
  front.anchors = anchors.map(a => a.heading);

  if (path.join(DOCS_ROOT, relPath) !== newAbs) {
    await fs.ensureDir(path.dirname(newAbs));
    const newContent = matter.stringify(body, front);
    await fs.writeFile(newAbs, newContent, "utf8");
    console.log(`Renamed: ${relPath} -> ${newFilename}`);
  } else {
    const newContent = matter.stringify(body, front);
    await fs.writeFile(absPath, newContent, "utf8");
    console.log(`Updated: ${relPath}`);
  }

  return {
    id: front.id,
    path: newFilename,
    title: front.title,
    summary: front.summary || "",
    tags: front.tags,
    layer: front.layer,
    anchors,
    aliases: front.aliases
  };
}

async function walkDocs() {
  const files: string[] = [];
  
  async function walk(dir: string) {
    const items = await fs.readdir(dir);
    for (const it of items) {
      const p = path.join(dir, it);
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        await walk(p);
      } else {
        files.push(p);
      }
    }
  }
  
  await walk(DOCS_ROOT);
  
  const records: DocRecord[] = [];
  for (const f of files) {
    const rel = path.relative(DOCS_ROOT, f).replace(/\\/g, "/");
    const rec = await processFile(f, rel);
    if (rec) records.push(rec);
  }

  const out = records
    .map(r => JSON.stringify({
      id: r.id,
      path: r.path,
      title: r.title,
      summary: r.summary,
      tags: r.tags,
      layer: r.layer,
      anchors: r.anchors,
      aliases: r.aliases
    }))
    .join("\n") + "\n";
  
  await fs.writeFile(OUT_MANIFEST, out, "utf8");
  console.log(`\nWrote manifest: ${OUT_MANIFEST}`);
  console.log(`Total docs processed: ${records.length}`);
}

walkDocs().catch(err => {
  console.error(err);
  process.exit(1);
});
