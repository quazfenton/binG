import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

interface ModalLoginFormProps {
  onSwitchMode: () => void;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

export default function ModalLoginForm({ onSwitchMode, onSuccess, onError }: ModalLoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
      onSuccess?.();
    } catch (err: any) {
      const errorMessage = err.message || 'Login failed. Please check your credentials and try again.';
      setErrors({ general: errorMessage });
      onError?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Welcome Back</h2>
      
      {errors.general && (
        <div className="text-red-500 mb-4 text-center p-3 bg-red-500/10 rounded-md border border-red-500/20">
          {errors.general}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="modal-email">Email</Label>
          <Input
            id="modal-email"
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
            aria-describedby={errors.email ? 'modal-email-error' : undefined}
            disabled={isLoading}
            placeholder="Enter your email"
          />
          {errors.email && (
            <p id="modal-email-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.email}
            </p>
          )}
        </div>
        
        <div>
          <Label htmlFor="modal-password">Password</Label>
          <Input
            id="modal-password"
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
            aria-describedby={errors.password ? 'modal-password-error' : undefined}
            disabled={isLoading}
            placeholder="Enter your password"
          />
          {errors.password && (
            <p id="modal-password-error" className="text-red-500 text-sm mt-1" role="alert">
              {errors.password}
            </p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600" 
          disabled={isLoading}
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>
        
        <div className="text-center mt-4">
          <button 
            type="button" 
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300 disabled:opacity-50 text-sm"
            disabled={isLoading}
          >
            Don't have an account? Sign up
          </button>
        </div>
      </form>
    </div>
  );
}