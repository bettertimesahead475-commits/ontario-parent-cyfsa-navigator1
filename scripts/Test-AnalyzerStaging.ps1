param(
  [string]$BaseUrl = 'https://cyfsa-navigator-staging.pages.dev',
  [string[]]$PdfPath = @('tests/fixtures/synthetic/03-digital-3-pages.pdf', 'tests/fixtures/synthetic/04-scanned-3-pages.pdf')
)
$ErrorActionPreference = 'Stop'
if (([uri]$BaseUrl).Host -notmatch '(^|\.)cyfsa-navigator-staging\.pages\.dev$') { throw 'Only the isolated staging Pages project is allowed.' }
if (-not $env:FIREBASE_ID_TOKEN) { throw 'Set FIREBASE_ID_TOKEN locally to a fresh signed-in owner Firebase ID token. Do not paste it into chat.' }
$headers = @{ Authorization = "Bearer $env:FIREBASE_ID_TOKEN" }
# This performs real provider calls and may reserve/consume credits for non-owner users.
# The verified owner bypass can exercise both modes without spending customer credits.
foreach ($file in $PdfPath) {
  $bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $file))
  $payload = @{ fileData = @{ base64 = [Convert]::ToBase64String($bytes); mimeType = 'application/pdf'; fileName = [IO.Path]::GetFileName($file) } } | ConvertTo-Json -Depth 6 -Compress
  $extracted = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/extract-text" -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 180
  if (-not $extracted.extractedText -or $extracted.extractedText.StartsWith('JVBER')) { throw 'Extraction did not produce document text.' }
  Write-Host "Extracted $($extracted.characters) characters; OCR model: $($extracted.document.ocrModel)"
  foreach ($mode in @('fast','full')) {
    $id = 'live_' + [Guid]::NewGuid().ToString('N')
    $body = @{ documentText = $extracted.extractedText; documentName = [IO.Path]::GetFileName($file); mode = $mode; stream = $false; analysisId = $id } | ConvertTo-Json -Depth 6 -Compress
    $job = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/analyze" -Headers ($headers + @{ 'X-Analysis-Id' = $id }) -ContentType 'application/json' -Body $body -TimeoutSec 240
    $deadline = [DateTime]::UtcNow.AddMinutes(6)
    if ($job.jobId) {
      do {
        if ([DateTime]::UtcNow -gt $deadline) { throw "Timed out waiting for existing job $id; do not submit a new chargeable request." }
        Start-Sleep -Seconds 3
        $job = Invoke-RestMethod -Uri "$BaseUrl/api/analyze/job/$id" -Headers $headers -TimeoutSec 20
        Write-Host "$mode $($job.status) $($job.currentStage)"
        if ($job.status -in @('failed','timed_out')) { throw ($job.error | ConvertTo-Json -Compress) }
      } until ($job.status -eq 'completed')
      $report = $job.report
    } else { $report = $job }
    if (-not $report.fileSummary) { throw "$mode returned no usable structured report." }
    $reopened = Invoke-RestMethod -Uri "$BaseUrl/api/analyze/job/$id" -Headers $headers -TimeoutSec 20
    if (-not $reopened.report.fileSummary) { throw 'Saved report could not be reopened.' }
    Write-Host "$mode completed and reopened; model $($report._metadata.modelUsed)"
  }
}
