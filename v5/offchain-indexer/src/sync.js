const path = require("path");
const mongoose = require("mongoose");
const { Contract, JsonRpcProvider, isAddress } = require("ethers");
const config = require("./config");
const { Room, VotingRoomEvent, SyncState } = require("./models");
const factoryArtifact = require(path.resolve(__dirname, "../../abi/RoomFactory.json"));
const factoryAbi = factoryArtifact.abi || factoryArtifact;
const stateKey = `room-factory:${config.chainId}:${config.factoryAddress.toLowerCase()}`;

async function syncOnce(provider, factory) {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) throw new Error(`RPC chain ID harus ${config.chainId}, aktual ${network.chainId}`);
  const state = await SyncState.findOne({ key: stateKey });
  const fromBlock = state ? state.lastProcessedBlock + 1 : config.startBlock;
  const toBlock = await provider.getBlockNumber();
  if (fromBlock > toBlock) return 0;
  const events = await factory.queryFilter(factory.filters.RoomRegistered(), fromBlock, toBlock);
  for (const event of events) {
    const block = await event.getBlock();
    const roomAddress = event.args.room.toLowerCase();
    await Room.findOneAndUpdate({ chainId: config.chainId, roomAddress }, {
      $set: { status: "confirmed", txHash: event.transactionHash, createdTx: event.transactionHash,
        adminAddress: event.args.admin.toLowerCase(), roomName: event.args.name,
        createdBlock: event.blockNumber },
      $setOnInsert: { chainId: config.chainId },
    }, { upsert: true, new: true });
    await VotingRoomEvent.updateOne({ chainId: config.chainId, txHash: event.transactionHash, logIndex: event.index }, {
      $setOnInsert: { chainId: config.chainId, roomAddress, eventName: "RoomRegistered",
        blockNumber: event.blockNumber, txHash: event.transactionHash, logIndex: event.index,
        eventArgs: { room: roomAddress, admin: event.args.admin.toLowerCase(), name: event.args.name },
        blockTimestamp: new Date(Number(block.timestamp) * 1000) },
    }, { upsert: true });
  }
  await SyncState.updateOne({ key: stateKey }, { $set: { lastProcessedBlock: toBlock } }, { upsert: true });
  console.log(`chainId=${config.chainId} blok ${fromBlock}-${toBlock}: ${events.length} RoomRegistered`);
  return events.length;
}

async function main() {
  if (!isAddress(config.factoryAddress)) throw new Error("Isi ROOM_FACTORY_ADDRESS di v5/.env dengan alamat deployment RoomFactory");
  await mongoose.connect(config.mongoUri);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const factory = new Contract(config.factoryAddress, factoryAbi, provider);
  do {
    await syncOnce(provider, factory);
    if (!process.argv.includes("--watch")) break;
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  } while (true);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
