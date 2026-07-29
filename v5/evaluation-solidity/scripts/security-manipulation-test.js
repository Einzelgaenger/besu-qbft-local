const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const ROOT = path.join(__dirname, "..");
const RPC_URLS = (process.env.SECURITY_RPC_URLS || process.env.RPC_URLS || "http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547,http://127.0.0.1:8548")
  .split(",").map((v) => v.trim()).filter(Boolean);
const RPC_TIMEOUT_MS = Number(process.env.SECURITY_RPC_TIMEOUT_MS || 5000);

const detail = (e) => e?.shortMessage || e?.info?.error?.message || e?.message || String(e);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: controller.signal,
    });
    const body = await response.json();
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    return body.result;
  } finally { clearTimeout(timer); }
}

async function snapshot(room, round, voters, candidates) {
  const [status, total, votes, lastVoted] = await Promise.all([
    room.getCurrentRoundStatus(), room.roundTotalVotes(round),
    Promise.all(candidates.map((id) => room.getVotes(round, id))),
    Promise.all(voters.map((address) => room.lastVotedRound(address))),
  ]);
  return {
    round: status[0].toString(), state: Number(status[1]), readyToStart: status[2],
    totalVotes: total.toString(),
    candidateVotes: Object.fromEntries(candidates.map((id, i) => [id, votes[i].toString()])),
    lastVotedRound: Object.fromEntries(voters.map((address, i) => [address, lastVoted[i].toString()])),
  };
}

async function expectRejected(ctx, input) {
  const before = await snapshot(ctx.room, ctx.round, ctx.voters, ctx.candidates);
  let rejection = null;
  let unexpectedReceipt = null;
  try {
    const tx = await input.action();
    const receipt = await tx.wait();
    unexpectedReceipt = { hash: receipt.hash, blockNumber: Number(receipt.blockNumber), status: Number(receipt.status) };
  } catch (e) { rejection = detail(e); }
  const after = await snapshot(ctx.room, ctx.round, ctx.voters, ctx.candidates);
  const stateUnchanged = JSON.stringify(before) === JSON.stringify(after);
  return {
    id: input.id, title: input.title,
    status: rejection && stateUnchanged ? "PASS" : "FAIL",
    expected: input.expected,
    observed: rejection && stateUnchanged ? "Action rejected and voting state remained unchanged." : "Rejection and state-integrity criteria were not both satisfied.",
    rejection, unexpectedReceipt, stateUnchanged, before, after,
  };
}

async function modifiedHashScenario(realHash) {
  const modifiedHash = realHash.slice(0, -1) + (realHash.endsWith("0") ? "1" : "0");
  const validators = await Promise.all(RPC_URLS.map(async (url) => {
    try {
      const [original, modified] = await Promise.all([
        rpc(url, "eth_getTransactionByHash", [realHash]), rpc(url, "eth_getTransactionByHash", [modifiedHash]),
      ]);
      return { rpcUrl: url, reachable: true, originalFound: Boolean(original), originalHashMatches: original?.hash?.toLowerCase() === realHash.toLowerCase(), modifiedFound: Boolean(modified) };
    } catch (e) { return { rpcUrl: url, reachable: false, error: detail(e) }; }
  }));
  const pass = validators.length > 0 && validators.every((v) => v.reachable && v.originalHashMatches && !v.modifiedFound);
  return {
    id: "modified_transaction_hash", title: "Modified transaction hash", status: pass ? "PASS" : "INCONCLUSIVE",
    expected: "A modified hash cannot resolve to the original immutable transaction.",
    observed: pass ? "All configured RPC endpoints resolved only the canonical hash." : "Not all configured RPC endpoints supplied conclusive evidence.",
    realHash, modifiedHash, stateUnchanged: true, validators,
  };
}

