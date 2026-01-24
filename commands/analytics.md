---
description: View rate limit analytics and predictions
---

# Auto-Resume Analytics

## Task: View Rate Limit Analytics

Shows rate limit statistics, usage patterns, and predictions based on historical data.

### Execute

Run this command to view analytics:

```bash
DAEMON_PATH=$(find ~/.claude/plugins/cache -name "auto-resume-daemon.js" 2>/dev/null | head -1) && node "$DAEMON_PATH" --analytics
```

### Analytics Output

The analytics report includes:

- **Rate Limit Events:** Total count and frequency
- **Average Wait Time:** Mean duration of rate limit periods
- **Peak Usage Times:** When rate limits occur most frequently
- **Recovery Patterns:** Time to reset analysis
- **Success Rate:** Percentage of successful auto-resumes
- **Session Statistics:** Active sessions and completion rates

### Example Output

```
=== AUTO-RESUME ANALYTICS ===

Rate Limit Events: 45
Average Wait Time: 3m 42s
Peak Usage: 2:00 PM - 5:00 PM
Success Rate: 98.2%
Total Sessions: 156
Active Sessions: 3

Last 7 Days Trend:
Mon: ████████░░ 12 events
Tue: ██████░░░░ 8 events
Wed: ███████░░░ 10 events
...
```

### Analytics Data Location

- **Linux/macOS:** `~/.claude/auto-resume/analytics.json`
- **Windows:** `%USERPROFILE%\.claude\auto-resume\analytics.json`

### Use Cases

- Identify peak usage patterns
- Plan development sessions around rate limit trends
- Monitor daemon effectiveness
- Debug recurring issues
