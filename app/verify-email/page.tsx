"use client";

import { useState, useEffect, Suspense, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string>('');
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent processing multiple times
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const token = searchParams.get('token');
    const errorParam = searchParams.get('error');
    const successParam = searchParams.get('success');

    // If success or error from API redirect, show result
    if (successParam) {
      setStatus('success');
    } else if (errorParam) {
      setStatus('error');
      switch (errorParam) {
        case 'missing-token':
          setError('Verification token is missing');
          break;
        case 'invalid-or-expired':
          setError('Verification token is invalid or has expired');
          break;
        default:
          setError('An unknown error occurred');
      }
    } else if (token) {
      // Token present but no result yet - call the verification API
      verifyEmail(token);
    } else {
      setStatus('error');
      setError('No verification token provided');
    }
  }, [searchParams]);

  const verifyEmail = async (token: string) => {
    try {
      const response = await fetch(`/api/auth/verify-email?token=${token}`);

      if (response.ok) {
        setStatus('success');
      } else {
        const data = await response.json();
        setError(data.error || 'Verification failed');
        setStatus('error');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-4">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-white">
            {status === 'verifying' && 'Verifying Your Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription className="text-center text-gray-300">
            {status === 'verifying' && 'Please wait while we verify your email address...'}
            {status === 'success' && 'Your email has been successfully verified.'}
            {status === 'error' && error}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'verifying' && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
            </div>
          )}

          {status === 'success' && (
            <Alert className="bg-green-500/20 border-green-500/50 text-green-200">
              <AlertDescription>
                You can now log in to your account.
              </AlertDescription>
            </Alert>
          )}

          {status === 'error' && (
            <Alert className="bg-red-500/20 border-red-500/50 text-red-200">
              <AlertDescription>
                Please try requesting a new verification email.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            {status === 'success' && (
              <Button asChild className="w-full">
                <Link href="/login">Go to Login</Link>
              </Button>
            )}

            {status === 'error' && (
              <>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/">Back to Home</Link>
                </Button>
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/login">Go to Login</Link>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
