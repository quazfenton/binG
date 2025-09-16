/**
 * Example Usage of Enhanced API Client
 * 
 * Demonstrates how to use the enhanced API client with fallback systems,
 * retry logic, and comprehensive error handling.
 */

import { enhancedAPIClient, createEnhancedAPIClient } from './enhanced-api-client';
import { enhancedLLMService } from './enhanced-llm-service';
import { errorHandler } from './error-handler';

// Example 1: Basic API request with retry logic
export async function basicAPIExample() {
  try {
    const response = await enhancedAPIClient.request({
      url: 'https://api.example.com/data',
      method: 'GET',
      retries: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 10000,
        jitter: true,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504]
      },
      timeout: 30000,
      circuitBreaker: true
    });

    console.log('API Response:', response.data);
    console.log('Response Time:', response.duration, 'ms');
    return response.data;
  } catch (error) {
    const processedError = errorHandler.processError(
      error instanceof Error ? error : new Error(String(error)),
      {
        component: 'basic-api-example',
        operation: 'fetchData'
      }
    );

    console.error('User Message:', processedError.userMessage);
    console.error('Suggested Action:', processedError.suggestedAction);
    
    if (processedError.isRetryable) {
      console.log('This error is retryable. Consider implementing retry logic.');
    }

    throw error;
  }
}

// Example 2: API request with fallback endpoints
export async function fallbackAPIExample() {
  const primaryConfig = {
    url: 'https://primary-api.example.com/service',
    method: 'POST' as const,
    data: { query: 'test data' },
    headers: {
      'Authorization': 'Bearer primary-token'
    }
  };

  const fallbackConfigs = [
    {
      url: 'https://fallback1-api.example.com/service',
      method: 'POST' as const,
      data: { query: 'test data' },
      headers: {
        'Authorization': 'Bearer fallback1-token'
      }
    },
    {
      url: 'https://fallback2-api.example.com/service',
      method: 'POST' as const,
      data: { query: 'test data' },
      headers: {
        'Authorization': 'Bearer fallback2-token'
      }
    }
  ];

  try {
    const response = await enhancedAPIClient.withFallback(primaryConfig, fallbackConfigs);
    console.log('Successful response from:', response.config.url);
    return response.data;
  } catch (error) {
    console.error('All endpoints failed:', error);
    throw error;
  }
}

// Example 3: Enhanced LLM service with automatic fallbacks
export async function enhancedLLMExample() {
  try {
    const response = await enhancedLLMService.generateResponse({
      messages: [
        { role: 'user', content: 'Hello, how are you?' }
      ],
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1-0528:free',
      temperature: 0.7,
      maxTokens: 100,
      stream: false,
      apiKeys: {},
      // Enhanced features
      fallbackProviders: ['chutes', 'anthropic'],
      retryOptions: {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000
      },
      enableCircuitBreaker: true
    });

    console.log('LLM Response:', response.content);
    console.log('Provider Used:', response.provider);
    
    // Check if fallback was used
    if (response.provider.includes('->')) {
      console.log('Fallback provider was automatically used');
    }

    return response;
  } catch (error) {
    console.error('LLM request failed:', error);
    throw error;
  }
}

// Example 4: Streaming with fallback
export async function streamingWithFallbackExample() {
  try {
    const stream = enhancedLLMService.generateStreamingResponse({
      messages: [
        { role: 'user', content: 'Tell me a short story' }
      ],
      provider: 'openrouter',
      model: 'deepseek/deepseek-r1-0528:free',
      temperature: 0.8,
      maxTokens: 500,
      stream: true,
      apiKeys: {},
      fallbackProviders: ['chutes', 'anthropic']
    });

    let fullContent = '';
    for await (const chunk of stream) {
      if (chunk.content) {
        fullContent += chunk.content;
        process.stdout.write(chunk.content); // Stream to console
      }
      
      if (chunk.isComplete) {
        console.log('\n--- Streaming Complete ---');
        break;
      }
    }

    return fullContent;
  } catch (error) {
    console.error('Streaming failed:', error);
    throw error;
  }
}

