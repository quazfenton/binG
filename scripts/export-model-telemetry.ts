/**
 * Export Model Telemetry for External Ranking
 * 
 * Outputs JSON file with model performance data
 * Can be consumed by external ranking process
 * 
 * Usage:
 *   pnpm tsx scripts/export-model-telemetry.ts
 * 
 * Output: data/model-telemetry.json
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { exportTelemetryData, rankModels } from '@/lib/models/model-ranker'

async function exportTelemetry() {
  console.log('📊 Exporting model telemetry...')
  
  try {
    const data = await exportTelemetryData()
    
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    
    // Write to file
    const outputPath = join(dataDir, 'model-telemetry.json')
    writeFileSync(
      outputPath,
      JSON.stringify(data, null, 2)
    )
    
    console.log(`✅ Telemetry exported to ${outputPath}`)
    console.log(`📈 Total models: ${data.models.length}`)
    console.log(`🏆 Top 3 fastest models:`)
    
    data.ranked.slice(0, 3).forEach((model, index) => {
      console.log(`   ${index + 1}. ${model.provider}:${model.model} (${model.avgLatency}ms, ${(model.failureRate * 100).toFixed(1)}% fail rate)`)
    })
    
    // Also export CSV for easier analysis
    const csvPath = join(dataDir, 'model-telemetry.csv')
    const csvHeader = 'rank,provider,model,avgLatency,failureRate,totalCalls,successRate,score,lastUpdated'
    const csvRows = data.ranked.map(m => 
      `${m.rank},${m.provider},${m.model},${m.avgLatency},${m.failureRate.toFixed(4)},${m.totalCalls},${m.successRate.toFixed(4)},${m.score.toFixed(4)},${new Date(m.lastUpdated).toISOString()}`
    )
    
    writeFileSync(
      csvPath,
      [csvHeader, ...csvRows].join('\n')
    )
    
    console.log(`📄 CSV export: ${csvPath}`)
    
  } catch (error) {
    console.error('❌ Failed to export telemetry:', error)
    process.exit(1)
  }
}

// Run export
exportTelemetry()
