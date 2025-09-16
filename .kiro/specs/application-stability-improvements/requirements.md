# Requirements Document

## Introduction

This feature addresses critical stability and functionality issues in the application, including UI reorganization, authentication system improvements, code mode fixes, and resolution of TypeScript errors causing infinite render loops. The goal is to create a more stable, user-friendly application with proper authentication flow and working core features.

## Requirements

### Requirement 1

**User Story:** As a user, I want the plugin interface to be better organized so that I can easily find and access different types of tools and features.

#### Acceptance Criteria

1. WHEN I navigate to the interface THEN the "Advanced AI Plugins" section SHALL be moved from the Plugins tab to a renamed "Extra" tab (previously "Images")
2. WHEN I view the Plugins tab THEN the "Modular Tools" section SHALL remain in its current location
3. WHEN I access the Extra tab THEN I SHALL see both image-related features and the Advanced AI Plugins section
4. WHEN the reorganization is complete THEN all existing functionality SHALL work without breaking changes

### Requirement 2

**User Story:** As a new user, I want to create an account and have my credentials securely stored so that I can access personalized features and maintain my session across visits.

#### Acceptance Criteria

1. WHEN I access the application THEN I SHALL see an option to create a new account instead of a mock account
2. WHEN I register with an email THEN the system SHALL check if the email is already in use
3. IF the email is already registered THEN the system SHALL display an appropriate error message
4. WHEN I successfully register THEN my credentials SHALL be stored in the database
5. WHEN I log in with valid credentials THEN my session SHALL persist across browser sessions
6. WHEN I close and reopen the application THEN I SHALL remain logged in if my session is valid
7. WHEN I log out THEN my session SHALL be properly terminated

### Requirement 3

**User Story:** As a developer, I want the chat and code mode functionality to work properly so that I can send prompts and receive responses without streaming errors or incorrect diff handling.

#### Acceptance Criteria

1. WHEN I send a prompt in Chat tab THEN the system SHALL NOT show "failed to parse stream string. invalid code event" errors
2. WHEN I send a prompt in Chat tab THEN the API response SHALL be properly displayed and streamed to the user
3. WHEN I send a prompt in Chat tab THEN the system SHALL NOT incorrectly trigger diff proposals for non-code responses
4. WHEN I send a prompt in Code tab THEN the system SHALL NOT make duplicate API calls (POST /api/code)
5. WHEN I send a prompt in Code tab THEN the system SHALL NOT return HTTP 400 errors from startSession
6. WHEN I send a prompt in Code tab THEN the code-preview-panel SHALL NOT automatically open unless there is actual code to preview
7. WHEN diff proposals are shown THEN they SHALL only appear for Code tab responses that contain actual file edits
8. WHEN input is processed THEN the system SHALL NOT parse the input prompt, only parse API responses for code extraction

### Requirement 4

**User Story:** As a user, I want proper separation between Chat and Code modes so that each mode handles responses appropriately without interference.

#### Acceptance Criteria

1. WHEN I am in Chat tab THEN responses SHALL not ask to accept pending diffs unneccesarily 
2. WHEN I am in Code tab THEN responses SHALL be processed for code extraction and diff generation only if they contain file edits
3. WHEN I switch between tabs THEN the enhanced-code-system SHALL only be active for Code tab interactions
4. WHEN a response contains code blocks THEN they SHALL be displayed as formatted code, not treated as file diffs
5. WHEN a response contains actual file edits to existing files THEN diff proposals SHALL be generated only in Code tab
6. WHEN I am in Chat tab THEN the code-preview-panel SHALL never be triggered or opened

### Requirement 5

**User Story:** As a developer, I want the application to be free of TypeScript errors and infinite render loops so that the application runs smoothly and efficiently.

#### Acceptance Criteria

1. WHEN I run `npx tsc` THEN there SHALL be no TypeScript compilation errors
2. WHEN components render THEN there SHALL be no "Maximum update depth exceeded" errors
3. WHEN useEffect hooks are used THEN they SHALL have proper dependency arrays to prevent infinite lo
5. IF user is already logged in THEN the system SHALL show logout option instead

### Requirement 6

**User Story:** As a user, I want the streaming API responses to work correctly so that I can see responses in real-time without parsing errors.

#### Acceptance Criteria

1. WHEN the system receives streaming responses THEN it SHALL properly parse and display the content
2. WHEN streaming encounters invalid events THEN the system SHALL handle them gracefully without showing error messages to users
3. WHEN API calls are made THEN there SHALL be no duplicate requests for the same user action
4. WHEN the /api/chat endpoint responds THEN the response SHALL be properly streamed and displayed in the UI
5. WHEN the /api/code endpoint is called THEN it SHALL not return 400 errors for valid requests
6. WHEN streaming is active THEN the system SHALL maintain proper connection state and error recovery

### Requirement 7

**User Story:** As a user, I want robust plugins that enhance my workflow, so that I can extend the application's functionality reliably.

#### Acceptance Criteria

1. WHEN using plugins THEN the system SHALL ensure they load and function without errors
2. WHEN a plugin fails THEN the system SHALL isolate the failure and continue operating
3. WHEN plugins interact with core features THEN the system SHALL maintain data integrity
4. IF plugin dependencies are missing THEN the system SHALL handle gracefully with fallbacks
5. WHEN multiple plugins are active THEN the system SHALL manage resource usage efficiently
6. WHEN plugins update THEN the system SHALL maintain backward compatibility where possible