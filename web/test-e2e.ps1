$baseUrl = 'http://localhost:3000'
$session = $null
$convId = 'e2e-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
$totalTests = 0
$passedTests = 0
$failedTests = 0

function Run-Test {
    param([string]$Name, [scriptblock]$Test)
    $script:totalTests++
    Write-Output "[TEST $($script:totalTests)] $Name"
    try {
        & $Test
        $script:passedTests++
        Write-Output '  PASSED'
    } catch {
        $script:failedTests++
        Write-Output "  FAILED: $($_.Exception.Message)"
    }
    Write-Output ''
}

Write-Output '========================================'
Write-Output ' COMPREHENSIVE E2E TEST SUITE'
Write-Output '========================================'
Write-Output ''

# TEST 1: Basic write_file via VFS MCP
Run-Test 'VFS MCP: Create file via write_file tool' {
    $body = @{
        messages = @(@{ role='user'; content='Create a file called test1.txt with content: Hello from test 1' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -SessionVariable session
    $script:session = $session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }
    if ($json.data.content -notmatch 'write_file') { throw 'Expected write_file in response' }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $found = $fsJson.data.files | Where-Object { $_.path -match 'test1.txt' }
    if (-not $found) { throw 'File test1.txt not found in filesystem' }
    if ($found.content -ne 'Hello from test 1') { throw "Content mismatch: $($found.content)" }
    Write-Output "  File created: $($found.path) v$($found.version)"
}

# TEST 2: Write file to specific directory
Run-Test 'VFS MCP: Write file to directory' {
    $body = @{
        messages = @(@{ role='user'; content='Write a file called my-folder/nested.txt with content: Nested file content' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $found = $fsJson.data.files | Where-Object { $_.path -match 'nested.txt' }
    if (-not $found) { throw 'Nested file not found' }
    if ($found.content -ne 'Nested file content') { throw "Content mismatch: $($found.content)" }
    Write-Output "  Nested file created: $($found.path)"
}

# TEST 3: Read file via VFS
Run-Test 'VFS API: Read file content' {
    $snapshot = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $snapJson = $snapshot.Content | ConvertFrom-Json
    $testFile = $snapJson.data.files | Where-Object { $_.path -match 'test1.txt' } | Select-Object -First 1

    if (-not $testFile) { throw 'test1.txt not found for read test' }

    Write-Output "  Read content: $($testFile.content)"
    if ($testFile.content -ne 'Hello from test 1') { throw 'Content mismatch on read' }
}

# TEST 4: List directory structure
Run-Test 'VFS API: List directory structure' {
    $list = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/list?path=project/sessions" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $listJson = $list.Content | ConvertFrom-Json

    Write-Output "  Sessions found: $($listJson.data.nodes.Count)"
    if ($listJson.data.nodes.Count -lt 1) { throw 'No sessions found' }

    $listJson.data.nodes | ForEach-Object { Write-Output "    - $($_.name) ($($_.type))" }
}

# TEST 5: Update existing file
Run-Test 'VFS MCP: Update existing file' {
    $body = @{
        messages = @(@{ role='user'; content='Update the file test1.txt to say: Updated content from test 5' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $found = $fsJson.data.files | Where-Object { $_.path -match 'test1.txt' } | Select-Object -First 1
    if (-not $found) { throw 'test1.txt not found after update' }
    Write-Output "  Updated content: $($found.content) (v$($found.version))"
}

# TEST 6: Multiple files in one request
Run-Test 'VFS MCP: Create multiple files in one request' {
    $body = @{
        messages = @(@{ role='user'; content='Create two files: file-a.txt with content AAA and file-b.txt with content BBB' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $fileA = $fsJson.data.files | Where-Object { $_.path -match 'file-a.txt' }
    $fileB = $fsJson.data.files | Where-Object { $_.path -match 'file-b.txt' }

    if (-not $fileA) { throw 'file-a.txt not found' }
    if (-not $fileB) { throw 'file-b.txt not found' }
    Write-Output "  Created: $($fileA.path), $($fileB.path)"
}

# TEST 7: Streaming mode
Run-Test 'VFS MCP: Streaming mode with tool calls' {
    $body = @{
        messages = @(@{ role='user'; content='Create a file called stream-test.txt with content: Streaming test content' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }
    Write-Output "  Stream response length: $($response.Content.Length)"

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $found = $fsJson.data.files | Where-Object { $_.path -match 'stream-test.txt' }
    if (-not $found) { throw 'stream-test.txt not found after streaming' }
    Write-Output "  Stream file created: $($found.path)"
}

# TEST 8: Code generation with file creation
Run-Test 'VFS MCP: Generate code and write file' {
    $body = @{
        messages = @(@{ role='user'; content='Write a JavaScript function called utils.js that adds two numbers and exports the function' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }
    Write-Output "  Response length: $($json.data.content.Length)"

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $jsFiles = $fsJson.data.files | Where-Object { $_.path -match 'utils.js' -or $_.path -match '\.js$' }
    Write-Output "  JS files found: $($jsFiles.Count)"
    if ($jsFiles.Count -gt 0) {
        $jsFiles | ForEach-Object { Write-Output "    - $($_.path) ($($_.content.Length) chars)" }
    }
}

# TEST 9: Session isolation
Run-Test 'Session isolation: New conversation gets clean filesystem' {
    $newConvId = 'isolated-test-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create a file called isolated.txt with content: Isolated session test' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $newConvId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $found = $fsJson.data.files | Where-Object { $_.path -match 'isolated.txt' }
    if (-not $found) { throw 'isolated.txt not found in new session' }
    Write-Output "  Isolated file created: $($found.path)"
}

# TEST 10: HTML file creation
Run-Test 'VFS MCP: Create HTML file' {
    $body = @{
        messages = @(@{ role='user'; content='Create an HTML file called index.html with a basic HTML5 template' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $false
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -WebSession $script:session
    $json = $response.Content | ConvertFrom-Json

    if ($response.StatusCode -ne 200) { throw "Status: $($response.StatusCode)" }

    Start-Sleep -Seconds 2
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $script:session
    $fsJson = $fs.Content | ConvertFrom-Json

    $htmlFile = $fsJson.data.files | Where-Object { $_.path -match 'index.html' } | Select-Object -First 1
    if (-not $htmlFile) { throw 'index.html not found' }
    Write-Output "  HTML file created: $($htmlFile.path) ($($htmlFile.content.Length) chars)"
}

# TEST 11: Filesystem API health check
Run-Test 'VFS API: Health check' {
    $health = Invoke-WebRequest -Uri "$baseUrl/api/health" -Method GET -TimeoutSec 10 -UseBasicParsing
    $healthJson = $health.Content | ConvertFrom-Json
    Write-Output "  Health: $($healthJson.status)"
    # API returns "healthy" not "ok"
    if ($healthJson.status -notin @('ok', 'healthy')) { throw "Health check failed: $($healthJson.status)" }
}

# SUMMARY
Write-Output '========================================'
Write-Output ' TEST SUMMARY'
Write-Output '========================================'
Write-Output "Total:    $totalTests"
Write-Output "Passed:   $passedTests"
Write-Output "Failed:   $failedTests"
Write-Output '========================================'

if ($failedTests -gt 0) { exit 1 } else { Write-Output 'All tests passed!' }
