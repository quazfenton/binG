import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function RegisterForm({ onSwitchMode }: { onSwitchMode: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { register } = useAuth();

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/(?=.*[a-z])/.test(pwd)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(pwd)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*\d)/.test(pwd)) {
      return 'Password must contain at least one number';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Validate password strength
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password, username || undefined);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
        <h2 className="text-2xl font-bold mb-6 text-center">Check Your Email</h2>
        <Alert className="bg-green-500/20 border-green-500/50 text-green-200 mb-6">
          <AlertDescription>
            We've sent a verification link to <strong>{email}</strong>. Please click the link to verify your email address.
          </AlertDescription>
        </Alert>
        <div className="space-y-4">
          <p className="text-center text-gray-300">
            Didn't receive the email? Check your spam folder or try again.
          </p>
          <Button 
            onClick={onSwitchMode} 
            className="w-full"
            variant="outline"
          >
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Account</h2>
      
      {error && (
        <Alert className="bg-red-500/20 border-red-500/50 text-red-200 mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="username">Username (optional)</Label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="bg-black/20 border-white/20"
            disabled={isLoading}
          />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-black/20 border-white/20"
            disabled={isLoading}
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bg-black/20 border-white/20"
            disabled={isLoading}
          />
          <p className="text-xs text-gray-400 mt-1">
            Must be 8+ characters with uppercase, lowercase, and number
          </p>
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="bg-black/20 border-white/20"
            disabled={isLoading}
          />
        </div>
        <Button 
          type="submit" 
          className="w-full"
          disabled={isLoading}
        >
          {isLoading ? 'Creating Account...' : 'Register'}
        </Button>
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
            disabled={isLoading}
          >
            Already have an account? Login
          </button>
        </div>
      </form>
    </div>
  );
}