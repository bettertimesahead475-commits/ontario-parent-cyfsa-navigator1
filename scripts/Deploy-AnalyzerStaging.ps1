param(
  [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
  [string]$CommitHash,
  [switch]$ProviderChecksOnly
)
$ErrorActionPreference = 'Stop'
$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
if (-not (Test-Path -LiteralPath (Join-Path $release 'index.html'))) { throw 'Release index.html missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $release '_worker.js'))) { throw 'Compiled Pages Functions (_worker.js file/directory) missing. Use the tested CI release artifact.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'wrangler.pages-queue-staging.jsonc') | ConvertFrom-Json
if ($config.name -ne 'cyfsa-navigator-staging' -or $config.queues.producers[0].queue -ne 'cyfsa-staging-analyzer-jobs') { throw 'Refusing non-isolated Pages configuration.' }
if ($ProviderChecksOnly) {
  $config.vars.ANALYZER_ENABLED = 'false'
  $config.vars.STAGING_SUPABASE_URL = 'https://unconfigured.invalid'
  $config.vars | Add-Member -NotePropertyName STAGING_PROVIDER_CHECKS_ENABLED -NotePropertyValue 'true' -Force
  $config.vars | Add-Member -NotePropertyName STAGING_PROVIDER_CHECK_UIDS -NotePropertyValue 'cyfsa_e2e_a_0c17a294d05842208391fe56a90ca64f,cyfsa_e2e_b_c751bef315e74b23b1cd968c53797b12' -Force
  $config.queues = [PSCustomObject]@{ producers = @() }
} else {
  $database = [uri]$config.vars.STAGING_SUPABASE_URL
  if ($database.Scheme -ne 'https' -or $database.Host -notmatch '^[a-z0-9]+\.supabase\.co$' -or $database.Host -in @('nxfhvebzzobegubefcda.supabase.co','qboidsfpjuxeqtfotryj.supabase.co')) { throw 'Refusing shared or unprovisioned database. No chargeable staging execution is authorized.' }
}
if ($config.vars.FIREBASE_PROJECT_ID -ne 'cyfsa-navigator-e2e-20261108') { throw 'Refusing a non-isolated Firebase test project.' }
$config.pages_build_output_dir = '.'
[IO.File]::WriteAllText((Join-Path $release 'wrangler.jsonc'), ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
$previousAccount = $env:CLOUDFLARE_ACCOUNT_ID
$env:CLOUDFLARE_ACCOUNT_ID = '6dea4d69ac820b3b1736b302971190df'
Push-Location -LiteralPath $release
try {
  $deployArgs = @('--yes','wrangler@4','pages','deploy','.','--project-name=cyfsa-navigator-staging','--branch=migration/cloudflare-staging-20261029','--commit-dirty=false')
  if ($CommitHash) { $deployArgs += "--commit-hash=$CommitHash" }
  & npx @deployArgs
  if ($LASTEXITCODE -ne 0) { throw "Staging deploy failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
  $env:CLOUDFLARE_ACCOUNT_ID = $previousAccount
}
