$ErrorActionPreference = "Stop"

# Detailed recovery preset: fixes point 1-7.
# It keeps TPS rooms parallel, but uses conservative load, health-aware retry,
# nonce refresh, final reconciliation, and dynamic wave delay.
$env:STRESS_PARALLEL_ROOMS = "2"
$env:STRESS_TOTAL_TPS = "390"
$env:STRESS_WAVE_DELAY_MS = "15000"
$env:STRESS_STAGGER_WINDOW_MS = "8000"

# Dynamic wave delay. The runner records each wave's delay decision in the result JSON.
$env:STRESS_DYNAMIC_WAVE_DELAY_ENABLED = "true"
$env:STRESS_WAVE_DELAY_MIN_MS = "10000"
$env:STRESS_WAVE_DELAY_MAX_MS = "30000"
$env:STRESS_WAVE_DELAY_JITTER_MS = "5000"
$env:STRESS_WAVE_DELAY_INCREASE_MS = "5000"
$env:STRESS_WAVE_DELAY_DECREASE_MS = "2000"
$env:STRESS_WAVE_DELAY_FAILED_PROBE_THRESHOLD = "20"
$env:STRESS_WAVE_DELAY_HEALTH_WAIT_THRESHOLD_MS = "60000"

# Recovery retry. Max attempts keeps the run bounded, while still allowing recovery.
$env:VOTE_SUBMIT_RETRY_ATTEMPTS = "5"
$env:VOTE_RECOVERY_UNTIL_SUCCESS = "true"
$env:VOTE_RECOVERY_MAX_ATTEMPTS = "10"
$env:VOTE_SUBMIT_RETRY_DELAY_MS = "2000"
$env:VOTE_HEALTH_CHECK_ENABLED = "true"
$env:VOTE_HEALTH_CHECK_TIMEOUT_MS = "45000"
$env:VOTE_HEALTH_CHECK_INTERVAL_MS = "1000"
$env:VOTE_HEALTH_CHECK_GREEN_STREAK = "3"
$env:VOTE_RETRY_NONCE_ERRORS = "true"
$env:VOTE_USE_PENDING_NONCE = "true"
$env:VOTE_FINAL_RECONCILIATION_ENABLED = "true"
$env:VOTE_RUN_TIMEOUT_MS = "240000"

Write-Host "Detailed recovery TPS stress-main preset applied."
Write-Host "  Fixes: parallelRooms=2, nonce/RPC retry, pending nonce, recovery attempts, final reconciliation, dynamic wave delay"
Write-Host "  STRESS_TOTAL_TPS=$env:STRESS_TOTAL_TPS"
Write-Host "  VOTE_RECOVERY_MAX_ATTEMPTS=$env:VOTE_RECOVERY_MAX_ATTEMPTS"
Write-Host "  STRESS_WAVE_DELAY_MIN_MS=$env:STRESS_WAVE_DELAY_MIN_MS"
Write-Host "  STRESS_WAVE_DELAY_MAX_MS=$env:STRESS_WAVE_DELAY_MAX_MS"
Write-Host ""

npm run sampling:tps-stress-main
