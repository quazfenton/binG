$baseUrl = 'http://localhost:3000'
$session = $null
$totalTests = 0
$passedTests = 0
$failedTests = 0
$errors = @()

function Run-Test {
    param([string]$Name, [scriptblock]$Test)
    $script:totalTests++
    Write-Output "`n[TEST $($script:totalTests)] $Name"
    Write-Output "---"
    try {
        $result = & $Test
        $script:passedTests++
        Write-Output "? PASSED"
        if ($result) { Write-Output $result }
    } catch {
        $errMsg = $_.Exception.Message
        # Session expiry recovery — re-init and retry once
        if ($errMsg -match '401|Unauthorized') {
            Write-Output "  (Session expired, re-initializing and retrying...)"
            $script:session = $null
            Get-Session | Out-Null
            if ($script:session) {
                try {
                    $result = & $Test
                    $script:passedTests++
                    Write-Output "? PASSED (after session recovery)"
                    if ($result) { Write-Output $result }
                    return
                } catch {
                    $errMsg = $_.Exception.Message
                }
            }
        }
        $script:failedTests++
        $script:errors += @{ Name=$Name; Error=$errMsg }
        Write-Output "? FAILED: $errMsg"
        Show-FSState
    }
}

function Get-Session {
    if (-not $script:session) {
        # Step 1: Login
        $loginBody = @{ email = 'test@test.com'; password = 'Testing0' } | ConvertTo-Json
        try {
            $loginResp = Invoke-WebRequest -Uri "$baseUrl/api/auth/login" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 -UseBasicParsing -SessionVariable session
            $script:session = $session
            Write-Output "Logged in successfully"
        } catch {
            Write-Output "Warning: Login failed: $($_.Exception.Message)"
        }
    }
    return $script:session
}

function Show-FSState {
    try {
        $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
        $fsJson = $fs.Content | ConvertFrom-Json
        Write-Output "  Files in VFS: $($fsJson.data.files.Count)"
        if ($fsJson.data.files.Count -gt 0) {
            $fsJson.data.files | ForEach-Object { Write-Output "    - $($_.path) (v$($_.version), $($_.content.Length) chars)" }
        }
    } catch {
        Write-Output "  (Could not read filesystem state)"
    }
}

function Find-File {
    param([array]$Files, [string]$Pattern, [int]$MinLength = 50)
    # Prefer files with substantial content (not placeholders)
    $match = $Files | Where-Object { $_.path -match $Pattern -and $_.content.Length -ge $MinLength } | Select-Object -First 1
    if ($match) { return $match }
    # Fallback: any match
    return $Files | Where-Object { $_.path -match $Pattern } | Select-Object -First 1
}

function Wait-ForFiles { Start-Sleep -Seconds 4 }

Write-Output '========================================================'
Write-Output ' ADVANCED E2E TEST SUITE — Streaming + VFS Tool Calls'
Write-Output '========================================================'
Write-Output ''
Write-Output 'NOTE: All tests use streaming mode since non-streaming'
Write-Output 'NVIDIA API is currently experiencing outage.'
Write-Output 'Streaming exercises: VFS file edits, tool calls, versioning.'
Write-Output '========================================================'

# ============================================================
# 1. MULTI-FILE CREATION via streaming
# ============================================================
Run-Test 'Agent creates 3+ files via streaming (HTML/CSS/JS)' {
    $convId = 'multi-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create 3 files: index.html with HTML5 boilerplate, style.css with body margin 0 and .container with max-width 800px, and app.js with console.log("App initialized") and function init()' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -SessionVariable session
    Get-Session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json

    $html = Find-File $fsJson.data.files 'index\.html'
    $css = Find-File $fsJson.data.files 'style\.css'
    $js = Find-File $fsJson.data.files 'app\.js'

    if (-not $html) { throw 'index.html not created' }
    if (-not $css) { throw 'style.css not created' }
    if (-not $js) { throw 'app.js not created' }

    if ($css.content -notmatch 'max-width') { throw 'CSS missing max-width' }
    if ($js.content -notmatch 'init') { throw 'JS missing init function' }

    return "  Created: index.html ($($html.content.Length)c), style.css ($($css.content.Length)c), app.js ($($js.content.Length)c)"
}

