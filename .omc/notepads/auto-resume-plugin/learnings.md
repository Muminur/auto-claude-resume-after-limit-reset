# Learnings - AutoClaudeResume Plugin

## Analytics Collector Module

### Implementation Approach
- **Date**: 2026-01-24
- **Module**: src/modules/analytics-collector.js

### Key Design Decisions

1. **Concurrent Write Protection**
   - Uses Promise chaining (`this.writeLock`) to serialize writes
   - Atomic writes via temp file + rename pattern
   - Prevents race conditions when multiple events occur simultaneously

2. **Data Structure**
   - Simple JSON file storage at `~/.claude/auto-resume/analytics.json`
   - Three main data types:
     - Rate limit events (timestamp, resetTime, duration, session)
     - Resume events (timestamp, session, success)
     - Metadata (version)

3. **Statistical Analysis**
   - Rolling time windows (7 days, 30 days, all-time)
   - Hourly and daily aggregations for pattern detection
   - Peak usage detection (both hourly and daily)
   - Average wait time calculations

4. **Prediction Algorithm**
   - Uses interval-based prediction (time between rate limits)
   - Confidence scoring based on coefficient of variation
   - Requires at least 2 data points for meaningful predictions
   - Categories: high (<20% CV), medium (<50% CV), low (>=50% CV)

5. **Data Retention**
   - Configurable retention period (default: 30 days)
   - Automatic cleanup method to remove old data
   - Prevents unbounded growth of analytics file

### Best Practices Observed

1. **Timestamp Normalization**
   - Supports Date objects, strings, and numeric timestamps
   - Internally stores as milliseconds since epoch
   - Consistent handling across all methods

2. **Error Handling**
   - Graceful fallback when data file is missing or corrupt
   - Console logging for errors (not throwing, to avoid crashing plugin)
   - Safe JSON parsing with try-catch blocks

3. **API Design**
   - Async methods for all write operations
   - Synchronous methods for read-only operations (getStatistics, getPrediction)
   - Export methods provide both object and JSON string formats

### Testing Results

- Successfully records rate limit and resume events
- Correctly calculates statistics for different time periods
- Prediction algorithm works with minimal data
- Export functionality produces valid JSON
- Module loads without syntax errors

### Integration Points

- Designed to work with ConfigManager (retentionDays from config)
- Compatible with existing module pattern (native fs, no external deps)
- File path follows plugin conventions (~/.claude/auto-resume/)
