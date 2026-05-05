/**
 * AI Art Gallery API
 * 
 * CRUD operations for AI-generated images.
 * GET /api/art-gallery/images
 * POST /api/art-gallery/images
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = 'edge';

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { auth0 } from "@/lib/auth0";

const DATA_DIR = join(process.cwd(), "data");
const IMAGES_PATH = join(DATA_DIR, "art-gallery.json");

// Ensure data directory exists
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// Default art styles
const ART_STYLES = [
  { id: "all", name: "All Styles", icon: "🎨", color: "from-purple-500 to-pink-500", examples: 1247 },
  { id: "cyberpunk", name: "Cyberpunk", icon: "🤖", color: "from-cyan-500 to-blue-500", examples: 234 },
  { id: "fantasy", name: "Fantasy", icon: "🐉", color: "from-amber-500 to-orange-500", examples: 567 },
  { id: "realistic", name: "Realistic", icon: "📷", color: "from-green-500 to-emerald-500", examples: 892 },
  { id: "abstract", name: "Abstract", icon: "🎭", color: "from-pink-500 to-rose-500", examples: 345 },
  { id: "minimalist", name: "Minimalist", icon: "⚪", color: "from-gray-500 to-slate-500", examples: 189 },
  { id: "steampunk", name: "Steampunk", icon: "⚙️", color: "from-yellow-500 to-amber-500", examples: 156 },
];

// Default images
const DEFAULT_IMAGES = [
  {
    id: "img-1",
    prompt: "Cyberpunk cityscape at night with neon lights and flying cars",
    url: "https://picsum.photos/seed/cyber1/1024/1024",
    style: "cyberpunk",
    model: "flux-1",
    createdAt: Date.now() - 3600000,
    likes: 234,
    downloads: 89,
    width: 1024,
    height: 1024,
    seed: 42,
  },
  {
    id: "img-2",
    prompt: "Serene mountain landscape with aurora borealis",
    url: "https://picsum.photos/seed/nature1/1024/768",
    style: "realistic",
    model: "sdxl",
    createdAt: Date.now() - 7200000,
    likes: 567,
    downloads: 234,
    width: 1024,
    height: 768,
    seed: 123,
  },
  {
    id: "img-3",
    prompt: "Abstract geometric patterns in vibrant colors",
    url: "https://picsum.photos/seed/abstract1/768/768",
    style: "abstract",
    model: "midjourney",
    createdAt: Date.now() - 14400000,
    likes: 189,
    downloads: 67,
    width: 768,
    height: 768,
    seed: 999,
  },
];

// Read images with safe fallback
async function readImages(): Promise<any[]> {
  try {
    await ensureDataDir();
    const data = await readFile(IMAGES_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await writeFile(IMAGES_PATH, JSON.stringify(DEFAULT_IMAGES, null, 2));
      return DEFAULT_IMAGES;
    }
    console.error('[ArtGallery API] Failed to read images:', error.message);
    throw error;
  }
}

// Write images
async function writeImages(images: any[]): Promise<void> {
  await ensureDataDir();
  await writeFile(IMAGES_PATH, JSON.stringify(images, null, 2));
}

// Get auth session from request
async function getAuthSession(request: NextRequest) {
  try {
    const session = await auth0.getSession(request);
    if (!session?.user) return null;

    return {
      user: {
        id: session.user.sub,
        email: session.user.email,
        roles: (session.user as any)['https://binG.com/roles'] || [],
      },
    };
  } catch (error: unknown) {
    console.error('[ArtGallery API] Failed to resolve auth session', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// GET - List all images
export async function GET(request: NextRequest) {
  try {
    const images = await readImages();
    const url = new URL(request.url);
    const style = url.searchParams.get('style');
    const search = url.searchParams.get('search');
    const sort = url.searchParams.get('sort') || 'newest';

    let filtered = [...images];
    
    if (style && style !== 'all') {
      filtered = filtered.filter(img => img.style === style);
    }
    
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(img => 
        img.prompt.toLowerCase().includes(searchLower) ||
        img.style.toLowerCase().includes(searchLower)
      );
    }

    // Sort
    switch (sort) {
      case 'popular':
        filtered.sort((a, b) => b.likes - a.likes);
        break;
      case 'downloads':
        filtered.sort((a, b) => b.downloads - a.downloads);
        break;
      default: // newest
        filtered.sort((a, b) => b.createdAt - a.createdAt);
    }

    return NextResponse.json({
      success: true,
      images: filtered,
      styles: ART_STYLES,
      total: filtered.length,
    });
  } catch (error: any) {
    console.error('[ArtGallery API] GET error:', error.message);
    return NextResponse.json({
      success: true,
      images: DEFAULT_IMAGES,
      styles: ART_STYLES,
      total: DEFAULT_IMAGES.length,
      fallback: true,
    });
  }
}

// POST - Create/update images
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, image, images: newImages } = body;

    // SECURITY: Auth check for destructive operations
    const session = await getAuthSession(request);
    const hasSession = !!session?.user;
    const isAdmin = session?.user?.roles?.includes('admin') ?? false;

    // Block destructive operations for non-admin users
    if ((action === 'delete' || action === 'replace') && !isAdmin) {
      return NextResponse.json(
        { success: false, error: hasSession ? 'Admin access required for this operation' : 'Authentication required' },
        { status: hasSession ? 403 : 401 }
      );
    }

    const currentImages = await readImages();

    switch (action) {
      case 'create': {
        if (!image?.prompt || !image?.url) {
          return NextResponse.json(
            { success: false, error: 'Image prompt and URL are required' },
            { status: 400 }
          );
        }

        const newImage = {
          id: `img-${Date.now()}`,
          prompt: image.prompt,
          url: image.url,
          thumbnail: image.thumbnail || image.url,
          style: image.style || 'abstract',
          model: image.model || 'flux-1',
          createdAt: Date.now(),
          likes: 0,
          downloads: 0,
          width: image.width || 1024,
          height: image.height || 1024,
          seed: image.seed || Math.floor(Math.random() * 10000),
        };

        currentImages.unshift(newImage);
        await writeImages(currentImages);

        return NextResponse.json({
          success: true,
          image: newImage,
        });
      }

      case 'like': {
        if (!image?.id) {
          return NextResponse.json(
            { success: false, error: 'Image ID is required' },
            { status: 400 }
          );
        }

        const index = currentImages.findIndex(img => img.id === image.id);
        if (index === -1) {
          return NextResponse.json(
            { success: false, error: 'Image not found' },
            { status: 404 }
          );
        }
        currentImages[index].likes = (currentImages[index].likes || 0) + 1;
        await writeImages(currentImages);

        return NextResponse.json({
          success: true,
          likes: currentImages[index]?.likes || 0,
        });
      }

      case 'download': {
        if (!image?.id) {
          return NextResponse.json(
            { success: false, error: 'Image ID is required' },
            { status: 400 }
          );
        }

        const index = currentImages.findIndex(img => img.id === image.id);
        if (index === -1) {
          return NextResponse.json(
            { success: false, error: 'Image not found' },
            { status: 404 }
          );
        }
        currentImages[index].downloads = (currentImages[index].downloads || 0) + 1;
        await writeImages(currentImages);

        return NextResponse.json({
          success: true,
          downloads: currentImages[index]?.downloads || 0,
        });
      }

      case 'delete': {
        if (!image?.id) {
          return NextResponse.json(
            { success: false, error: 'Image ID is required' },
            { status: 400 }
          );
        }

        const exists = currentImages.some(img => img.id === image.id);
        if (!exists) {
          return NextResponse.json(
            { success: false, error: 'Image not found' },
            { status: 404 }
          );
        }

        const filtered = currentImages.filter(img => img.id !== image.id);
        await writeImages(filtered);

        return NextResponse.json({
          success: true,
          message: 'Image deleted',
        });
      }

      case 'replace': {
        if (!newImages || !Array.isArray(newImages)) {
          return NextResponse.json(
            { success: false, error: 'Valid images array required' },
            { status: 400 }
          );
        }

        await writeImages(newImages);

        return NextResponse.json({
          success: true,
          images: newImages,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[ArtGallery API] POST error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