async function consensusEvidence(room, round, candidates, blockNumber) {
  const calls = [
    ["roundTotalVotes", room.interface.encodeFunctionData("roundTotalVotes", [round])],
    ...candidates.map((id) => [`getVotes(${id})`, room.interface.encodeFunctionData("getVotes", [round, id])]),
    ["state", room.interface.encodeFunctionData("state")],
  ];
  const tag = hre.ethers.toQuantity(blockNumber);
  const validators = await Promise.all(RPC_URLS.map(async (url) => {
    try {
      const [block, ...values] = await Promise.all([
        rpc(url, "eth_getBlockByNumber", [tag, false]),
        ...calls.map(([, data]) => rpc(url, "eth_call", [{ to: room.target, data }, tag])),
      ]);
      return { rpcUrl: url, reachable: true, blockHash: block.hash, stateValues: Object.fromEntries(calls.map(([label], i) => [label, values[i]])) };
    } catch (e) { return { rpcUrl: url, reachable: false, error: detail(e) }; }
  }));
  const fingerprints = validators.filter((v) => v.reachable).map((v) => JSON.stringify([v.blockHash, v.stateValues]));
  const pass = validators.length > 0 && validators.every((v) => v.reachable) && new Set(fingerprints).size === 1;
  return {
    status: pass ? "PASS" : "INCONCLUSIVE", blockNumber,
    configuredEndpointCount: validators.length, reachableEndpointCount: validators.filter((v) => v.reachable).length,
    allConfiguredAgree: pass,
    claim: pass ? "All configured validator RPC endpoints returned the same block hash and voting state." : "Agreement could not be demonstrated across every configured endpoint.",
    validators,
  };
}

function report(result) {
  const rows = result.scenarios.map((s) => `| ${s.title} | **${s.status}** | ${s.rejection ? "Yes" : s.id === "modified_transaction_hash" ? "N/A" : "No"} | ${s.stateUnchanged ? "Yes" : "No"} | ${s.observed} |`);
  const evidence = result.scenarios.flatMap((s) => [
    `### ${s.title}`, "", `**Status:** ${s.status}`, "", `**Expected:** ${s.expected}`, "", `**Observed:** ${s.observed}`,
    ...(s.rejection ? ["", `**Rejection:** \`${s.rejection.replace(/`/g, "'")}\``] : []),
    ...(s.realHash ? ["", `**Canonical hash:** \`${s.realHash}\``, "", `**Modified hash:** \`${s.modifiedHash}\``] : []), "",
  ]);
  return [
    "# Security Analysis Against Data Manipulation", "",
    `- Executed at: ${result.executedAt}`, `- Network: ${result.network.name} (chain ID ${result.network.chainId})`,
    `- Contract: \`${result.contract.address}\``, `- Round: ${result.contract.round}`, `- Overall: **${result.summary.overallStatus}**`,
    `- Passed: ${result.summary.pass}; Failed: ${result.summary.fail}; Inconclusive: ${result.summary.inconclusive}`, "",
    "## Method", "", "Each negative test records contract state immediately before and after the attack. A test passes only if the action is rejected and the relevant voting state is unchanged.", "",
    "## Scenario Results", "", "| Scenario | Status | Rejected | State unchanged | Observation |", "|---|---:|---:|---:|---|", ...rows, "",
    "## Detailed Evidence", "", ...evidence,
    "## Validator State Consistency", "", `**Status:** ${result.validatorConsensus.status}`, "", result.validatorConsensus.claim, "",
    `Checked at block ${result.validatorConsensus.blockNumber}; ${result.validatorConsensus.reachableEndpointCount}/${result.validatorConsensus.configuredEndpointCount} configured endpoints responded.`, "",
    "## Interpretation And Limitations", "",
    "These are empirical results for the bytecode, network configuration, accounts, and block recorded in this run, not a formal proof. The direct-state scenario tests an external transaction calling a nonexistent state-mutator selector; it does not cover validator host compromise, stolen administrator keys, malicious upgrades, or chain-level consensus failure.", "",
    "An INCONCLUSIVE result must not be reported as a passed security property. Full snapshots, RPC responses, hashes, and errors are in `evidence.json` beside this report.", "",
  ].join("\n");
}

