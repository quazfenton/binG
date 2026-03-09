"use client";

import { useState, useEffect, Suspense, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [verificationCode, setVerificationCode] = useState('');
  const [status, setStatus] = useState<'input' | 'verifying' | 'success' | 'error'>('input');
  const [error, setError] = useState<string>('');
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Check if token is provided in URL (from email link)
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
      // Token present from email link - auto verify
      verifyEmail(token);
    }
    // If no token, stay in 'input' mode for manual code entry
  }, [searchParams]);

  const verifyEmail = async (token: string) => {
    setStatus('verifying');
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

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }
    await verifyEmail(verificationCode.trim());
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 p-4">
      <Card className="w-full max-w-md bg-white/10 backdrop-blur-md border-white/20">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-white">
            {status === 'input' && 'Verify Your Email'}
            {status === 'verifying' && 'Verifying Your Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription className="text-center text-gray-300">
            {status === 'input' && 'Enter the verification code from your email'}
            {status === 'verifying' && 'Please wait while we verify your email address...'}
            {status === 'success' && 'Your email has been successfully verified.'}
            {status === 'error' && error}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'input' && (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-gray-200">
                  Verification Code
                </Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="Enter your verification code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 text-center text-lg tracking-widest"
                  autoFocus
                />
                <p className="text-xs text-gray-400">
                  Check your email for the verification code
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={!verificationCode.trim()}
              >
                Verify Email
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleBackToHome}
              >
                Back to Home
              </Button>
            </form>
          )}

          {status === 'verifying' && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-white" />
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <CheckCircle className="h-16 w-16 text-green-400" />
              </div>
              <Alert className="bg-green-500/20 border-green-500/50 text-green-200">
                <AlertDescription>
                  Your email has been verified successfully!
                </AlertDescription>
              </Alert>
              <Button onClick={handleBackToHome} className="w-full">
                Continue to Home
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <XCircle className="h-16 w-16 text-red-400" />
              </div>
              <Alert className="bg-red-500/20 border-red-500/50 text-red-200">
                <AlertDescription>
                  {error}. Please try requesting a new verification email.
                </AlertDescription>
              </Alert>
              <div className="flex flex-col gap-2">
                <Button onClick={handleBackToHome} className="w-full">
                  Back to Home
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStatus('input');
                    setError('');
                    setVerificationCode('');
                  }}
                  className="w-full"
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}
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
