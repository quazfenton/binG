import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';

export default function LoginForm({ onSwitchMode }: { onSwitchMode: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // Keep password for input, but not used in login mock
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email); // Removed password from login call
    } catch (err) {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
      <h2 className="text-2xl font-bold mb-6 text-center">Login to Your Account</h2>
      {error && <div className="text-red-500 mb-4 text-center">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-black/20 border-white/20"
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
          />
        </div>
        <Button type="submit" className="w-full">Login</Button>
        <div className="text-center mt-4">
          <button 
            type="button" 
            onClick={onSwitchMode}
            className="text-blue-400 hover:text-blue-300"
          >
            Create an account
          </button>
        </div>
      </form>
    </div>
  );
}