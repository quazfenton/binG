/**
 * Daytona Object Storage Service
 * 
 * Provides persistent object storage for large files.
 * 
 * Features:
 * - Upload/download large files
 * - List objects by prefix
 * - Delete objects
 * - Stream large files
 * 
 * @see https://www.daytona.io/docs/en/object-storage/
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

export interface ObjectStorageUploadRequest {
  key: string
  content: string | NodeJS.ReadableStream
  contentType?: string
  metadata?: Record<string, string>
}

export interface ObjectStorageDownloadRequest {
  key: string
}

export interface ObjectStorageDownloadResponse {
  content: string
  contentType?: string
  metadata?: Record<string, string>
  size: number
}

export interface ObjectStorageListRequest {
  prefix?: string
  delimiter?: string
  maxKeys?: number
  continuationToken?: string
}

export interface ObjectStorageObject {
  key: string
  size: number
  lastModified: string
  etag?: string
  contentType?: string
  metadata?: Record<string, string>
}

export interface ObjectStorageListResponse {
  objects: ObjectStorageObject[]
  nextContinuationToken?: string
  hasMore: boolean
}

/**
 * Object Storage Service for Daytona sandboxes
 */
export class ObjectStorageService {
  private sandboxId: string
  private apiBaseUrl: string
  private apiKey: string

  constructor(sandboxId: string, apiKey: string, apiBaseUrl: string = 'https://app.daytona.io/api') {
    this.sandboxId = sandboxId
    this.apiKey = apiKey
    this.apiBaseUrl = apiBaseUrl
  }

  /**
   * Upload file to object storage
   */
  async upload(request: ObjectStorageUploadRequest): Promise<{
    success: boolean
    etag?: string
    error?: string
  }> {
    try {
      const formData = new FormData()
      
      // Handle string or stream content
      let content: Blob
      if (typeof request.content === 'string') {
        content = new Blob([request.content], {
          type: request.contentType || 'text/plain',
        })
      } else {
        // For streams, we'd need to handle differently in Node.js
        // This is a simplified version
        throw new Error('Stream content not yet supported in this implementation' as any)
      }

      formData.append('file', content, request.key)
      
      if (request.metadata) {
        formData.append('metadata', JSON.stringify(request.metadata))
      }

      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/upload`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: formData,
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to upload: ${response.statusText}`)
      }

      const data = await (response as any).json()
      return { success: true, etag: data.etag }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Upload file from filesystem
   */
  async uploadFromFile(filePath: string, key: string, metadata?: Record<string, string>): Promise<{
    success: boolean
    etag?: string
    error?: string
  }> {
    try {
      const content = createReadStream(filePath)
      
      // For Node.js streams, we need to use a different approach
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/upload`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/octet-stream',
            'X-Storage-Key': key,
            ...(metadata ? { 'X-Storage-Metadata': JSON.stringify(metadata) } : {}),
          },
          body: content as any,
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to upload: ${response.statusText}`)
      }

      const data = await (response as any).json()
      return { success: true, etag: data.etag }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Download file from object storage
   */
  async download(request: ObjectStorageDownloadRequest): Promise<{
    success: boolean
    data?: ObjectStorageDownloadResponse
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/download?key=${encodeURIComponent(request.key)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`)
      }

      const content = await response.text()
      const contentType = response.headers.get('content-type') || undefined
      const metadata = response.headers.get('x-storage-metadata')
      const size = parseInt(response.headers.get('content-length') || '0', 10)

      return {
        success: true,
        data: {
          content,
          contentType,
          metadata: metadata ? JSON.parse(metadata) : undefined,
          size,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Download file to filesystem
   */
  async downloadToFile(key: string, filePath: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/download?key=${encodeURIComponent(key)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Use Node.js stream pipeline
      const reader = response.body.getReader()
      const writer = createWriteStream(filePath)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        writer.write(value)
      }

      writer.end()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * List objects
   */
  async list(request?: ObjectStorageListRequest): Promise<{
    success: boolean
    data?: ObjectStorageListResponse
    error?: string
  }> {
    try {
      const params = new URLSearchParams()
      if (request?.prefix) params.append('prefix', request.prefix)
      if (request?.delimiter) params.append('delimiter', request.delimiter)
      if (request?.maxKeys) params.append('maxKeys', request.maxKeys.toString())
      if (request?.continuationToken) params.append('continuationToken', request.continuationToken)

      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/list?${params}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to list objects: ${response.statusText}`)
      }

      const data = await (response as any).json()
      return {
        success: true,
        data: {
          objects: data.objects || [],
          nextContinuationToken: data.nextContinuationToken,
          hasMore: !!data.nextContinuationToken,
        },
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Delete object
   */
  async delete(key: string): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/delete?key=${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to delete: ${response.statusText}`)
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Delete multiple objects
   */
  async deleteMultiple(keys: string[]): Promise<{
    success: boolean
    deleted: string[]
    failed: Array<{ key: string; error: string }>
  }> {
    const deleted: string[] = []
    const failed: Array<{ key: string; error: string }> = []

    for (const key of keys) {
      const result = await this.delete(key)
      if (result.success) {
        deleted.push(key)
      } else {
        failed.push({ key, error: result.error || 'Unknown error' })
      }
    }

    return { success: failed.length === 0, deleted, failed }
  }

  /**
   * Get object metadata
   */
  async head(key: string): Promise<{
    success: boolean
    metadata?: ObjectStorageObject
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/storage/head?key=${encodeURIComponent(key)}`,
        {
          method: 'HEAD',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to get metadata: ${response.statusText}`)
      }

      const metadata: ObjectStorageObject = {
        key,
        size: parseInt(response.headers.get('content-length') || '0', 10),
        lastModified: response.headers.get('last-modified') || new Date().toISOString(),
        etag: response.headers.get('etag') || undefined,
        contentType: response.headers.get('content-type') || undefined,
        metadata: response.headers.get('x-storage-metadata') 
          ? JSON.parse(response.headers.get('x-storage-metadata') || '{}')
          : undefined,
      }

      return { success: true, metadata }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}

/**
 * Factory function to create object storage service
 */
export function createObjectStorageService(
  sandboxId: string,
  apiKey: string,
  apiBaseUrl?: string
): ObjectStorageService {
  return new ObjectStorageService(sandboxId, apiKey, apiBaseUrl)
}
