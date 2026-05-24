$ErrorActionPreference = "Stop"

# Basic safe preset: fixes point 1-2.
# 1. Lower peak load to 2 TPS rooms in parallel for an 8GB RAM laptop.
# 2. Treat nonce/RPC transient errors as retryable and refresh voter nonce from pending state.
$env:STRESS_PARALLEL_ROOMS = "2"
$env:STRESS_TOTAL_TPS = "390"
$env:STRESS_WAVE_DELAY_MS = "15000"
$env:STRESS_STAGGER_WINDOW_MS = "8000"
$env:STRESS_RPC_URLS = "http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547,http://127.0.0.1:8548"
$env:STRESS_PREFLIGHT_RPC_HEALTH_ENABLED = "true"
$env:STRESS_PREFLIGHT_RPC_HEALTH_REQUIRE_ALL = "true"

$env:VOTE_SUBMIT_RETRY_ATTEMPTS = "5"
$env:VOTE_SUBMIT_RETRY_DELAY_MS = "2000"
$env:VOTE_HEALTH_CHECK_ENABLED = "true"
$env:VOTE_HEALTH_CHECK_TIMEOUT_MS = "45000"
$env:VOTE_HEALTH_CHECK_INTERVAL_MS = "1000"
$env:VOTE_HEALTH_CHECK_GREEN_STREAK = "3"
$env:VOTE_RETRY_NONCE_ERRORS = "true"
$env:VOTE_USE_PENDING_NONCE = "true"
$env:VOTE_RECOVERY_UNTIL_SUCCESS = "false"
$env:VOTE_RUN_TIMEOUT_MS = "180000"

Write-Host "Basic safe TPS stress-main preset applied."
Write-Host "  Fixes: parallelRooms=2, nonce/RPC retry enabled"
Write-Host "  STRESS_TOTAL_TPS=$env:STRESS_TOTAL_TPS"
Write-Host "  VOTE_SUBMIT_RETRY_ATTEMPTS=$env:VOTE_SUBMIT_RETRY_ATTEMPTS"
Write-Host ""

npm run sampling:tps-stress-main
