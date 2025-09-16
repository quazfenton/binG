'use client';

import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Mail, 
  Calendar, 
  Crown, 
  Shield, 
  LogOut,
  Settings as SettingsIcon,
  CheckCircle
} from 'lucide-react';

interface UserProfileDisplayProps {
  showActions?: boolean;
  compact?: boolean;
}

export function UserProfileDisplay({ showActions = true, compact = false }: UserProfileDisplayProps) {
  const { user, isAuthenticated, logout, isLoading } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center p-8">
          <div className="text-center">
            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-400">Not signed in</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
        <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
          <User className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate" title={user.email}>
            {user.email}
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            <span className="text-xs text-green-400">Online</span>
            <Badge variant="secondary" className="text-xs">
              <Crown className="h-3 w-3 mr-1" />
              Premium
            </Badge>
          </div>
        </div>
        {showActions && (
          <Button
            size="sm"
            variant="outline"
            onClick={logout}
            disabled={isLoading}
            title="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          User Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Profile Header */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
            <User className="h-8 w-8 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{user.email}</h3>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span className="text-sm text-green-400">Online</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500">
              <Crown className="h-3 w-3 mr-1" />
              Premium
            </Badge>
            <Badge variant="outline" className="text-green-400 border-green-400">
              <CheckCircle className="h-3 w-3 mr-1" />
              Verified
            </Badge>
          </div>
        </div>

        {/* Account Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Mail className="h-4 w-4" />
              Email Address
            </div>
            <p className="font-medium">{user.email}</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Calendar className="h-4 w-4" />
              Member Since
            </div>
            <p className="font-medium">
              {new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        </div>

        {/* Account Features */}
        <div className="space-y-3">
          <h4 className="font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Account Features
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span>Unlimited prompts</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span>Custom themes</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span>Priority support</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span>Advanced features</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex gap-2 pt-4 border-t border-white/10">
            <Button
              variant="outline"
              className="flex-1"
              asChild
            >
              <a href="/settings" className="flex items-center gap-2">
                <SettingsIcon className="h-4 w-4" />
                Account Settings
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={logout}
              disabled={isLoading}
              className="flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              {isLoading ? 'Signing out...' : 'Sign Out'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}