// Example 5: Health monitoring and circuit breaker management
export async function healthMonitoringExample() {
  // Start health monitoring for key endpoints
  const endpoints = [
    'https://api.openrouter.ai/api/v1',
    'https://llm.chutes.ai/v1',
    'https://api.anthropic.com/v1'
  ];

  enhancedAPIClient.startHealthMonitoring(endpoints, 60000); // Check every minute

  // Get current health status
  const healthStatus = enhancedAPIClient.getEndpointHealth();
  console.log('Endpoint Health:', healthStatus);

  // Get circuit breaker statistics
  const circuitBreakerStats = enhancedAPIClient.getCircuitBreakerStats();
  console.log('Circuit Breaker Stats:', circuitBreakerStats);

  // Get provider health from LLM service
  const providerHealth = enhancedLLMService.getProviderHealth();
  console.log('Provider Health:', providerHealth);

  // Get available providers
  const availableProviders = enhancedLLMService.getAvailableProviders();
  console.log('Available Providers:', availableProviders);

  // Reset circuit breaker for a specific provider if needed
  // enhancedLLMService.resetProviderHealth('openrouter');

  return {
    endpointHealth: healthStatus,
    circuitBreakerStats,
    providerHealth,
    availableProviders
  };
}

// Example 6: Error statistics and analysis
export async function errorAnalysisExample() {
  // Get error statistics
  const errorStats = errorHandler.getErrorStats();
  console.log('Error Statistics:', errorStats);

  // Get frequent errors
  const frequentErrors = errorHandler.getFrequentErrors(3); // Errors that occurred 3+ times
  console.log('Frequent Errors:', frequentErrors);

  // Create a user notification for an error
  const sampleError = errorHandler.processError(
    new Error('Rate limit exceeded'),
    {
      component: 'chat-api',
      provider: 'openrouter',
      operation: 'generateResponse'
    }
  );

  const notification = errorHandler.createUserNotification(sampleError);
  console.log('User Notification:', notification);

  return {
    errorStats,
    frequentErrors,
    sampleNotification: notification
  };
}

// Example 7: Custom API client configuration
export async function customConfigExample() {
  // Create a custom API client with specific circuit breaker settings
  const customClient = createEnhancedAPIClient({
    failureThreshold: 3, // Open circuit after 3 failures
    recoveryTimeout: 15000, // Try again after 15 seconds
    monitoringWindow: 30000 // Monitor failures over 30 seconds
  });

  try {
    const response = await customClient.request({
      url: 'https://api.example.com/custom',
      method: 'GET',
      retries: {
        maxAttempts: 5,
        backoffStrategy: 'linear',
        baseDelay: 500,
        maxDelay: 5000,
        jitter: false,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      }
    });

    return response.data;
  } finally {
    // Clean up custom client
    customClient.destroy();
  }
}

// Example usage function
export async function runExamples() {
  console.log('=== Enhanced API Client Examples ===\n');

  try {
    console.log('1. Health Monitoring Example:');
    await healthMonitoringExample();
    console.log('\n');

    console.log('2. Error Analysis Example:');
    await errorAnalysisExample();
    console.log('\n');

    // Uncomment to run other examples (they require actual API endpoints)
    /*
    console.log('3. Basic API Example:');
    await basicAPIExample();
    console.log('\n');

    console.log('4. Fallback API Example:');
    await fallbackAPIExample();
    console.log('\n');

    console.log('5. Enhanced LLM Example:');
    await enhancedLLMExample();
    console.log('\n');

    console.log('6. Streaming with Fallback Example:');
    await streamingWithFallbackExample();
    console.log('\n');

    console.log('7. Custom Config Example:');
    await customConfigExample();
    console.log('\n');
    */

  } catch (error) {
    console.error('Example failed:', error);
  } finally {
    // Cleanup
    enhancedAPIClient.destroy();
    enhancedLLMService.destroy();
  }
}

// Export all examples
export {
  basicAPIExample,
  fallbackAPIExample,
  enhancedLLMExample,
  streamingWithFallbackExample,
  healthMonitoringExample,
  errorAnalysisExample,
  customConfigExample
};