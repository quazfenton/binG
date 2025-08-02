import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

export default function SignupForm({ onSwitchMode }: { onSwitchMode: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const { register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    try {
      await register(email); // Assuming register handles email and password internally or via context
      // If registration is successful, you might want to automatically log the user in or redirect
      // For now, we'll just clear the form and potentially show a success message
      setError(''); // Clear any previous errors
      // Optionally, you could call onSwitchMode() here to switch to login after successful signup
    } catch (err) {
      setError('Failed to sign up. Please try again.');
      console.error('Signup error:', err);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Create Your Account</h2>
      {error && <div className="text-red-500 mb-4 text-center">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-black/20 border-white/20"
          />
        </div>
        <div>
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bg-black/20 border-white/20"
          />
        </div>
        <div>
          <Label htmlFor="confirm-password">Confirm Password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="bg-black/20 border-white/20"
          />
        </div>
        <Button type="submit" className="w-full">Sign Up</Button>
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300"
          >
            Already have an account? Sign In
          </button>
        </div>
      </form>
    </div>
  );
}
