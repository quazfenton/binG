'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/auth-context';
import { useEffect, useState } from 'react';
import { KeyIcon, User, Mail, Lock, Eye, EyeOff, Save, AlertCircle } from "lucide-react";
import { PROVIDERS } from "@/lib/api/llm-providers";

interface UserProfile {
  email: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

interface FormErrors {
  profile?: string;
  apiKeys?: string;
  general?: string;
}

export function UserSettingsForm() {
  const { user, getApiKeys, setApiKeys, logout } = useAuth();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [profile, setProfile] = useState<UserProfile>({
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: ''
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Initialize data from auth context
  useEffect(() => {
    if (user) {
      setKeys(getApiKeys());
      setProfile(prev => ({
        ...prev,
        email: user.email
      }));
    } else {
      setKeys({});
      setProfile({
        email: '',
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      });
    }
  }, [user, getApiKeys]);

  // Handler for API key input changes
  const handleApiKeyChange = (providerId: string, apiKey: string) => {
    setKeys(prevKeys => ({
      ...prevKeys,
      [providerId]: apiKey,
    }));
    // Clear any previous errors
    if (errors.apiKeys) {
      setErrors(prev => ({ ...prev, apiKeys: undefined }));
    }
  };

  // Handler for profile input changes
  const handleProfileChange = (field: keyof UserProfile, value: string) => {
    setProfile(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear any previous errors
    if (errors.profile) {
      setErrors(prev => ({ ...prev, profile: undefined }));
    }
  };

  // Toggle API key visibility
  const toggleKeyVisibility = (providerId: string) => {
    setShowKeys(prev => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  };

  // Validate profile changes
  const validateProfile = (): boolean => {
    if (!profile.newPassword && !profile.currentPassword) {
      return true; // No password change requested
    }

    if (profile.newPassword && !profile.currentPassword) {
      setErrors(prev => ({ ...prev, profile: 'Current password is required to set a new password' }));
      return false;
    }

    if (profile.newPassword && profile.newPassword.length < 8) {
      setErrors(prev => ({ ...prev, profile: 'New password must be at least 8 characters' }));
      return false;
    }

    if (profile.newPassword !== profile.confirmNewPassword) {
      setErrors(prev => ({ ...prev, profile: 'New passwords do not match' }));
      return false;
    }

    return true;
  };

  // Handler for saving API keys
  const handleSaveApiKeys = async () => {
    setIsLoading(true);
    setErrors({});
    setSuccessMessage('');

    try {
      setApiKeys(keys);
      setSuccessMessage('API keys saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      setErrors({ apiKeys: 'Failed to save API keys' });
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for updating profile
  const handleUpdateProfile = async () => {
    if (!validateProfile()) {
      return;
    }

    setIsLoading(true);
    setErrors({});
    setSuccessMessage('');

    try {
      const updateData: any = {};
      
      if (profile.newPassword) {
        updateData.currentPassword = profile.currentPassword;
        updateData.newPassword = profile.newPassword;
      }

      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      setSuccessMessage('Profile updated successfully!');
      // Clear password fields
      setProfile(prev => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      }));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error: any) {
      setErrors({ profile: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  // Handler for password reset
  const handlePasswordReset = async () => {
    if (!user?.email) return;

    setIsLoading(true);
    setErrors({});
    setSuccessMessage('');

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: user.email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setSuccessMessage('Password reset email sent! Check your inbox.');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error: any) {
      setErrors({ general: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center p-8">
        <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-400">Please log in to access user settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Success Message */}
      {successMessage && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md text-green-400">
          {successMessage}
        </div>
      )}

      {/* General Error */}
      {errors.general && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-md text-red-500">
          {errors.general}
        </div>
      )}

      {/* Profile Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Profile Settings</h3>
        </div>
        
        <div className="space-y-4 p-4 bg-white/5 rounded-lg border border-white/10">
          <div className="space-y-2">
            <Label htmlFor="profile-email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Address
            </Label>
            <Input
              id="profile-email"
              type="email"
              value={profile.email}
              disabled
              className="bg-black/20 border-white/20 opacity-60"
            />
            <p className="text-xs text-gray-400">Email address cannot be changed</p>
          </div>

          <Separator className="bg-white/10" />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              <h4 className="font-medium">Change Password</h4>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={profile.currentPassword}
                onChange={(e) => handleProfileChange('currentPassword', e.target.value)}
                className="bg-black/20 border-white/20"
                placeholder="Enter current password"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={profile.newPassword}
                onChange={(e) => handleProfileChange('newPassword', e.target.value)}
                className="bg-black/20 border-white/20"
                placeholder="Enter new password"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={profile.confirmNewPassword}
                onChange={(e) => handleProfileChange('confirmNewPassword', e.target.value)}
                className="bg-black/20 border-white/20"
                placeholder="Confirm new password"
                disabled={isLoading}
              />
            </div>

            {errors.profile && (
              <p className="text-red-500 text-sm">{errors.profile}</p>
            )}

            <div className="flex gap-2">
              <Button 
                onClick={handleUpdateProfile} 
                disabled={isLoading}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {isLoading ? 'Updating...' : 'Update Password'}
              </Button>
              
              <Button 
                variant="outline" 
                onClick={handlePasswordReset}
                disabled={isLoading}
              >
                Send Reset Email
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Separator className="bg-white/10" />

      {/* API Keys Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <KeyIcon className="h-5 w-5" />
          <h3 className="text-lg font-semibold">API Keys</h3>
        </div>
        
        <div className="space-y-4 p-4 bg-white/5 rounded-lg border border-white/10">
          {Object.entries(PROVIDERS).map(([providerId, providerInfo]) => (
            <div key={providerId} className="space-y-2">
              <Label htmlFor={`api-key-${providerId}`}>{providerInfo.name} API Key</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`api-key-${providerId}`}
                  type={showKeys[providerId] ? "text" : "password"}
                  value={keys[providerId] || ''}
                  onChange={(e) => handleApiKeyChange(providerId, e.target.value)}
                  className="bg-black/20 border-white/20 flex-1"
                  placeholder={`Enter your ${providerInfo.name} API Key`}
                  disabled={isLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleKeyVisibility(providerId)}
                  className="px-3"
                >
                  {showKeys[providerId] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}
          
          {errors.apiKeys && (
            <p className="text-red-500 text-sm">{errors.apiKeys}</p>
          )}
          
          <Button 
            onClick={handleSaveApiKeys} 
            disabled={isLoading}
            className="w-full flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {isLoading ? 'Saving...' : 'Save API Keys'}
          </Button>
          
          <p className="text-xs text-gray-400">
            API keys are stored locally in your browser. For enhanced security, consider using environment variables or a secure key management service.
          </p>
        </div>
      </div>

      {/* Account Actions */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-red-400">Danger Zone</h3>
        <div className="p-4 bg-red-500/5 rounded-lg border border-red-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-red-400">Sign Out</h4>
              <p className="text-sm text-gray-400">Sign out of your account on this device</p>
            </div>
            <Button 
              variant="destructive" 
              onClick={logout}
              disabled={isLoading}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
