#!/bin/bash
# V2 Agent Manual Testing Script
# Run this script to manually test V2 agent functionality

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${TEST_API_BASE_URL:-http://localhost:3000}"
SESSION_ID=""
CONVERSATION_ID="test-manual-$(date +%s)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}V2 Agent Manual Testing Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_server() {
    log_info "Checking if server is running at $API_BASE_URL..."
    if curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL" | grep -q "200\|307"; then
        log_success "Server is running"
        return 0
    else
        log_error "Server is not responding at $API_BASE_URL"
        return 1
    fi
}

# Test 1: Create V2 Session
test_create_session() {
    log_info "Creating V2 session..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/agent/v2/session" \
        -H "Content-Type: application/json" \
        -d "{
            \"conversationId\": \"$CONVERSATION_ID\",
            \"enableNullclaw\": ${NULLCLAW_ENABLED:-false},
            \"enableMCP\": ${MCP_ENABLED:-false}
        }")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
        V2_SESSION_ID=$(echo "$RESPONSE" | grep -o '"v2SessionId":"[^"]*"' | cut -d'"' -f4)
        log_success "Session created: $SESSION_ID (V2: $V2_SESSION_ID)"
        return 0
    else
        log_error "Failed to create session: $RESPONSE"
        return 1
    fi
}

# Test 2: Verify Session ID Resolution (Fix for split(':') bug)
test_session_id_resolution() {
    log_info "Testing session ID resolution (UUID without split(':'))..."
    
    if [ -z "$SESSION_ID" ]; then
        log_error "No session ID available"
        return 1
    fi
    
    RESPONSE=$(curl -s -X GET "$API_BASE_URL/api/agent/v2/session?sessionId=$SESSION_ID")
    
    if echo "$RESPONSE" | grep -q "\"sessionId\":\"$SESSION_ID\""; then
        log_success "Session ID resolution works correctly"
        return 0
    else
        log_error "Session ID resolution failed: $RESPONSE"
        return 1
    fi
}

# Test 3: VFS Write
test_vfs_write() {
    log_info "Writing test file to VFS..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/filesystem/write" \
        -H "Content-Type: application/json" \
        -d "{
            \"path\": \"project/test-v2-manual.txt\",
            \"content\": \"Test content from manual test at $(date)\",
            \"sessionId\": \"$SESSION_ID\"
        }")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        log_success "File written to VFS"
        return 0
    else
        log_error "Failed to write file: $RESPONSE"
        return 1
    fi
}

# Test 4: Sync VFS to Sandbox
test_sync_to_sandbox() {
    log_info "Syncing VFS to sandbox..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/agent/v2/sync" \
        -H "Content-Type: application/json" \
        -d "{
            \"sessionId\": \"$SESSION_ID\",
            \"direction\": \"to-sandbox\"
        }")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        FILES_SYNCED=$(echo "$RESPONSE" | grep -o '"filesSynced":[0-9]*' | cut -d':' -f2)
        log_success "Synced $FILES_SYNCED files to sandbox"
        return 0
    else
        log_error "Sync failed: $RESPONSE"
        return 1
    fi
}

# Test 5: Execute V2 Task
test_execute_task() {
    log_info "Executing V2 task..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/agent/v2/execute" \
        -H "Content-Type: application/json" \
        -d "{
            \"sessionId\": \"$SESSION_ID\",
            \"task\": \"Read project/test-v2-manual.txt and append ' - Modified by V2 agent'\",
            \"stream\": false
        }")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        log_success "Task executed successfully"
        OUTPUT=$(echo "$RESPONSE" | grep -o '"output":"[^"]*"' | cut -d'"' -f4 | head -c 100)
        log_info "Output: $OUTPUT..."
        return 0
    else
        log_error "Task execution failed: $RESPONSE"
        return 1
    fi
}

# Test 6: Sync from Sandbox
test_sync_from_sandbox() {
    log_info "Syncing sandbox changes back to VFS..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/agent/v2/sync" \
        -H "Content-Type: application/json" \
        -d "{
            \"sessionId\": \"$SESSION_ID\",
            \"direction\": \"from-sandbox\"
        }")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        log_success "Sandbox synced back to VFS"
        return 0
    else
        log_error "Sync from sandbox failed: $RESPONSE"
        return 1
    fi
}

# Test 7: Verify VFS Changes
test_verify_vfs_changes() {
    log_info "Verifying VFS changes..."
    
    RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/filesystem/read" \
        -H "Content-Type: application/json" \
        -d "{\"path\": \"project/test-v2-manual.txt\"}")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        CONTENT=$(echo "$RESPONSE" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)
        if echo "$CONTENT" | grep -q "Modified by V2 agent"; then
            log_success "VFS changes verified - file was modified by agent"
            return 0
        else
            log_warning "File content doesn't show expected modification: $CONTENT"
            return 1
        fi
    else
        log_error "Failed to read file: $RESPONSE"
        return 1
    fi
}

