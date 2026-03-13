'use client';

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import IntegrationPanel from '@/components/integrations/IntegrationPanel';
import UserAPIKeysPanel from '@/components/settings/UserAPIKeysPanel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogIn, User, Mail, Lock, Key, Plug } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { isAuthenticated, user, login, register } = useAuth();
  const router = useRouter();
  
  // Login/Register state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      if (authMode === 'login') {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        await register(email, password, username || undefined);
        toast.success('Account created! Please log in.');
        setAuthMode('login');
      }
      setEmail('');
      setPassword('');
      setUsername('');
    } catch (error: any) {
      toast.error(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h1>
            <p className="text-gray-400">
              {authMode === 'login' 
                ? 'Sign in to manage your integrations' 
                : 'Sign up to get started'}
            </p>
          </div>

          {/* Auth Card */}
          <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                {authMode === 'login' ? (
                  <><LogIn className="w-5 h-5" /> Sign In</>
                ) : (
                  <><User className="w-5 h-5" /> Sign Up</>
                )}
              </CardTitle>
              <CardDescription className="text-gray-400">
                {authMode === 'login' 
                  ? 'Enter your credentials to access your account' 
                  : 'Create a new account to continue'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAuth} className="space-y-4">
                {authMode === 'register' && (
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-gray-300">
                      Username
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <Input
                        id="username"
                        type="text"
                        placeholder="johndoe"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                        required={authMode === 'register'}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-300">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  disabled={loading}
                >
                  {loading ? (
                    'Please wait...'
                  ) : authMode === 'login' ? (
                    'Sign In'
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </form>

              {/* Switch Mode */}
              <div className="mt-6 text-center">
                <p className="text-gray-400 text-sm">
                  {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                  <button
                    onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                    className="ml-2 text-purple-400 hover:text-purple-300 font-medium underline underline-offset-4"
                  >
                    {authMode === 'login' ? 'Sign up' : 'Sign in'}
                  </button>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Features */}
          <div className="mt-8 grid grid-cols-2 gap-4 text-center">
            <div className="p-4 rounded-lg bg-gray-900/30 border border-gray-800">
              <p className="text-white font-medium">Manage Integrations</p>
              <p className="text-gray-500 text-sm mt-1">Connect your favorite apps</p>
            </div>
            <div className="p-4 rounded-lg bg-gray-900/30 border border-gray-800">
              <p className="text-white font-medium">Secure & Private</p>
              <p className="text-gray-500 text-sm mt-1">Your data stays yours</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show integrations panel when authenticated
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">
            Settings & Integrations
          </h1>
          <p className="text-gray-400">
            Manage your API keys, credentials, and third-party integrations
          </p>
        </div>

        <Tabs defaultValue="api-keys" className="space-y-6">
          <TabsList className="bg-gray-900 border border-gray-800">
            <TabsTrigger value="api-keys" className="data-[state=active]:bg-purple-600">
              <Key className="w-4 h-4 mr-2" />
              API Keys
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-purple-600">
              <Plug className="w-4 h-4 mr-2" />
              Integrations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys">
            <UserAPIKeysPanel userId={user?.id?.toString()} />
          </TabsContent>

          <TabsContent value="integrations">
            <Card className="bg-gray-900/50 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white">Third-Party Integrations</CardTitle>
                <CardDescription className="text-gray-400">
                  Connect your favorite services to enhance your AI assistant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IntegrationPanel userId={user?.id?.toString() || ''} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}