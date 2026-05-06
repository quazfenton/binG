/**
 * AI Art Gallery API
 *
 * GET /api/ai-art/images - List generated images
 * GET /api/ai-art/images/:id - Get image by ID
 * POST /api/ai-art/images/:id/like - Like image
 * POST /api/ai-art/images/:id/download - Download image
 * DELETE /api/ai-art/images/:id - Delete image
 * GET /api/ai-art/stats - Get gallery statistics
 * GET /api/ai-art/search - Search images
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getImages,
  getImageById,
  likeImage,
  downloadImage,
  deleteImage,
  getGalleryStats,
  searchImages,
  type ArtStyle,
} from '@/lib/ai-art/ai-art-gallery';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:AIArt');

// GET - List images
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const style = searchParams.get('style') as ArtStyle | undefined;

    const images = await getImages(limit, style);

    return NextResponse.json({
      success: true,
      images,
      count: images.length,
    });
  } catch (error: any) {
    logger.error('Failed to get images:', error);
    return NextResponse.json(
      { error: 'Failed to get images' },
      { status: 500 }
    );
  }
}
