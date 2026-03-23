# Phase 1: Model Ranking + Fast Model Selection

## Overview

Phase 1 implements telemetry-based model ranking to automatically select the fastest/most reliable models for spec generation and other latency-sensitive tasks.

## Files Created/Modified

### New Files

1. **`lib/models/model-ranker.ts`** - Core ranking engine
   - `scoreModel()` - Calculate composite score (latency + failure rate)
   - `rankModels()` - Rank all models by score
   - `getFastestModel()` - Get fastest model
   - `getBestModelForUseCase()` - Get best model for speed/reliability/balanced
   - `getModelStatsFromTelemetry()` - Get stats from existing telemetry
   - `getSpecGenerationModel()` - Get recommended model for spec gen
   - `exportTelemetryData()` - Export for external analysis

2. **`scripts/export-model-telemetry.ts`** - Export script
   - Exports JSON + CSV to `data/model-telemetry.json`
   - Run with: `pnpm export-telemetry`

### Modified Files

1. **`lib/chat/chat-request-logger.ts`**
   - Added `getModelPerformance()` method
   - Returns per-model metrics from last N minutes

2. **`package.json`**
   - Added `export-telemetry` script

## Integration with Existing Telemetry

The model ranker leverages your **existing telemetry infrastructure**:

| Source | File | Data Provided |
|--------|------|---------------|
| **Chat Request Logger** | `lib/chat/chat-request-logger.ts` | Per-model latency, failures, success rate |
| **Resource Telemetry** | `lib/management/resource-telemetry.ts` | Per-provider latency, queue depth, active requests |
| **Response Router Telemetry** | `lib/api/response-router-telemetry.ts` | OpenTelemetry integration |

## Scoring Algorithm

```typescript
score = (normalizedLatency * 0.6 + failureRate * 0.4) * staleFactor

where:
- normalizedLatency = min(avgLatency / 10000, 1)  // 0-1 scale (max 10s)
- failureRate = failures / totalCalls  // 0-1 scale
- staleFactor = 1.2 if data > 10min old, else 1.0
```

**Lower score = better** (faster + more reliable)

## Usage Examples

### Get Fastest Model

```typescript
import { getFastestModel, getModelStatsFromTelemetry } from '@/lib/models/model-ranker'

const stats = await getModelStatsFromTelemetry()
const fastest = getFastestModel(stats)

console.log(`Fastest model: ${fastest.provider}:${fastest.model}`)
console.log(`Avg latency: ${fastest.avgLatency}ms`)
console.log(`Failure rate: ${(fastest.failureRate * 100).toFixed(1)}%`)
```

### Get Best Model for Use Case

```typescript
import { getBestModelForUseCase } from '@/lib/models/model-ranker'

// For spec generation (prioritize speed)
const speedModel = getBestModelForUseCase(stats, 'speed')

// For production code (prioritize reliability)
const reliableModel = getBestModelForUseCase(stats, 'reliability')

// Balanced approach
const balancedModel = getBestModelForUseCase(stats, 'balanced')
```

### Export Telemetry Data

```bash
# Export to data/model-telemetry.json
pnpm export-telemetry

# Output example:
# 📊 Exporting model telemetry...
# ✅ Telemetry exported to /path/to/data/model-telemetry.json
# 📈 Total models: 15
# 🏆 Top 3 fastest models:
#    1. openrouter:nvidia/nemotron-3-nano-30b-a3b:free (234ms, 0.5% fail rate)
#    2. google:gemini-2.5-flash (412ms, 0.2% fail rate)
#    3. openrouter:meta-llama/llama-3.3-70b-instruct:free (567ms, 1.1% fail rate)
```

## Export Data Format

### JSON (`data/model-telemetry.json`)

```json
{
  "timestamp": 1709876543210,
  "models": [
    {
      "provider": "google",
      "model": "gemini-2.5-flash",
      "avgLatency": 412,
      "failureRate": 0.002,
      "lastUpdated": 1709876540000,
      "totalCalls": 156,
      "successRate": 0.998
    }
  ],
  "ranked": [
    {
      "provider": "openrouter",
      "model": "nvidia/nemotron-3-nano-30b-a3b:free",
      "avgLatency": 234,
      "failureRate": 0.005,
      "lastUpdated": 1709876540000,
      "totalCalls": 89,
      "successRate": 0.995,
      "score": 0.145,
      "rank": 1
    }
  ]
}
```

### CSV (`data/model-telemetry.csv`)

```csv
rank,provider,model,avgLatency,failureRate,totalCalls,successRate,score,lastUpdated
1,openrouter,nvidia/nemotron-3-nano-30b-a3b:free,234,0.0050,89,0.9950,0.1450,2025-03-22T10:42:20.000Z
2,google,gemini-2.5-flash,412,0.0020,156,0.9980,0.2512,2025-03-22T10:42:20.000Z
```

## Configuration

### Scoring Weights

Edit `lib/models/model-ranker.ts`:

```typescript
const FAILURE_WEIGHT = 2.5  // Higher = failures penalized more
const STALENESS_PENALTY = 1.2  // Higher = old data penalized more
const MAX_AGE_MS = 1000 * 60 * 10  // 10 minutes
const LATENCY_WEIGHT = 0.6  // Must sum to 1.0 with FAILURE_WEIGHT_SCORE
const FAILURE_WEIGHT_SCORE = 0.4
```

### Data Freshness

```typescript
// Get stats from last N minutes
const stats = await getModelStatsFromTelemetry()  // Default: 10 min

// Export with custom cutoff
const data = await exportTelemetryData()  // Uses default 10 min
```

## Next Steps (Phase 2)

1. **Spec Generator Prompt** - Create `lib/prompts/spec-generator.ts`
2. **Spec Parser** - Create `lib/chat/spec-parser.ts`
3. **Refinement Engine** - Create `lib/chat/refinement-engine.ts`
4. **Response Router Integration** - Modify `lib/api/response-router.ts`
5. **API Route Integration** - Modify `app/api/chat/route.ts`

## Troubleshooting

### No Models Returned

```typescript
// Check if telemetry data exists
const stats = await getModelStatsFromTelemetry()
console.log(stats.length)  // Should be > 0

// If 0, make some test requests first
```

### Stale Data

```bash
# Export telemetry to check data freshness
pnpm export-telemetry

# Check lastUpdated timestamps
cat data/model-telemetry.json | jq '.ranked[].lastUpdated'
```

### Database Issues

```typescript
// Check if chat logger DB is initialized
import { chatRequestLogger } from '@/lib/chat/chat-request-logger'

const db = (chatRequestLogger as any).db
console.log('DB available:', !!db)  // Should be true
```

## Testing

```typescript
import {
  rankModels,
  getFastestModel,
  getBestModelForUseCase,
  getModelStatsFromTelemetry,
} from '@/lib/models/model-ranker'

// Test ranking
const stats = await getModelStatsFromTelemetry()
const ranked = rankModels(stats)
console.log('Top model:', ranked[0])

// Test use case selection
const speed = getBestModelForUseCase(stats, 'speed')
const reliable = getBestModelForUseCase(stats, 'reliability')
console.log('Speed:', speed.model)
console.log('Reliable:', reliable.model)
```
