$ErrorActionPreference = "Stop"

# Safe preset for 8GB RAM laptops:
# - Keeps TPS rooms parallel, so the test remains a valid staggered parallel stress test.
# - Reduces peak pressure compared with the default 5 parallel rooms.
# - Uses health-aware retry so transient RPC errors can recover instead of becoming failed votes.
$env:STRESS_PARALLEL_ROOMS = "2"
$env:STRESS_TOTAL_TPS = "390"
$env:STRESS_WAVE_DELAY_MS = "15000"
$env:STRESS_STAGGER_WINDOW_MS = "8000"

$env:VOTE_SUBMIT_RETRY_ATTEMPTS = "5"
$env:VOTE_SUBMIT_RETRY_DELAY_MS = "2000"
$env:VOTE_HEALTH_CHECK_ENABLED = "true"
$env:VOTE_HEALTH_CHECK_TIMEOUT_MS = "45000"
$env:VOTE_HEALTH_CHECK_INTERVAL_MS = "1000"
$env:VOTE_HEALTH_CHECK_GREEN_STREAK = "3"
$env:VOTE_RETRY_NONCE_ERRORS = "true"
$env:VOTE_USE_PENDING_NONCE = "true"

# Main stress can spend time waiting for RPC health, so give each room enough time.
$env:VOTE_RUN_TIMEOUT_MS = "180000"

Write-Host "Safe TPS stress-main preset applied:"
Write-Host "  STRESS_PARALLEL_ROOMS=$env:STRESS_PARALLEL_ROOMS"
Write-Host "  STRESS_TOTAL_TPS=$env:STRESS_TOTAL_TPS"
Write-Host "  STRESS_WAVE_DELAY_MS=$env:STRESS_WAVE_DELAY_MS"
Write-Host "  STRESS_STAGGER_WINDOW_MS=$env:STRESS_STAGGER_WINDOW_MS"
Write-Host "  VOTE_SUBMIT_RETRY_ATTEMPTS=$env:VOTE_SUBMIT_RETRY_ATTEMPTS"
Write-Host "  VOTE_SUBMIT_RETRY_DELAY_MS=$env:VOTE_SUBMIT_RETRY_DELAY_MS"
Write-Host "  VOTE_HEALTH_CHECK_TIMEOUT_MS=$env:VOTE_HEALTH_CHECK_TIMEOUT_MS"
Write-Host "  VOTE_HEALTH_CHECK_GREEN_STREAK=$env:VOTE_HEALTH_CHECK_GREEN_STREAK"
Write-Host "  VOTE_RUN_TIMEOUT_MS=$env:VOTE_RUN_TIMEOUT_MS"
Write-Host ""

npm run sampling:tps-stress-main
