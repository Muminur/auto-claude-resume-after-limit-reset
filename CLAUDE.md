# Auto Claude Resume - Project Instructions

## Version Bump Policy

**IMPORTANT: Always bump the version after making code changes!**

When you modify any code files (`.js`, `.md` commands, etc.), you MUST:

1. Run the version bump script before committing:
   ```bash
   node scripts/bump-version.js        # Patch bump (1.2.4 -> 1.2.5)
   node scripts/bump-version.js minor  # Minor bump (1.2.4 -> 1.3.0)
   node scripts/bump-version.js major  # Major bump (1.2.4 -> 2.0.0)
   ```

2. Include the version files in your commit:
   ```bash
   git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
   ```

3. Or do it all in one command after your changes:
   ```bash
   node scripts/bump-version.js && git add -A && git commit -m "feat: Your change message"
   ```

### Why This Matters

- The plugin system uses version numbers to detect updates
- If version doesn't change, `/plugin update` won't see new code
- Users expect updates to be available immediately after pushing

### When to Use Each Bump Type

| Type | When to Use | Example |
|------|-------------|---------|
| `patch` | Bug fixes, doc updates, minor changes | 1.2.3 -> 1.2.4 |
| `minor` | New features, non-breaking changes | 1.2.3 -> 1.3.0 |
| `major` | Breaking changes, major rewrites | 1.2.3 -> 2.0.0 |

## Git Commit Rules

- NEVER mention "Claude", "AI", or "assistant" in commit messages
- NEVER add Claude as author or co-author
- Use conventional commit format: `type(scope): message`

## Key Files

- `.claude-plugin/plugin.json` - Plugin manifest with version
- `.claude-plugin/marketplace.json` - Marketplace listing with version
- `commands/*.md` - Slash command definitions
- `auto-resume-daemon.js` - Main daemon script
- `scripts/bump-version.js` - Version bump utility

## Testing Changes

After pushing changes:
1. Update marketplace cache: `cd ~/.claude/plugins/marketplaces/auto-claude-resume && git pull`
2. Run: `/plugin update auto-resume@auto-claude-resume`
3. Verify new version is installed
