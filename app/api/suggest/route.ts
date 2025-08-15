import { NextRequest, NextResponse } from "next/server";

// Simple rule-based suggester for demo purposes.
// Returns only the suffix to append to the provided prefix.
function suggestSuffix(prefix: string): string {
  const p = prefix.trim();
  if (!p) return "";

  // Some canned completions by common starters
  const rules: Array<[RegExp, string]> = [
    [/^create\s+a?\s*$/i, "React component with TypeScript"],
    [/^build\s+a?\s*$/i, "REST API with Node.js and Express"],
    [/^write\s+a?\s*$/i, "short story about an unexpected hero"],
    [/^explain\s+/i, "quantum computing simply"],
    [/^design\s+a?\s*$/i, "responsive CSS layout with Flexbox"],
    [/^plan\s+a?\s*$/i, "workout routine for beginners"],
    [/^implement\s+/i, "authentication with JWT tokens"],
  ];

  for (const [re, completion] of rules) {
    if (re.test(p)) {
      // Return only the part not already typed (suffix)
      const lowerP = p.toLowerCase();
      const lowerC = completion.toLowerCase();
      if (lowerC.startsWith(lowerP)) {
        return completion.slice(p.length);
      }
      return completion;
    }
  }

  // Simple heuristic: if sentence seems incomplete, finish it politely
  if (!/[.!?]$/.test(p)) {
    return " with more details, please";
  }

  return "";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  // latency hint for debounced UX; keep quick
  const suggestion = suggestSuffix(q);
  return NextResponse.json({ suggestion });
}

