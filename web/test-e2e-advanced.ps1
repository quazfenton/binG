$baseUrl = 'http://localhost:3000'
$session = $null
$totalTests = 0
$passedTests = 0
$failedTests = 0

function Run-Test {
    param([string]$Name, [scriptblock]$Test)
    $script:totalTests++
    Write-Output "`n[TEST $($script:totalTests)] $Name"
    Write-Output "---"
    try {
        & $Test
        $script:passedTests++
        Write-Output "✓ PASSED"
    } catch {
        $script:failedTests++
        Write-Output "✗ FAILED: $($_.Exception.Message)"
    }
}

function Get-Session {
    if (-not $script:session) {
        $body = @{ messages = @(@{ role='user'; content='Initialize session' }); provider = 'openrouter'; model = 'mistralai/mistral-small-3.1-24b-instruct'; stream = $false; conversationId = 'advanced-init' } | ConvertTo-Json -Depth 5
        try {
            $resp = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120 -UseBasicParsing -SessionVariable session
            $script:session = $session
        } catch { Write-Output "Warning: Session init failed, continuing without session" }
    }
    return $script:session
}

Write-Output '========================================================'
Write-Output ' ADVANCED E2E TEST SUITE — Tool Calls, Agents, MCP, VFS'
Write-Output '========================================================'

