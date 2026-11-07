# Offline regression tests for the live runner's evidence gates. No provider requests.
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'Test-AnalyzerStaging.ps1'
$fixture = Join-Path $PSScriptRoot '../tests/fixtures/synthetic/03-digital-3-pages.pdf'
$previousToken = $env:FIREBASE_ID_TOKEN
$env:FIREBASE_ID_TOKEN = 'offline-harness-test-only'
$global:AnalyzerHarnessScenario = ''
$global:AnalyzerHarnessPoll = 0
$global:AnalyzerHarnessMode = ''
function Invoke-WebRequest {
  param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec)
  $request = $Body | ConvertFrom-Json
  $global:AnalyzerHarnessJobId = $request.analysisId
  $global:AnalyzerHarnessMode = $request.mode
  $global:AnalyzerHarnessPoll = 0
  [pscustomobject]@{ StatusCode = $(if ($global:AnalyzerHarnessScenario -eq 'synchronous') { 200 } else { 202 }); Content = (@{ jobId = $global:AnalyzerHarnessJobId } | ConvertTo-Json) }
}
function Invoke-RestMethod {
  param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec)
  if ($Uri.EndsWith('/auth-check')) { return @{ authenticated = $true } }
  if ($Uri.EndsWith('/extract-text')) { return @{ extractedText = '[Page 1] Synthetic document'; characters = 27; document = @{ ocrModel = $null } } }
  $global:AnalyzerHarnessPoll++
  $model = if ($global:AnalyzerHarnessMode -eq 'fast') { 'claude-sonnet-5-5' } else { 'claude-opus-5-5' }
  if ($global:AnalyzerHarnessScenario -eq 'wrong-model') { $model = 'claude-haiku-5-5' }
  $summary = if ($global:AnalyzerHarnessScenario -eq 'changed-report' -and $global:AnalyzerHarnessPoll -gt 1) { 'Changed' } else { 'Synthetic summary' }
  return @{ status = 'completed'; report = @{ fileSummary = $summary; _metadata = @{ modelUsed = $model } } }
}
function Start-Sleep { param($Seconds) }
$passed = 0
try {
  foreach ($case in @(
    @{ name = 'synchronous'; error = 'HTTP 202' },
    @{ name = 'wrong-model'; error = 'unexpected or missing provider model' },
    @{ name = 'changed-report'; error = 'differs from the persisted' },
    @{ name = 'success'; error = $null }
  )) {
    $global:AnalyzerHarnessScenario = $case.name
    $caught = $null
    try { & $runner -PdfPath $fixture } catch { $caught = $_.Exception.Message }
    if ($case.error -and ($caught -notlike "*$($case.error)*")) { throw "$($case.name): expected $($case.error), got $caught" }
    if (-not $case.error -and $caught) { throw $caught }
    $passed++
  }
  foreach ($origin in @('http://cyfsa-navigator-staging.pages.dev', 'https://cyfsanavigator.com', 'https://cyfsa-navigator-staging.pages.dev:8443', 'https://cyfsa-navigator-staging.pages.dev/other')) {
    $caught = $null
    try { & $runner -BaseUrl $origin -PdfPath $fixture } catch { $caught = $_.Exception.Message }
    if ($caught -notlike '*isolated staging HTTPS*') { throw "Unsafe origin was not rejected: $origin" }
    $passed++
  }
  Write-Host "$passed offline runner regressions passed. No live/provider validation was performed."
} finally { $env:FIREBASE_ID_TOKEN = $previousToken }
