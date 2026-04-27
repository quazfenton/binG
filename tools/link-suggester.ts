#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import dotenv from "dotenv";
import Fuse from "fuse.js";

dotenv.config();

const DOCS_ROOT = process.argv[2] || "docs";
const MANIFEST = path.join(DOCS_ROOT, "manifest.jsonl");
const OUT = path.join(DOCS_ROOT, "suggested-links.json");

console.log("Running lexical-only link suggestion");

async function readManifest(): Promise<any[]> {
  const raw = await fs.readFile(MANIFEST, "utf8");
  return raw.trim().split("\n").map(l => JSON.parse(l));
}

async function main() {
  const items = await readManifest();
  const fuse = new Fuse(items, {
    keys: ["title", "summary", "tags", "path"],
    threshold: 0.4,
    includeScore: true
  });

  const suggestions: any[] = [];
  
  for (const src of items) {
    const searchTerms = [
      src.summary || "",
      src.title || "",
      (src.tags || []).join(" ")
    ].join(" ");
    
    const results = fuse.search(searchTerms);
    
    const recs = results
      .filter(r => r.item.id !== src.id)
      .slice(0, 10)
      .map(r => {
        const srcTags = new Set(src.tags || []);
        const tgtTags = new Set(r.item.tags || []);
        const tagOverlap = [...srcTags].filter(t => tgtTags.has(t)).length;
        const tagScore = srcTags.size > 0 ? tagOverlap / srcTags.size : 0;
        
        const confidence = Math.min(1, (1 - (r.score || 0)) * 0.7 + tagScore * 0.3);
        
        return {
          from: src.id,
          to: r.item.id,
          title: r.item.title,
          path: r.item.path,
          confidence: Number(confidence.toFixed(3))
        };
      });

    suggestions.push({ source: src.id, suggestions: recs });
  }

  await fs.writeJSON(OUT, suggestions, { spaces: 2 });
  console.log("Wrote suggested links:", OUT);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});