async function main() {
  const [admin] = await hre.ethers.getSigners();
  const voter1 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const voter2 = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const outsider = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  const candidates = [1, 2];
  const voters = [voter1.address, voter2.address, outsider.address];

  console.log("Deploying isolated security-test room...");
  const Room = await hre.ethers.getContractFactory("VotingRoom", admin);
  const room = await Room.deploy({ gasPrice: 0 });
  await room.waitForDeployment();
  await (await room.initialize(admin.address, "Security Manipulation Test", { gasPrice: 0 })).wait();
  await (await room.addVoters([voter1.address, voter2.address], { gasPrice: 0 })).wait();
  await (await room.addCandidates(candidates, ["Candidate A", "Candidate B"], { gasPrice: 0 })).wait();
  await (await room.start({ gasPrice: 0 })).wait();
  const round = Number(await room.currentRound());
  const ctx = { room, round, voters, candidates };

  const firstVote = await room.connect(voter1).vote(1, { gasPrice: 0, gasLimit: 300000 });
  const firstReceipt = await firstVote.wait();
  const scenarios = [];
  scenarios.push(await expectRejected(ctx, { id: "duplicate_vote", title: "Duplicate vote", expected: "A second vote by one EOA in the same round reverts with AlreadyVotedThisRound.", action: () => room.connect(voter1).vote(2, { gasPrice: 0, gasLimit: 300000 }) }));
  scenarios.push(await expectRejected(ctx, { id: "unauthorized_voter", title: "Unauthorized voter", expected: "An unregistered EOA reverts with VoterNotEligible.", action: () => room.connect(outsider).vote(1, { gasPrice: 0, gasLimit: 300000 }) }));
  scenarios.push(await expectRejected(ctx, { id: "invalid_candidate", title: "Invalid candidate", expected: "An unregistered candidate ID reverts with CandidateNotFound.", action: () => room.connect(voter2).vote(999999, { gasPrice: 0, gasLimit: 300000 }) }));

  const fakeSelector = hre.ethers.id("setRoundTotalVotes(uint256,uint256)").slice(0, 10);
  const fakeArgs = hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [round, 999999]).slice(2);
  scenarios.push(await expectRejected(ctx, { id: "direct_state_modification", title: "Direct modification of blockchain state", expected: "An external transaction cannot write vote totals through a nonexistent mutator.", action: () => outsider.sendTransaction({ to: room.target, data: fakeSelector + fakeArgs, gasPrice: 0, gasLimit: 300000 }) }));

  const network = await hre.ethers.provider.getNetwork();
  const signed = await voter2.signTransaction({ type: 0, to: room.target, data: room.interface.encodeFunctionData("vote", [2]), nonce: await hre.ethers.provider.getTransactionCount(voter2.address), gasLimit: 300000, gasPrice: 0, chainId: network.chainId, value: 0 });
  const forged = hre.ethers.Transaction.from(signed);
  forged.signature = hre.ethers.Signature.from({ r: hre.ethers.ZeroHash, s: forged.signature.s, v: forged.signature.v });
  scenarios.push(await expectRejected(ctx, { id: "forged_transaction", title: "Forged transaction", expected: "A raw transaction with an invalid signature is rejected before contract execution.", action: () => hre.ethers.provider.broadcastTransaction(forged.serialized) }));
  scenarios.push(await modifiedHashScenario(firstReceipt.hash));

  await (await room.stop({ gasPrice: 0, gasLimit: 1000000 })).wait();
  scenarios.push(await expectRejected(ctx, { id: "vote_after_room_closed", title: "Vote after room closed", expected: "A vote while the room is Inactive reverts with InvalidState.", action: () => room.connect(voter2).vote(2, { gasPrice: 0, gasLimit: 300000 }) }));
  const validatorConsensus = await consensusEvidence(room, round, candidates, await hre.ethers.provider.getBlockNumber());

  const count = (status) => scenarios.filter((s) => s.status === status).length;
  const summary = { pass: count("PASS"), fail: count("FAIL"), inconclusive: count("INCONCLUSIVE"), total: scenarios.length };
  summary.overallStatus = summary.fail ? "FAIL" : summary.inconclusive || validatorConsensus.status !== "PASS" ? "INCONCLUSIVE" : "PASS";
  const result = {
    schemaVersion: 1, testName: "security-analysis-against-data-manipulation", executedAt: new Date().toISOString(),
    network: { name: hre.network.name, chainId: network.chainId.toString(), rpcUrl: hre.network.config.url },
    contract: { address: room.target, admin: admin.address, round, candidates, registeredVoters: [voter1.address, voter2.address] },
    summary, scenarios, validatorConsensus,
  };
  const runDir = process.env.SECURITY_RESULT_DIR ? path.resolve(process.env.SECURITY_RESULT_DIR) : path.join(ROOT, "results", "security-manipulation", stamp());
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "evidence.json"), JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
  fs.writeFileSync(path.join(runDir, "report.md"), report(result));
  console.log(JSON.stringify({ summary, reportPath: path.join(runDir, "report.md"), evidencePath: path.join(runDir, "evidence.json") }, null, 2));
  if (summary.overallStatus === "FAIL") process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
