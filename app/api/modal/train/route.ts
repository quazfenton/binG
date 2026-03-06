import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

type TrainBody = {
  algorithm: 'linear' | 'kmeans' | 'logistic' | 'rf';
  features: number[][];
  labels?: number[];
  featureColumns?: string[];
  targetColumn?: string;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = (await req.json()) as TrainBody;
    const { algorithm, features, labels = [], featureColumns = [], targetColumn } = body;

    if (!algorithm || !Array.isArray(features) || features.length === 0) {
      return NextResponse.json(
        { error: 'algorithm and non-empty features are required' },
        { status: 400 }
      );
    }

    const endpoint = process.env.MODAL_TRAINING_URL;
    if (!endpoint) {
      return NextResponse.json(
        { error: 'Modal training endpoint is not configured (MODAL_TRAINING_URL)' },
        { status: 500 }
      );
    }

    const token = process.env.MODAL_API_TOKEN;
    const modalRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        algorithm,
        features,
        labels,
        feature_columns: featureColumns,
        target_column: targetColumn,
      }),
    });

    const isJson = modalRes.headers.get('content-type')?.includes('application/json');
    const payload = isJson ? await modalRes.json() : await modalRes.text();

    if (!modalRes.ok) {
      const message =
        (typeof payload === 'object' && payload && 'error' in payload && String((payload as Record<string, unknown>).error)) ||
        `Modal request failed (${modalRes.status})`;
      return NextResponse.json({ error: message, details: payload }, { status: modalRes.status });
    }

    const data = typeof payload === 'object' && payload ? payload : { raw: payload };
    return NextResponse.json({
      success: true,
      data: {
        summary: (data as Record<string, unknown>).summary || `${algorithm} training completed via Modal`,
        metrics: (data as Record<string, unknown>).metrics || null,
        raw: data,
      },
    });
  } catch (error) {
    console.error('Modal training error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to train model via Modal' },
      { status: 500 }
    );
  }
}
