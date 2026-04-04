import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/auth-context';

interface LoginFormProps {
  onSwitchMode: () => void;
}

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
  requiresVerification?: boolean;
}

export default function LoginForm({ onSwitchMode }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showVerificationSent, setShowVerificationSent] = useState(false);
  const { login } = useAuth();

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Email validation
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Password validation
    if (!password.trim()) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleResendVerification = async () => {
    try {
      const response = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      
      if (data.success) {
        setShowVerificationSent(true);
      } else {
        setErrors({ general: data.error || 'Failed to send verification email' });
      }
    } catch (err: any) {
      setErrors({ general: 'Failed to send verification email' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setShowVerificationSent(false);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed. Please check your credentials and try again.';
      
      // Check if it's a verification required error
      if (errorMessage.includes('verify your email') || errorMessage.includes('verification')) {
        setErrors({ 
          general: errorMessage,
          requiresVerification: true
        });
      } else {
        setErrors({ general: errorMessage });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (showVerificationSent) {
    return (
      <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
        <h2 className="text-2xl font-bold mb-6 text-center">Check Your Email</h2>
        <Alert className="bg-green-500/20 border-green-500/50 text-green-200 mb-6">
          <AlertDescription>
            We've sent a verification link to <strong>{email}</strong>. Please click the link to verify your email.
          </AlertDescription>
        </Alert>
        <Button onClick={() => setShowVerificationSent(false)} className="w-full" variant="outline">
          Back to Login
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Login to Your Account</h2>

      {errors.general && (
        <Alert className={`mb-4 ${errors.requiresVerification ? 'bg-blue-500/20 border-blue-500/50 text-blue-200' : 'bg-red-500/20 border-red-500/50 text-red-200'}`}>
          <AlertDescription>
            {errors.general}
            {errors.requiresVerification && (
              <Button 
                onClick={handleResendVerification} 
                className="mt-3 w-full" 
                size="sm"
                variant="secondary"
              >
                Resend Verification Email
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) {
                setErrors(prev => ({ ...prev, email: undefined }));
              }
            }}
            className={`bg-black/20 border-white/20 ${errors.email ? 'border-red-500' : ''}`}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            disabled={isLoading}
          />
          {errors.email && (
            <p id="email-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.email}
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) {
                setErrors(prev => ({ ...prev, password: undefined }));
              }
            }}
            className={`bg-black/20 border-white/20 ${errors.password ? 'border-red-500' : ''}`}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            disabled={isLoading}
          />
          {errors.password && (
            <p id="password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.password}
            </p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full" 
          disabled={isLoading}
          aria-describedby="login-status"
        >
          {isLoading ? 'Signing in...' : 'Login'}
        </Button>
        
        <div className="text-center mt-4">
          <button 
            type="button" 
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
            disabled={isLoading}
          >
            Create an account
          </button>
        </div>
      </form>
    </div>
  );
}