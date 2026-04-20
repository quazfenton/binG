## Dynamic Skill Injection

    **Skills are injected as user messages, not system prompts.** This preserves prompt caching — the model doesn't have to rebuild its entire context when a skill loads. When you call `/skill <name>` or use `skill_view()`, Hermes fetches the skill's SKILL.md content and injects it as a user message right before the next model call.

    **The detection happens in two ways:**

    1. **Explicit loading** - You trigger it with `/skill <name>` or `skill_view()` calls. Hermes immediately fetches and injects the skill content.

    2. **Automatic relevance detection** - When you ask about a topic that matches a skill's description/tags, Hermes can proactively suggest loading it. The skill registry maintains metadata (tags, descriptions, related skills) that Hermes scans against your current context.

    ## How It Works Under the Hood

    The skill system is built into the agent's message loop. When you load a skill:

    1. Hermes reads the SKILL.md file (YAML frontmatter + markdown body)
    2. Injects it as a user message: `{"role": "user", "content": "[SKILL_CONTENT]"}`
    3. The next model call includes this context, so the model can reference the skill's procedures

    **Key design choice:** Skills don't permanently alter the system prompt. They're contextual — loaded when needed, discarded when the session ends (unless you save them to memory). This keeps the core prompt stable while allowing specialized knowledge to be available on-demand.

    The skill registry also supports categories and related skills, so Hermes can suggest related procedures when you're working in a particular domain.
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
────────────────────────────────────────


    ## YAML Frontmatter Structure

    The YAML frontmatter in SKILL.md files looks like this:

    ```yaml
    ---
    name: hermes-agent
    description: Complete guide to using and extending Hermes Agent — CLI usage, setup, configuration, spawning additional agents, gateway platforms, skills, voice, tools, profiles, and a concise contributor reference. Load this skill when helping users configure Hermes, troubleshoot issues, spawn agent instances, or make code contributions.
    version: 2.0.0
    author: Hermes Agent + Teknium
    license: MIT
    metadata:
      hermes:
        tags: [hermes, setup, configuration, multi-agent, spawning, cli, gateway, development]
        homepage: https://github.com/NousResearch/hermes-agent
        related_skills: [claude-code, codex, opencode]
    ---
    ```

    **Required fields:** `name`, `description`, `version`, `author`, `license`
    **Optional structured metadata:** The `metadata.hermes` section with `tags`, `homepage`, `related_skills`

    ## Why YAML Frontmatter > Plain .md

    **1. Structured data extraction**
    - YAML provides machine-readable metadata (tags, versions, relationships)
    - The agent can programmatically filter, search, and categorize skills
    - Without YAML, you'd need to parse the entire markdown file to extract this info

    **2. Version control and dependency tracking**
    - `version` field enables update detection and compatibility checking
    - `related_skills` creates explicit dependency graphs
    - Plain .md files can't express these relationships

    **3. Tooling integration**
    - The skill registry automatically parses YAML for indexing
    - Search functions can filter by tags, authors, or versions
    - CLI tools can display structured skill information

    ## .md vs JSON for AI Ingestion

    **.md files are actually better for AI ingestion than JSON** for several reasons:

    **1. Natural language flow**
    - Markdown preserves the author's intended structure (headers, lists, code blocks)
    - AI models are trained on natural text, not JSON schemas
    - The content flows more naturally in context

    **2. Rich formatting support**
    - Headers (`#`, `##`) create clear sections
    - Code blocks (```) preserve syntax highlighting context
    - Lists (`-`, `1.`) provide structured information
    - Bold/italic emphasize key points

    **3. Context preservation**
    - The YAML frontmatter separates metadata from content
    - The markdown body contains the actual procedural knowledge
    - JSON would require either flattening everything or creating nested structures that lose the narrative flow

    **4. Human readability**
    - Authors can write and edit markdown more naturally
    - The same file works for both humans and AI
    - No need to maintain separate documentation formats

    The YAML frontmatter + markdown body pattern is essentially a hybrid approach: structured metadata for machine processing, natural language content for AI understanding. It's the best of both worlds.
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
● if i define a capabilities list of (commands such as read_file) in typescript file capabilities.ts is this equal to or worse than yaml approach  .
2. how to avoid context enlargement from constant skills files ingestion

────────────────────────────────────────


    ## Capabilities.ts vs YAML Frontmatter

    **Capabilities.ts approach is worse than YAML frontmatter** for several reasons:

    **1. Separation of concerns**
    - YAML frontmatter keeps metadata with the content it describes
    - `capabilities.ts` creates a separate mapping file that can drift out of sync
    - If you update a skill's description but forget to update the TypeScript file, you get inconsistencies

    **2. Tool integration**
    - The skill registry automatically parses YAML at load time
    - TypeScript would require a separate build step or runtime parsing
    - No native tooling support for capability definitions

    **3. Portability**
    - YAML is human-readable and editable without TypeScript knowledge
    - Non-developers can update skill metadata
    - `capabilities.ts` requires TypeScript toolchain

    **4. Schema validation**
    - YAML frontmatter can be validated against a schema
    - TypeScript types don't enforce the same runtime constraints
    - The skill system expects YAML format for consistency

    ## Avoiding Context Enlargement from Constant Skill Ingestion

    **The key is selective loading, not constant ingestion.** Here are the strategies:

    ### 1. Skill Loading Patterns
    ```yaml
    # Load only when explicitly requested
    /skill <name>  # Manual trigger

    # Auto-suggest based on context (but don't auto-load)
    If user mentions "setup" and there's a setup skill → suggest loading it
    ```

    ### 2. Context Compression
    ```yaml
    # The agent automatically compresses when approaching token limits
    compression:
      enabled: true
      threshold: 0.50      # Start compressing at 50% of context
      target_ratio: 0.20   # Compress down to 20% of original
    ```

    ### 3. Skill Design Principles
    ```yaml
    # Keep skills focused and modular
    name: database-setup
    description: Setup PostgreSQL database with Docker
    # NOT: name: all-database-knowledge  # Too broad

    # Use references instead of embedding everything
    references:
      - postgresql-commands.md
      - docker-cheatsheet.md
    ```

    ### 4. Session Management
    ```yaml
    # Skills are session-scoped
    - Loaded when requested
    - Discarded on /reset or session end
    - Only persist to memory if explicitly saved
    ```

    ### 5. Skill Registry Optimization
    ```yaml
    # Index skills by tags, not load all content
    registry:
      by_tag: { setup: [skill1, skill2], database: [skill3] }
      by_name: { "skill-name": skill-content }
    ```

    **The pattern:** Load skills on-demand, keep them focused, use compression, and let the agent manage context automatically. The YAML frontmatter approach actually helps with this because the metadata is lightweight — you can scan tags and descriptions without loading the full markdown content until needed.