# Test 8: Streaming Test
test_streaming() {
    log_info "Testing streaming response..."
    
    # Use curl with event stream parsing
    RESPONSE=$(curl -s -N -X POST "$API_BASE_URL/api/agent/v2/execute" \
        -H "Content-Type: application/json" \
        -d "{
            \"sessionId\": \"$SESSION_ID\",
            \"task\": \"Count from 1 to 3\",
            \"stream\": true
        }" | head -20)
    
    if echo "$RESPONSE" | grep -q "event: init"; then
        log_success "Streaming response received"
        echo "$RESPONSE" | grep "^event:" | head -5
        return 0
    else
        log_error "Streaming failed or no events received"
        return 1
    fi
}

# Test 9: Session Status (State Consistency)
test_session_status() {
    log_info "Checking session status (state consistency)..."
    
    RESPONSE=$(curl -s -X GET "$API_BASE_URL/api/agent/v2/session/status?sessionId=$SESSION_ID")
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        AGENT_STATE=$(echo "$RESPONSE" | grep -o '"agentState":"[^"]*"' | cut -d'"' -f4)
        V2_STATE=$(echo "$RESPONSE" | grep -o '"v2State":"[^"]*"' | cut -d'"' -f4)
        log_success "Session status: Agent=$AGENT_STATE, V2=$V2_STATE"
        
        # Verify state mapping
        case "$AGENT_STATE" in
            "ready")
                if [ "$V2_STATE" = "active" ]; then
                    log_success "State mapping correct (ready → active)"
                else
                    log_warning "Unexpected V2 state for ready: $V2_STATE"
                fi
                ;;
            "busy")
                if [ "$V2_STATE" = "active" ]; then
                    log_success "State mapping correct (busy → active)"
                else
                    log_warning "Unexpected V2 state for busy: $V2_STATE"
                fi
                ;;
            "idle")
                if [ "$V2_STATE" = "idle" ]; then
                    log_success "State mapping correct (idle → idle)"
                else
                    log_warning "Unexpected V2 state for idle: $V2_STATE"
                fi
                ;;
            *)
                log_warning "Unknown agent state: $AGENT_STATE"
                ;;
        esac
        return 0
    else
        log_error "Failed to get session status: $RESPONSE"
        return 1
    fi
}

# Test 10: Cleanup
test_cleanup() {
    log_info "Cleaning up test session..."
    
    if [ -n "$SESSION_ID" ]; then
        RESPONSE=$(curl -s -X DELETE "$API_BASE_URL/api/agent/v2/session?sessionId=$SESSION_ID")
        
        if echo "$RESPONSE" | grep -q '"success":true'; then
            log_success "Session destroyed successfully"
            return 0
        else
            log_warning "Session cleanup returned: $RESPONSE"
            return 1
        fi
    else
        log_warning "No session ID to cleanup"
        return 0
    fi
}

# Main test runner
run_all_tests() {
    echo ""
    echo -e "${BLUE}Running all tests...${NC}"
    echo ""
    
    TESTS_PASSED=0
    TESTS_FAILED=0
    
    # Check server first
    check_server || exit 1
    
    # Run tests in order
    test_create_session && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_session_id_resolution && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_vfs_write && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_sync_to_sandbox && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_execute_task && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_sync_from_sandbox && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_verify_vfs_changes && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_streaming && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_session_status && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    test_cleanup && ((TESTS_PASSED++)) || ((TESTS_FAILED++))
    
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Test Results${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo ""
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    else
        echo -e "${RED}Some tests failed${NC}"
        return 1
    fi
}

# Print usage
print_usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  all          - Run all tests (default)"
    echo "  session      - Test session creation and ID resolution"
    echo "  sync         - Test VFS ↔ Sandbox sync"
    echo "  execute      - Test task execution"
    echo "  streaming    - Test streaming response"
    echo "  status       - Test session status/state"
    echo "  cleanup      - Cleanup test session"
    echo "  help         - Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  TEST_API_BASE_URL  - API base URL (default: http://localhost:3000)"
    echo "  NULLCLAW_ENABLED   - Enable Nullclaw tests (default: false)"
    echo "  MCP_ENABLED        - Enable MCP tests (default: false)"
    echo ""
}

# Parse command
COMMAND="${1:-all}"

case "$COMMAND" in
    all)
        run_all_tests
        ;;
    session)
        check_server
        test_create_session
        test_session_id_resolution
        test_session_status
        ;;
    sync)
        check_server
        test_create_session
        test_vfs_write
        test_sync_to_sandbox
        test_sync_from_sandbox
        test_verify_vfs_changes
        test_cleanup
        ;;
    execute)
        check_server
        test_create_session
        test_execute_task
        test_cleanup
        ;;
    streaming)
        check_server
        test_create_session
        test_streaming
        test_cleanup
        ;;
    status)
        check_server
        test_create_session
        test_session_status
        test_cleanup
        ;;
    cleanup)
        test_cleanup
        ;;
    help|--help|-h)
        print_usage
        ;;
    *)
        echo "Unknown command: $COMMAND"
        print_usage
        exit 1
        ;;
esac
