import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

interface ModalSignupFormProps {
  onSwitchMode: () => void;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

export default function ModalSignupForm({ onSwitchMode, onSuccess, onError }: ModalSignupFormProps) {
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
      // Auto-close modal after 1.5 seconds
      setTimeout(() => {
        onSuccess?.();
      }, 1500);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create account. Please try again.';
      setErrors({ general: errorMessage });
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
        <div className="text-center">
          <div className="text-green-500 text-6xl mb-4">✓</div>
          <h2 className="text-2xl font-bold mb-4">Welcome!</h2>
          <p className="text-gray-300 mb-4">
            Your account has been created successfully and you're now signed in.
          </p>
          <p className="text-sm text-gray-400">
            Closing in a moment...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Join Us</h2>
      
      {errors.general && (
        <div className="text-red-500 mb-4 text-center p-3 bg-red-500/10 rounded-md border border-red-500/20">
          {errors.general}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="modal-signup-email">Email</Label>
          <Input
            id="modal-signup-email"
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
            aria-describedby={errors.email ? 'modal-signup-email-error' : undefined}
            disabled={isLoading}
            placeholder="Enter your email"
          />
          {errors.email && (
            <p id="modal-signup-email-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.email}
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="modal-signup-password">Password</Label>
          <Input
            id="modal-signup-password"
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
            aria-describedby={errors.password ? 'modal-signup-password-error' : 'modal-signup-password-help'}
            disabled={isLoading}
            placeholder="Create a password"
          />
          {errors.password && (
            <p id="modal-signup-password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.password}
            </p>
          )}
          {!errors.password && (
            <p id="modal-signup-password-help" className="text-gray-400 text-xs mt-1">
              At least 8 characters with uppercase, lowercase, and number
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="modal-confirm-password">Confirm Password</Label>
          <Input
            id="modal-confirm-password"
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
            aria-describedby={errors.confirmPassword ? 'modal-confirm-password-error' : undefined}
            disabled={isLoading}
            placeholder="Confirm your password"
          />
          {errors.confirmPassword && (
            <p id="modal-confirm-password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.confirmPassword}
            </p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600" 
          disabled={isLoading}
        >
          {isLoading ? 'Creating Account...' : 'Create Account'}
        </Button>
        
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300 disabled:opacity-50 text-sm"
            disabled={isLoading}
          >
            Already have an account? Sign in
          </button>
        </div>
      </form>
    </div>
  );
}