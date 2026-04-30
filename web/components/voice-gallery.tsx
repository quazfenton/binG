"use client";

import React, { useState } from "react";
import { useAvailableVoices, useVoiceSettings } from "@/lib/voice/use-voice";

/**
 * Voice Gallery Component
 * 
 * IMPROVEMENT: Provides UI to preview different available voices
 * Allows users to find and select their preferred voice
 */
export function VoiceGallery() {
  const { voices, previewVoice, getVoiceInfo, selectedVoiceIndex } = useAvailableVoices();
  const { updateSettings, settings } = useVoiceSettings();
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewText, setPreviewText] = useState("This is a voice preview");

  if (!voices.length) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No voices available on this device.
      </div>
    );
  }

  const handleVoiceSelect = (voiceIndex: number) => {
    updateSettings({ voiceIndex });
  };

  const handlePreviewClick = async (voiceIndex: number) => {
    setIsPreviewPlaying(true);
    try {
      await previewVoice(voiceIndex, previewText);
    } finally {
      setIsPreviewPlaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">
          Preview Text
        </label>
        <input
          type="text"
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          placeholder="Enter text to preview voices"
          className="w-full px-3 py-2 border rounded-md text-sm"
          maxLength={100}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
        {voices.map((voice, index) => {
          const voiceInfo = getVoiceInfo(index);
          const isSelected = settings?.voiceIndex === index;

          return (
            <div
              key={`${voice.name}-${voice.lang}`}
              className={`p-3 border rounded-md cursor-pointer transition ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
              onClick={() => handleVoiceSelect(index)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="font-medium text-sm">{voice.name}</h4>
                  <p className="text-xs text-gray-500">{voice.lang}</p>
                  {voice.default && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-xs rounded">
                      Default
                    </span>
                  )}
                </div>
                {voice.localService && (
                  <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
                    Local
                  </span>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreviewClick(index);
                }}
                disabled={isPreviewPlaying}
                className={`w-full px-3 py-1 text-sm rounded transition ${
                  isPreviewPlaying
                    ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                    : "bg-blue-500 text-white hover:bg-blue-600"
                }`}
              >
                {isPreviewPlaying && selectedVoiceIndex === index ? "Playing..." : "Preview"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-gray-500">
        {voices.length} voice{voices.length !== 1 ? "s" : ""} available
      </div>
    </div>
  );
}

/**
 * Voice Settings Panel
 * 
 * IMPROVEMENT: Centralized settings management with VAD controls
 */
export function VoiceSettingsPanel() {
  const { settings, updateSettings, setVADEnabled, configureVAD } = useVoiceSettings();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!settings) {
    return <div>Loading voice settings...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <input
          type="checkbox"
          id="voice-enabled"
          checked={settings.enabled}
          onChange={(e) => updateSettings({ enabled: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="voice-enabled" className="text-sm font-medium">
          Enable Voice
        </label>
      </div>

      {settings.enabled && (
        <>
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="auto-speak"
              checked={settings.autoSpeak}
              onChange={(e) => updateSettings({ autoSpeak: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="auto-speak" className="text-sm font-medium">
              Auto-Speak Full Response
            </label>
          </div>

          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="auto-speak-stream"
              checked={settings.autoSpeakStream}
              onChange={(e) => updateSettings({ autoSpeakStream: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="auto-speak-stream" className="text-sm font-medium">
              Auto-Speak Stream (Incremental)
            </label>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Speech Rate: {settings.speechRate.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.speechRate}
              onChange={(e) => updateSettings({ speechRate: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Speech Pitch: {settings.speechPitch.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.speechPitch}
              onChange={(e) => updateSettings({ speechPitch: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Volume: {Math.round(settings.speechVolume * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.speechVolume}
              onChange={(e) => updateSettings({ speechVolume: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="microphone-enabled"
              checked={settings.microphoneEnabled}
              onChange={(e) => updateSettings({ microphoneEnabled: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="microphone-enabled" className="text-sm font-medium">
              Microphone
            </label>
          </div>

          {settings.microphoneEnabled && (
            <>
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="transcription-enabled"
                  checked={settings.transcriptionEnabled}
                  onChange={(e) => updateSettings({ transcriptionEnabled: e.target.checked })}
                  className="rounded"
                />
                <label htmlFor="transcription-enabled" className="text-sm font-medium">
                  Transcription
                </label>
              </div>

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {showAdvanced ? "Hide" : "Show"} Advanced VAD Settings
              </button>

              {showAdvanced && (
                <div className="space-y-2 p-3 bg-gray-50 rounded">
                  <label className="text-sm font-medium">
                    VAD Sensitivity
                  </label>
                  <button
                    onClick={() => {
                      setVADEnabled(true);
                      configureVAD(1500, 0.02); // 1.5s silence, low threshold
                    }}
                    className="w-full px-3 py-2 text-sm bg-green-100 hover:bg-green-200 rounded"
                  >
                    Enable VAD (Auto-Stop on Silence)
                  </button>
                  <button
                    onClick={() => setVADEnabled(false)}
                    className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    Disable VAD (Manual Stop)
                  </button>
                  <p className="text-xs text-gray-600">
                    Voice Activity Detection automatically stops listening when silence is detected.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
