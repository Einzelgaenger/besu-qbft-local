const RPC_URLS = (process.env.RPC_URLS || [
  "http://127.0.0.1:8545",
  "http://127.0.0.1:8546",
  "http://127.0.0.1:8547",
  "http://127.0.0.1:8548",
].join(","))
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 5000);

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: 1,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.message || JSON.stringify(payload.error));
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRpc(url) {
  const [chainIdHex, blockNumberHex, peerCountHex, validators] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_blockNumber"),
    rpc(url, "net_peerCount"),
    rpc(url, "qbft_getValidatorsByBlockNumber", ["latest"]).catch((error) => ({
      error: error.message,
    })),
  ]);

  return {
    rpcUrl: url,
    chainIdHex,
    chainId: Number.parseInt(chainIdHex, 16),
    blockNumberHex,
    blockNumber: Number.parseInt(blockNumberHex, 16),
    peerCountHex,
    peerCount: Number.parseInt(peerCountHex, 16),
    validators,
  };
}

async function main() {
  const rows = [];

  for (const url of RPC_URLS) {
    try {
      rows.push(await checkRpc(url));
    } catch (error) {
      rows.push({
        rpcUrl: url,
        error: error.name === "AbortError" ? `RPC timeout after ${RPC_TIMEOUT_MS}ms` : error.message,
      });
    }
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
