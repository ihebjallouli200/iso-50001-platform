param(
  [int]$RetentionDays = 90
)

$ErrorActionPreference = 'Stop'
Write-Host "[retention] Target retention days: $RetentionDays"
Write-Host '[retention] Apply Timescale retention policy via SQL migration/runtime SQL in your DB pipeline.'
Write-Host '[retention] Apply Influx retention via bucket policy and task configs.'
