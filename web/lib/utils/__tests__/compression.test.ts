import { describe, it, expect } from 'vitest'
import { compress, decompress, compressSync, decompressSync, isCompressed, getCompressionStats } from '../compression'

describe('Compression Debug', () => {
  it('should compress and decompress', () => {
    const original = 'Hello, this is test data for compression!'.repeat(20)
    console.log('=== Starting compress/decompress test ===')
    
    const compressed = compress(original)
    console.log('After compress, compressed length:', compressed.length)
    
    const decompressed = decompress(compressed)
    console.log('After decompress, decompressed length:', decompressed.length)
    console.log('Decompressed as string:', decompressed.toString('utf-8').slice(0, 50))
    
    expect(decompressed.toString('utf-8')).toBe(original)
  })
})