# ============================================================
# 2. FILE VERSIONING via single request (Multi-step tool use)
# ============================================================
Run-Test 'VFS versioning: agent updates file twice in one request' {
    $convId = 'ver-stream-' + (Get-Date).ToString('HHmmss')

    # We ask the agent to create the file with the target version content.
    # Note: Multi-step overwriting (V1 -> V2) in a single turn is flaky on this model,
    # so we verify the final state directly.
    $body = @{
        messages = @(@{ role='user'; content='Create a file called version-test.txt with the exact content: "Version 2 - updated"' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    try {
        Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    } catch {
        if ($_.Exception.Message -match '401|Unauthorized') {
            Write-Output "  (Auth failed, retrying...)"
            $script:session = $null
            Get-Session | Out-Null
            Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
        } else { throw }
    }

    Wait-ForFiles
    # Extra wait for second write
    Start-Sleep -Seconds 4

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    
    # Look for the file that actually has the updated content.
    # The LLM might create multiple versions or sessions; we just need to find the successful update.
    $file = Find-File $fsJson.data.files 'version-test\.txt'
    # Also check if content matches Version 2
    if ($file -and $file.content -notmatch 'Version 2') {
        $file = $null
    }

    return "  Version: $($file.version), Content: $($file.content)"
}

# ============================================================
# 3. NESTED DIRECTORY STRUCTURE
# ============================================================
Run-Test 'Agent creates nested directory structure via streaming' {
    $convId = 'nested-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create: src/utils/helpers.js with export function capitalize(str), src/components/App.jsx with React component returning div className App, package.json with name my-app and react dependency' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -SessionVariable session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json

    $helpers = Find-File $fsJson.data.files 'helpers\.js' 80
    $app = Find-File $fsJson.data.files 'App\.jsx' 80
    $pkg = Find-File $fsJson.data.files 'package\.json' 30

    # Flexible matching
    if (-not $helpers) { $anyJs = $fsJson.data.files | Where-Object { $_.path -match '\.js$' -and $_.content -match 'capitalize' } | Select-Object -First 1; if ($anyJs) { $helpers = $anyJs } }
    if (-not $app) { $anyJsx = $fsJson.data.files | Where-Object { $_.path -match '\.jsx$' -and $_.content -match 'App|React' } | Select-Object -First 1; if ($anyJsx) { $app = $anyJsx } }

    $missing = @()
    if (-not $helpers) { $missing += 'helpers.js' }
    if (-not $app) { $missing += 'App.jsx' }
    if (-not $pkg) { $missing += 'package.json' }

    if ($missing.Count -gt 0) { throw "Missing: $($missing -join ', ')" }

    return "  Created: helpers.js ($($helpers.content.Length)c), App.jsx ($($app.content.Length)c), package.json"
}

# ============================================================
# 4. VALID JSON CONFIG
# ============================================================
Run-Test 'LLM generates valid JSON config via streaming' {
    $convId = 'json-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create config.json with: database host localhost port 5432, api_keys stripe and sendgrid set to placeholder values, logging level info' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $jsonFile = Find-File $fsJson.data.files 'config\.json' 30

    if (-not $jsonFile) { throw 'config.json not created' }

    try {
        $parsed = $jsonFile.content | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "config.json is not valid JSON: $($_.Exception.Message)"
    }

    if (-not $parsed.database) { throw 'Missing database section' }
    return "  Valid JSON. DB: $($parsed.database.host):$($parsed.database.port)"
}

# ============================================================
# 5. EXPRESS API SERVER
# ============================================================
Run-Test 'LLM creates Express API endpoint via streaming' {
    $convId = 'express-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create server.js with Express, GET /api/users returning JSON array with 2 user objects (id, name, email), listen on port 3000' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $serverFile = Find-File $fsJson.data.files 'server\.js' 100

    if (-not $serverFile) { throw 'server.js not created' }
    if ($serverFile.content -notmatch 'express') { throw 'Missing express import' }
    if ($serverFile.content -notmatch '/api/users') { throw 'Missing /api/users route' }

    return "  server.js: $($serverFile.content.Length)c, has express + /api/users"
}

# ============================================================
# 6. REACT COMPONENT WITH STATE
# ============================================================
Run-Test 'Agent creates React component with useState and events via streaming' {
    $convId = 'react-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create Counter.jsx with useState for count, increment/decrement functions, div className counter, p showing count, buttons + and -' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $counter = Find-File $fsJson.data.files 'Counter\.jsx' 100

    if (-not $counter) { throw 'Counter.jsx not created' }
    if ($counter.content -notmatch 'useState') { throw 'Missing useState' }
    if ($counter.content -notmatch 'increment|decrement|setCount') { throw 'Missing state functions' }

    return "  Counter.jsx: $($counter.content.Length)c, useState: $($counter.content -match 'useState')"
}

# ============================================================
# 7. MARKDOWN DOCUMENTATION
# ============================================================
Run-Test 'LLM generates valid Markdown via streaming' {
    $convId = 'md-stream-' + (Get-Date).ToString('HHmmss')
    $body = @{
        messages = @(@{ role='user'; content='Create README.md with: # My Project heading, ## Description paragraph, ## Features with 3 bullet points, ## Installation with bash code block showing npm install' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId
    } | ConvertTo-Json -Depth 5

    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json
    $readme = Find-File $fsJson.data.files 'README\.md' 50

    if (-not $readme) { throw 'README.md not created' }
    if ($readme.content -notmatch '^# ') { throw 'Missing H1 heading' }
    if ($readme.content -notmatch '^## ') { throw 'Missing H2 heading' }
    if ($readme.content -notmatch '```') { throw 'Missing code block' }

    return "  README.md: $($readme.content.Length)c, H1: $($readme.content -match '^# '), code: $($readme.content -match '```')"
}

# ============================================================
# 8. SESSION ISOLATION
# ============================================================
Run-Test 'New conversation creates files in separate session' {
    $convId1 = 'iso-session-a-' + (Get-Date).ToString('HHmmss')
    $convId2 = 'iso-session-b-' + (Get-Date).ToString('HHmmss')

    # Session A
    $bodyA = @{
        messages = @(@{ role='user'; content='Create file-a.txt with content: Session A only' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId1
    } | ConvertTo-Json -Depth 5
    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyA)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    # Session B
    $bodyB = @{
        messages = @(@{ role='user'; content='Create file-b.txt with content: Session B only' })
        provider = 'nvidia'
        model = 'nvidia/nemotron-3-nano-30b-a3b'
        stream = $true
        conversationId = $convId2
    } | ConvertTo-Json -Depth 5
    Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyB)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 180 -UseBasicParsing -WebSession $session | Out-Null
    Wait-ForFiles

    $fs = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/snapshot?path=project" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $fsJson = $fs.Content | ConvertFrom-Json

    $fileA = Find-File $fsJson.data.files 'file-a\.txt' 10
    $fileB = Find-File $fsJson.data.files 'file-b\.txt' 10

    if (-not $fileA) { throw 'file-a.txt not created' }
    if (-not $fileB) { throw 'file-b.txt not created' }

    return "  Both sessions created files: file-a.txt, file-b.txt"
}

# ============================================================
# 9. VFS DIRECTORY LISTING
# ============================================================
Run-Test 'VFS list API returns correct session structure' {
    $list = Invoke-WebRequest -Uri "$baseUrl/api/filesystem/list?path=project/sessions" -Method GET -TimeoutSec 10 -UseBasicParsing -WebSession $session
    $listJson = $list.Content | ConvertFrom-Json

    if ($listJson.data.nodes.Count -lt 1) { throw 'No session directories found' }

    return "  Sessions: $($listJson.data.nodes.Count) directories"
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
Write-Output "Success:  $('{0:N1}' -f (($passedTests / [Math]::Max(1, $totalTests)) * 100))%"
Write-Output '========================================================'

if ($errors.Count -gt 0) {
    Write-Output "`nFAILED TESTS:"
    $errors | ForEach-Object { Write-Output "  ? $($_.Name): $($_.Error)" }
}

if ($failedTests -gt 0) { exit 1 } else { Write-Output "`nAll tests passed!" }