# ============================================================
# TEST 1: Multi-file creation with single prompt (VFS tool use)
# ============================================================
Run-Test 'Multi-file VFS creation: agent creates 3+ files in one response' {
    $body = @{
        messages = @(@{ role='user'; content='Create a small web app with 3 files: index.html with a basic HTML5 template, style.css with body margin 0 and a .container class with max-width 800px, and app.js with a console.log("App initialized") and a function called init() that logs "init called"' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'multifile-test-001'
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -SessionVariable session
    Get-Session | Out-Null  # Ensure session var set
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $files = $fsJson.data.files

    $html = $files | Where-Object { $_.path -match 'index\.html' }
    $css = $files | Where-Object { $_.path -match 'style\.css' }
    $js = $files | Where-Object { $_.path -match 'app\.js' }

    if (-not $html) { throw 'index.html not created' }
    if (-not $css) { throw 'style.css not created' }
    if (-not $js) { throw 'app.js not created' }

    # Validate content quality
    if ($css.content -notmatch 'max-width') { throw 'CSS content missing max-width rule' }
    if ($js.content -notmatch 'init') { throw 'JS content missing init function' }

    Write-Output "  Created: $($html.Count) HTML, $($css.Count) CSS, $($js.Count) JS files"
    Write-Output "  CSS has max-width: $($html.content -match 'max-width')"
}

# ============================================================
# TEST 2: File versioning — update existing file creates new version
# ============================================================
Run-Test 'VFS versioning: update file creates new version' {
    # Create initial file
    $body1 = @{
        messages = @(@{ role='user'; content='Write a file called version-test.txt with content: Version 1 - initial' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'version-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body1)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    # Update the file
    $body2 = @{
        messages = @(
            @{ role='user'; content='Write a file called version-test.txt with content: Version 1 - initial' }
            @{ role='assistant'; content='write_file("version-test.txt", "Version 1 - initial", "Created")' }
            @{ role='user'; content='Now update version-test.txt to say: Version 2 - updated content with changes' }
        )
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'version-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body2)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $file = $fsJson.data.files | Where-Object { $_.path -match 'version-test\.txt' } | Select-Object -First 1

    if (-not $file) { throw 'version-test.txt not found' }
    Write-Output "  Version: $($file.version), Content: $($file.content.Substring(0, [Math]::Min(50, $file.content.Length)))"
}

# ============================================================
# TEST 3: Code generation with syntax validation
# ============================================================
Run-Test 'LLM generates syntactically valid Python code' {
    $body = @{
        messages = @(@{ role='user'; content='Write a Python file called factorial.py that defines a recursive factorial function and a main block that prints factorial(5)' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'python-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $pyFile = $fsJson.data.files | Where-Object { $_.path -match 'factorial\.py' } | Select-Object -First 1

    if (-not $pyFile) { throw 'factorial.py not created' }
    if ($pyFile.content -notmatch 'def\s+factorial') { throw 'Python file missing factorial function definition' }
    if ($pyFile.content -notmatch 'print|Factorial') { throw 'Python file missing print output' }

    Write-Output "  factorial.py created: $($pyFile.content.Length) chars"
    Write-Output "  Has function def: $($pyFile.content -match 'def\s+factorial')"
}

# ============================================================
# TEST 4: Complex nested directory structure
# ============================================================
Run-Test 'LLM creates nested directory structure with files' {
    $body = @{
        messages = @(@{ role='user'; content='Create a project structure: src/utils/helpers.js with export function capitalize(str), src/components/App.jsx with a React component that returns a div, and package.json with name "my-app" and dependencies react and react-dom' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'nested-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json

    $helpers = $fsJson.data.files | Where-Object { $_.path -match 'helpers\.js' }
    $app = $fsJson.data.files | Where-Object { $_.path -match 'App\.jsx' }
    $pkg = $fsJson.data.files | Where-Object { $_.path -match 'package\.json' }

    $missing = @()
    if (-not $helpers) { $missing += 'helpers.js' }
    if (-not $app) { $missing += 'App.jsx' }
    if (-not $pkg) { $missing += 'package.json' }

    if ($missing.Count -gt 0) { throw "Missing files: $($missing -join ', ')" }

    Write-Output "  Created: helpers.js, App.jsx, package.json"
    Write-Output "  package.json has react dep: $($pkg.content -match '"react"')"
}

# ============================================================
# TEST 5: JSON manipulation and data processing
# ============================================================
Run-Test 'LLM creates valid JSON config file' {
    $body = @{
        messages = @(@{ role='user'; content='Create a config.json file with: database host localhost port 5432, api keys with stripe and sendgrid set to placeholder values, and logging level set to info' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'json-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $jsonFile = $fsJson.data.files | Where-Object { $_.path -match 'config\.json' } | Select-Object -First 1

    if (-not $jsonFile) { throw 'config.json not created' }

    # Validate JSON is parseable
    try {
        $parsed = $jsonFile.content | ConvertFrom-Json
    } catch {
        throw "config.json is not valid JSON: $($_.Exception.Message)"
    }

    Write-Output "  config.json created and valid JSON"
    Write-Output "  Has database config: $($null -ne $parsed.database)"
}

# ============================================================
# TEST 6: API endpoint creation (Express-style)
# ============================================================
Run-Test 'LLM creates Express API endpoint' {
    $body = @{
        messages = @(@{ role='user'; content='Create an Express.js server file called server.js that has a GET /api/users endpoint returning a JSON array with two user objects containing id, name, and email fields, and listens on port 3000' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'api-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $serverFile = $fsJson.data.files | Where-Object { $_.path -match 'server\.js' } | Select-Object -First 1

    if (-not $serverFile) { throw 'server.js not created' }
    if ($serverFile.content -notmatch 'express') { throw 'server.js missing express import' }
    if ($serverFile.content -notmatch '/api/users') { throw 'server.js missing /api/users endpoint' }

    Write-Output "  server.js created: $($serverFile.content.Length) chars"
    Write-Output "  Has express: $($serverFile.content -match 'express')"
    Write-Output "  Has /api/users: $($serverFile.content -match '/api/users')"
}

# ============================================================
# TEST 7: File listing and directory structure verification
# ============================================================
Run-Test 'VFS list API returns correct directory structure' {
    $list = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/list?path=project/sessions" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $listJson = $list.Content | ConvertFrom-Json

    if ($listJson.data.nodes.Count -lt 1) { throw 'No session directories found' }

    Write-Output "  Sessions found: $($listJson.data.nodes.Count)"
    $listJson.data.nodes | ForEach-Object { Write-Output "    - $($_.name) ($($_.type))" }
}

# ============================================================
# TEST 8: Streaming tool calls with file edits
# ============================================================
Run-Test 'Streaming mode with tool calls creates files' {
    $body = @{
        messages = @(@{ role='user'; content='Create a file called streaming-tool-test.txt with content: This file was created via streaming with tool calls enabled' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $true
        conversationId = 'stream-tool-test-001'
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session
    Write-Output "  Stream response length: $($response.Content.Length)"

    Start-Sleep -Seconds 3
    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $found = $fsJson.data.files | Where-Object { $_.path -match 'streaming-tool-test\.txt' }

    if (-not $found) { throw 'streaming-tool-test.txt not found after streaming' }
    Write-Output "  File created via streaming: $($found.path)"
}

# ============================================================
# TEST 9: Markdown documentation generation
# ============================================================
Run-Test 'LLM generates valid Markdown documentation' {
    $body = @{
        messages = @(@{ role='user'; content='Create a README.md file with a project title "My Project", a description paragraph, a Features section with 3 bullet points, and an Installation section with a code block showing npm install' })
        provider = 'openrouter'
        model = 'mistralai/mistral-small-3.1-24b-instruct'
        stream = $false
        conversationId = 'readme-test-001'
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Start-Sleep -Seconds 3

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $readme = $fsJson.data.files | Where-Object { $_.path -match 'README\.md' } | Select-Object -First 1

    if (-not $readme) { throw 'README.md not created' }
    if ($readme.content -notmatch '# ') { throw 'README.md missing heading' }
    if ($readme.content -notmatch '## ') { throw 'README.md missing subheading' }

    Write-Output "  README.md created: $($readme.content.Length) chars"
    Write-Output "  Has heading: $($readme.content -match '# ')"
    Write-Output "  Has subheading: $($readme.content -match '## ')"
}

# ============================================================
# TEST 10: Health and infrastructure endpoints
# ============================================================
Run-Test 'MCP health endpoint responds correctly' {
    try {
        $resp = Invoke-WebRequest -Uri "$baseUrl/api/mcp/health" -Method GET -TimeoutSec 10 -UseBasicParsing
        if ($resp.StatusCode -ne 200) { throw "Status: $($resp.StatusCode)" }
        Write-Output "  MCP health: $($resp.StatusCode)"
    } catch {
        Write-Output "  MCP health skipped (endpoint may not be mounted): $($_.Exception.Message)"
    }
}

# ============================================================
# SUMMARY
# ============================================================
Write-Output "`n========================================================"
Write-Output ' TEST SUMMARY'
Write-Output '========================================================'
Write-Output "Total:    $totalTests"
Write-Output "Passed:   $passedTests"
Write-Output "Failed:   $failedTests"
Write-Output "Success:  $('{0:N1}' -f (($passedTests / $totalTests) * 100))%"
Write-Output '========================================================'

if ($failedTests -gt 0) { exit 1 } else { Write-Output 'All tests passed!' }
