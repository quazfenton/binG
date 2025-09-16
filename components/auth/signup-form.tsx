import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

interface SignupFormProps {
  onSwitchMode: () => void;
}

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

export default function SignupForm({ onSwitchMode }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { register } = useAuth();

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
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      newErrors.password = 'Password must contain at least one uppercase letter, one lowercase letter, and one number';
    }

    // Confirm password validation
    if (!confirmPassword.trim()) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setIsSuccess(false);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password);
      setIsSuccess(true);
      // Clear form
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      // Auto-switch to login after 2 seconds
      setTimeout(() => {
        onSwitchMode();
      }, 2000);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create account. Please try again.';
      setErrors({ general: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
        <div className="text-center">
          <div className="text-green-500 text-6xl mb-4">✓</div>
          <h2 className="text-2xl font-bold mb-4">Account Created Successfully!</h2>
          <p className="text-gray-300 mb-4">
            Welcome! Your account has been created and you're now logged in.
          </p>
          <p className="text-sm text-gray-400">
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Your Account</h2>
      
      {errors.general && (
        <div className="text-red-500 mb-4 text-center p-3 bg-red-500/10 rounded-md border border-red-500/20">
          {errors.general}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
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
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
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
            aria-describedby={errors.password ? 'password-error' : 'password-help'}
            disabled={isLoading}
          />
          {errors.password && (
            <p id="password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.password}
            </p>
          )}
          {!errors.password && (
            <p id="password-help" className="text-gray-400 text-xs mt-1">
              At least 8 characters with uppercase, lowercase, and number
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (errors.confirmPassword) {
                setErrors(prev => ({ ...prev, confirmPassword: undefined }));
              }
            }}
            className={`bg-black/20 border-white/20 ${errors.confirmPassword ? 'border-red-500' : ''}`}
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
            disabled={isLoading}
          />
          {errors.confirmPassword && (
            <p id="confirm-password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.confirmPassword}
            </p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full" 
          disabled={isLoading}
        >
          {isLoading ? 'Creating Account...' : 'Sign Up'}
        </Button>
        
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
            disabled={isLoading}
          >
            Already have an account? Sign In
          </button>
        </div>
      </form>
    </div>
  );
}
